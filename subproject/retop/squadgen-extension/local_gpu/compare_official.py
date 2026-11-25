"""固定真实输入，比较官方原生模型函数与分块适配；不覆盖原实验。"""
import argparse
import gc
import json
from pathlib import Path
import sys
import time
import traceback
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import torch

import infer_sqdiffuse as official
from local_cpu.run_shoulder import save_json, log
from local_gpu.attention import install
from local_gpu.run_example import check_inputs
from local_train.runtime import tree_to


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, choices=['encode', 'forward', 'decode'])
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--query-chunk', type=int, default=100000)
    args = parser.parse_args()
    args.baseline, args.output = args.baseline.resolve(), args.output.resolve()
    return args


def configuration():
    # 直接使用官方加载器及源码配置，避免本地 meta 加载方式成为共同误差源。
    return SimpleNamespace(res=8192, ae_config=ROOT / 'squadgen/network/config/sqvae_geomae.yaml',
        ae_pth=ROOT / 'checkpoints/ckpts/sqvae_geomae.safetensors',
        model_config=ROOT / 'squadgen/network/config/sqdiffuse.yaml',
        model_pth=ROOT / 'checkpoints/ckpts/sqdiffuse.safetensors',
        sit_path_type='Linear', sit_prediction='velocity', sit_loss_weight='None')


def compare(actual, reference, path='root'):
    # 嵌套结构的每个张量均比较；相对L2比逐元素相对差更适合包含零值的条件。
    if isinstance(actual, dict):
        if actual.keys() != reference.keys():
            raise ValueError('字段不一致：' + path)
        out = {}
        for key in actual:
            out.update(compare(actual[key], reference[key], path + '.' + key))
        return out
    if isinstance(actual, (list, tuple)):
        if len(actual) != len(reference):
            raise ValueError('序列长度不一致：' + path)
        out = {}
        for index, (left, right) in enumerate(zip(actual, reference)):
            out.update(compare(left, right, path + '.' + str(index)))
        return out
    if actual is None:
        if reference is not None:
            raise ValueError('空值不一致：' + path)
        return {}
    left = torch.as_tensor(actual).detach().float().cpu()
    right = torch.as_tensor(reference).detach().float().cpu()
    if left.shape != right.shape:
        raise ValueError('形状不一致：' + path)
    delta = left - right
    return {path: dict(shape=list(left.shape), max_abs=float(delta.abs().max()),
        rms=float(delta.square().mean().sqrt()),
        relative_l2=float(delta.norm() / right.norm().clamp_min(1e-12)),
        finite=bool(torch.isfinite(left).all() and torch.isfinite(right).all()),
        close_rtol_1e5_atol_1e6=bool(torch.allclose(left, right, rtol=1e-5, atol=1e-6)))}


def prepared(args):
    # 只加载自己生成且 SHA 清单已核验的缓存；其中 invT 包含 NumPy 对象。
    return torch.load(args.baseline / 'prepared.pt', map_location='cpu', weights_only=False)


def encode(args):
    config = configuration()
    ae, ae_config = official.load_ae(config, 'cuda')
    model = official.load_sqdiffuse(config, ae_config, 'cuda')
    batch = tree_to(prepared(args)['batch'], 'cuda')
    log('官方原生编码开始：8192，未安装分块注意力')
    condition = model.get_latent_and_condition(batch, ae, is_mode=True, is_run_sqvae=False)['condition_params']
    condition = tree_to(condition, 'cpu')
    torch.save(condition, args.output / 'condition-official.pt')
    reference = torch.load(args.baseline / 'condition.pt', map_location='cpu', weights_only=True)
    return dict(comparison=compare(condition, reference), official_loader=True, native_attention=True)


def forward(args):
    from omegaconf import OmegaConf
    from squadgen.network.models_sit import StackedRandomGenerator
    from squadgen.util.util import spatial_smoothing
    config = configuration()
    ae_config = OmegaConf.load(config.ae_config)
    ae_config.model.params.latent_vae_params.num_latents = config.res
    ae_config.model.params.cond_vae_params.num_latents = config.res
    model = official.load_sqdiffuse(config, ae_config, 'cuda')
    condition = tree_to(torch.load(args.baseline / 'condition.pt', map_location='cpu', weights_only=True), 'cuda')
    batch = tree_to(prepared(args)['batch'], 'cuda')
    noise = StackedRandomGenerator(torch.device('cuda'), [0]).randn([1, config.res, model.channels], device='cuda')
    points = torch.cat([batch['xyz_fps_8192'], 0.1 * batch['normal_fps_8192']], dim=-1)
    noise = spatial_smoothing(points, noise, 32, 2, smooth_iter=10, use_taubin_smoothing=True)
    last = model.normalize_latents(torch.load(args.baseline / 'latent.pt', map_location='cpu', weights_only=True).cuda())
    cases = [('initial_t0', noise, 0.0), ('final_t1', last, 1.0)]
    references = {}
    for name, value, tick in cases:
        log('原生扩散前向：' + name)
        references[name] = tree_to(model(value, torch.tensor([tick], device='cuda'), condition_params=condition), 'cpu')
    install(model, 512)
    results = {}
    for name, value, tick in cases:
        log('分块扩散前向：' + name)
        results[name] = compare(model(value, torch.tensor([tick], device='cuda'), condition_params=condition), references[name])
    return dict(comparison=results, points=8192, time_points=[0.0, 1.0])


def decode(args):
    from squadgen.util.util import de_norm_pca
    ae, _ = official.load_ae(configuration(), 'cuda')
    cache = prepared(args)
    queries = cache['queries'].cuda()
    latent = torch.load(args.baseline / 'latent.pt', map_location='cpu', weights_only=True).cuda()
    log(f'官方原生 decode_in_chunks：{queries.shape[1]} 查询，块 {args.query_chunk}')
    out = official.decode_in_chunks(ae, latent, queries, args.query_chunk, False)
    fields = {key: value[0].float().cpu().numpy() for key, value in out.items()}
    fields.update(xyz=queries[0].cpu().numpy(), invT=cache['batch']['invT'][0])
    fields = de_norm_pca(fields, fields['invT'])
    for key in ['gdcdf', 'xyz', 'offset1', 'offset2', 'offset3', 'offsetb', 'offsetd']:
        fields.pop(key, None)
    np.savez(args.output / 'extract_mesh.npz', **fields)
    with np.load(args.baseline / 'extract_mesh.npz') as reference:
        result = compare(fields, dict(reference))
    return dict(comparison=result, native_attention=True, official_decode_in_chunks=True,
                query_chunk=args.query_chunk, queries=queries.shape[1])


def main():
    args = arguments()
    args.output.mkdir(parents=True, exist_ok=True)
    report = dict(status='running', stage=args.stage, reference='official functions, fixed cached inputs, same environment')
    started = time.monotonic()
    try:
        check_inputs(SimpleNamespace(input=ROOT / 'examples/test_data/3_holes.ply', output=args.baseline,
            res=8192, checkpoint_dir=ROOT / 'checkpoints/ckpts'))
        torch.set_num_threads(4)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.set_grad_enabled(False)
        torch.cuda.set_per_process_memory_fraction(16 * 1024**3 / torch.cuda.get_device_properties(0).total_memory)
        torch.cuda.reset_peak_memory_stats()
        with torch.no_grad():
            report.update({'encode': encode, 'forward': forward, 'decode': decode}[args.stage](args))
        report['status'] = 'completed'
    except Exception as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report.update(seconds=time.monotonic() - started, torch=str(torch.__version__),
            peak_allocated=torch.cuda.max_memory_allocated(), peak_reserved=torch.cuda.max_memory_reserved())
        save_json(args.output / (args.stage + '-comparison.json'), report)


if __name__ == '__main__':
    main()
