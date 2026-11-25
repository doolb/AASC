"""从已校验的预处理缓存执行官方完整参数 CUDA 编码、采样和解码。"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from local_cpu.run_shoulder import digest, log, make_ae, make_diffusion, read_prepared, save_json


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', choices=['all', 'encode', 'sample', 'decode'], default='all')
    parser.add_argument('--res', type=int, default=8192)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--steps', type=int, default=50)
    parser.add_argument('--solver', choices=['dopri5', 'rk4', 'euler'], default='dopri5')
    parser.add_argument('--attention-chunk', type=int, default=512)
    parser.add_argument('--query-chunk', type=int, default=2048)
    parser.add_argument('--memory-gib', type=float, default=16)
    parser.add_argument('--checkpoint-dir', type=Path, default=ROOT / 'checkpoints/ckpts')
    args = parser.parse_args()
    if args.res < 32 or min(args.steps, args.threads, args.attention_chunk, args.query_chunk) < 1 or args.memory_gib <= 0:
        parser.error('采样/分块/显存参数无效')
    args.input, args.output = args.input.resolve(), args.output.resolve()
    args.adapter, args.base_id = None, 'squadgen-official'
    return args


def check_inputs(args):
    manifest = json.loads((args.output / 'cache-manifest.json').read_text())
    if manifest['input_sha256'] != digest(args.input) or manifest['res'] != args.res:
        raise ValueError('输入模型或 res 与缓存不一致')
    for name, expected in manifest['files'].items():
        if Path(name).name != name or digest(args.output / name) != expected:
            raise ValueError('预处理缓存指纹不一致：' + name)
    for name, expected in manifest['weights'].items():
        if Path(name).name != name or digest(args.checkpoint_dir / name) != expected:
            raise ValueError('模型权重指纹不一致：' + name)
    return manifest


def cuda_model(args, kind):
    from local_gpu.attention import install
    model = {'ae': make_ae, 'diffusion': make_diffusion}[kind](args).to('cuda').eval()
    count = install(model, args.attention_chunk)
    log(f'CUDA {kind}：FP32，{count} 个注意力模块，query 分块 {args.attention_chunk}')
    return model


def encode(args):
    import torch
    from local_train.runtime import tree_to
    batch = tree_to(read_prepared(args)['batch'], 'cuda')
    ae = cuda_model(args, 'ae')
    helper = make_diffusion(args, weights=False)
    result = helper.get_latent_and_condition(batch, ae, is_mode=True, is_run_sqvae=False)
    torch.save(tree_to(result['condition_params'], 'cpu'), args.output / 'condition.pt')
    log('CUDA 几何条件编码完成')


def sample(args):
    import torch
    from local_train.runtime import tree_to
    from squadgen.network.models_sit import StackedRandomGenerator
    from squadgen.network.transport import Sampler, create_transport
    from squadgen.util.util import spatial_smoothing
    model = cuda_model(args, 'diffusion')
    batch = tree_to(read_prepared(args)['batch'], 'cuda')
    condition = tree_to(torch.load(args.output / 'condition.pt', weights_only=True, map_location='cpu'), 'cuda')
    generator = StackedRandomGenerator(torch.device('cuda'), [args.seed])
    latent = generator.randn([1, args.res, model.channels], device='cuda')
    points = torch.cat([batch[f'xyz_fps_{args.res}'], 0.1 * batch[f'normal_fps_{args.res}']], dim=-1)
    latent = spatial_smoothing(points, latent, 32, 2, smooth_iter=10, use_taubin_smoothing=True)
    solver = Sampler(create_transport('Linear', 'velocity', None)).sample_ode(
        sampling_method=args.solver, num_steps=args.steps)
    evaluations = 0
    started = time.monotonic()

    def forward(x, t, **kwargs):
        nonlocal evaluations
        torch.cuda.synchronize()
        tick = time.monotonic()
        result = model(x, t, **kwargs)
        if not torch.isfinite(result['x']).all():
            raise FloatingPointError('扩散输出非有限数')
        torch.cuda.synchronize()
        evaluations += 1
        log(f'GPU 扩散评估 {evaluations}：t={float(t[0]):.5f}，本次 {time.monotonic()-tick:.2f}s，总计 {time.monotonic()-started:.1f}s')
        return result

    latent = model.denormalize_latents(solver(latent, forward, condition_params=condition)[-1])
    torch.save(latent.float().cpu(), args.output / 'latent.pt')
    save_json(args.output / 'sample-info.json', dict(network_evaluations=evaluations, solver=args.solver,
        saved_time_points=args.steps, res=args.res, seed=args.seed, dtype='float32', seconds=time.monotonic()-started,
        atol=1e-6, rtol=1e-3, random_backend='cuda', attention_query_chunk=args.attention_chunk))


def decode(args):
    import numpy as np
    import torch
    from squadgen.util.util import de_norm_pca
    prepared = read_prepared(args)
    latent = torch.load(args.output / 'latent.pt', weights_only=True, map_location='cpu').cuda()
    ae = cuda_model(args, 'ae')
    features = ae.latent_vae.return_last_features(latent)
    queries = prepared['queries']
    # 官方 decode_batch 会 cat 成连续布局；保持相同布局，避免 CUDA GEMM 路径产生不同舍入。
    probe = queries[:, :16].cuda().contiguous()
    official = ae.latent_vae.decode_batch(latent, {'xyz_query': probe})
    cached = ae.latent_vae.query_last_features(features, probe)
    for key in official:
        torch.testing.assert_close(cached[key], official[key], rtol=1e-5, atol=1e-6)
    chunks = {}
    for start in range(0, queries.shape[1], args.query_chunk):
        result = ae.latent_vae.query_last_features(features, queries[:, start:start + args.query_chunk].cuda().contiguous())
        for key, value in result.items():
            if not torch.isfinite(value).all():
                raise FloatingPointError('解码场非有限数：' + key)
            chunks.setdefault(key, []).append(value[0].float().cpu().numpy())
        if start % (args.query_chunk * 20) == 0:
            log(f'CUDA 场解码 {min(start + args.query_chunk, queries.shape[1])}/{queries.shape[1]}')
    fields = {key: np.concatenate(values) for key, values in chunks.items()}
    fields.update(xyz=queries[0].numpy(), invT=prepared['batch']['invT'][0])
    fields = de_norm_pca(fields, fields['invT'])
    for key in ['gdcdf', 'xyz', 'offset1', 'offset2', 'offset3', 'offsetb', 'offsetd']:
        fields.pop(key, None)
    np.savez(args.output / 'extract_mesh.npz', **fields)
    save_json(args.output / 'decode-info.json', dict(queries=queries.shape[1], chunk_size=args.query_chunk,
        cached_features_match_official_decode=True, query_layout='contiguous-like-official-cat',
        fields={k: list(v.shape) for k, v in fields.items()}))


def main():
    args = arguments()
    args.output.mkdir(parents=True, exist_ok=True)
    report = dict(status='running', stage=args.stage, arguments={k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()})
    path = args.output / f'gpu-{args.stage}-status.json'
    save_json(path, report)
    started = time.monotonic()
    torch = None
    try:
        report['input_manifest'] = check_inputs(args)
        if args.stage == 'all':
            for stage in ['encode', 'sample', 'decode']:
                log('启动 GPU 独立阶段：' + stage)
                subprocess.run([sys.executable, '-u', str(Path(__file__).resolve()), *sys.argv[1:], '--stage', stage], check=True, cwd=ROOT)
        else:
            import torch
            from local_gpu.attention import self_test
            if not torch.cuda.is_available():
                raise RuntimeError('未发现可用 CUDA')
            torch.set_num_threads(args.threads)
            torch.backends.cuda.matmul.allow_tf32 = False
            properties = torch.cuda.get_device_properties(0)
            torch.cuda.set_per_process_memory_fraction(min(args.memory_gib * 1024**3 / properties.total_memory, 0.95))
            report.update(gpu=properties.name, torch=str(torch.__version__), cuda=torch.version.cuda,
                          attention_numerical_check=self_test('cuda'))
            torch.cuda.reset_peak_memory_stats()
            with torch.no_grad():
                {'encode': encode, 'sample': sample, 'decode': decode}[args.stage](args)
        report.update(status='completed', source_unchanged=digest(args.input) == report['input_manifest']['input_sha256'])
    except Exception as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        if torch is not None and torch.cuda.is_available():
            report.update(cuda_peak_allocated=torch.cuda.max_memory_allocated(), cuda_peak_reserved=torch.cuda.max_memory_reserved())
        save_json(path, report)


if __name__ == '__main__':
    main()
