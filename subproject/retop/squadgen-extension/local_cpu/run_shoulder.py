#!/usr/bin/env python3
"""官方 SQuadGen 的分阶段 CPU 试验入口；参数化输入，不把肩甲坐标写入算法。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
try:
    import resource
except ImportError:
    # Windows 没有 resource；GPU 入口仍复用本文件的模型构造与格式处理。
    resource = None
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', choices=['all', 'prepare', 'encode', 'sample', 'decode', 'extract'], default='all')
    parser.add_argument('--res', type=int, default=512)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--remesh-percent', type=float, default=0.4)
    parser.add_argument('--query-chunk', type=int, default=2048)
    parser.add_argument('--solver', choices=['dopri5', 'rk4', 'euler'], default='dopri5')
    parser.add_argument('--steps', type=int, default=50)
    parser.add_argument('--adapter', type=Path, help='可选 LoRA 产物目录；加载前严格检查底模/AE 指纹')
    parser.add_argument('--base-id', default='squadgen-official')
    parser.add_argument('--checkpoint-dir', type=Path, default=ROOT / 'checkpoints/ckpts')
    args = parser.parse_args()
    if not 32 <= args.res <= 12500 or args.steps < 2 or args.query_chunk < 1 or args.remesh_percent <= 0:
        parser.error('无效的采样规模、积分步数、查询块或重网格化比例')
    args.input = args.input.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    return args


def log(message):
    print(time.strftime('%H:%M:%S'), message, flush=True)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def configuration(args):
    from omegaconf import OmegaConf
    ae = OmegaConf.load(args.checkpoint_dir / 'sqvae_geomae.yaml')
    diffusion = OmegaConf.load(args.checkpoint_dir / 'sqdiffuse.yaml')
    ae.model.params.latent_vae_params.num_latents = args.res
    ae.model.params.cond_vae_params.num_latents = args.res
    return ae.model.params, diffusion.model.params


def make_ae(args):
    import torch
    from squadgen.network.models_vae_joint import create_joint_vae_from_config
    ae_config, _ = configuration(args)
    with torch.device('meta'):
        model = create_joint_vae_from_config(ae_config)
    return load_weights(model, 'sqvae_geomae', args)


def make_diffusion(args, weights=True):
    import torch
    from squadgen.network.models_sit import create_sqdiffuse_from_config
    ae_config, diffusion_config = configuration(args)
    with torch.device('meta'):
        model = create_sqdiffuse_from_config(diffusion_config, ae_config)
    if not weights:
        return model
    model = load_weights(model, 'sqdiffuse', args)
    if args.adapter:
        from types import SimpleNamespace
        from local_train.adapter import load_adapter
        from local_train.runtime import identity
        base_args = SimpleNamespace(base_id=args.base_id,
            base_weights=args.checkpoint_dir / 'sqdiffuse.safetensors',
            ae_weights=args.checkpoint_dir / 'sqvae_geomae.safetensors',
            base_config=args.checkpoint_dir / 'sqdiffuse.yaml',
            ae_config=args.checkpoint_dir / 'sqvae_geomae.yaml')
        manifest = load_adapter(model, args.adapter, identity(base_args))
        model.eval().requires_grad_(False)
        save_json(args.output / 'adapter-info.json', {
            'path': str(args.adapter.resolve()), 'base': manifest['base'],
            'adapter_files': manifest['files'], 'training_metadata': manifest['metadata'],
        })
        log('已严格加载 LoRA：' + str(args.adapter))
    return model


def load_weights(model, name, args):
    from safetensors.torch import load_file
    log('映射官方权重 ' + name)
    state = load_file(args.checkpoint_dir / f'{name}.safetensors', device='cpu')
    model.load_state_dict(state, strict=True, assign=True)
    model.eval().requires_grad_(False)
    if any(t.is_meta for t in list(model.parameters()) + list(model.buffers())):
        raise RuntimeError('权重加载后仍存在 meta 张量')
    return model


def prepare(args):
    import numpy as np
    import torch
    import trimesh
    from squadgen.util.util import sample_points_on_mesh, load_data, create_batch_from_data, get_triangle_centers
    log('原高模表面采样与 CPU FPS')
    sample_file = args.output / 'sampled_points.npz'
    sample_points_on_mesh(str(args.input), str(sample_file), [args.res, args.res * 4])
    batch = create_batch_from_data(load_data(str(sample_file)), args.res)
    # 不使用上游会吞掉异常并返回零点的包装层，预处理错误必须中止。
    log(f'表面代理重网格化：目标边长 = 包围盒对角线的 {args.remesh_percent}%')
    proxy = args.output / 'gt_mesh_subdiv.obj'
    centers = get_triangle_centers(str(args.input), str(proxy), percentage=args.remesh_percent)
    inv_transform = batch['invT'][0]
    queries = np.linalg.solve(inv_transform[:, :3], (centers - inv_transform[:, 3]).T).T
    queries = torch.from_numpy(queries.astype(np.float32)).unsqueeze(0)
    torch.save({'batch': batch, 'queries': queries}, args.output / 'prepared.pt')
    mesh = trimesh.load_mesh(proxy, process=False)
    save_json(args.output / 'prepare-info.json', {
        'input_sha256': digest(args.input), 'proxy_vertices': len(mesh.vertices),
        'proxy_triangles': len(mesh.faces), 'query_count': len(centers),
        'proxy_watertight': bool(mesh.is_watertight), 'res': args.res,
        'remesh_percent': args.remesh_percent, 'official_query_remesh_percent': 0.2,
        'fps': 'CPU greedy, start index 0; index-order tie break',
    })
    log(f'准备完成：{len(centers)} 个表面查询点')


def read_prepared(args):
    import torch
    # 文件只由本入口产生；其中 invT 含 numpy，因此仅此受信任的本地缓存关闭 weights_only。
    return torch.load(args.output / 'prepared.pt', map_location='cpu', weights_only=False)


def encode(args):
    import torch
    prepared = read_prepared(args)
    ae = make_ae(args)
    # 此官方方法只访问扩散网络的配置属性，不执行它的权重；用 meta 模型避免同时驻留双模型。
    helper = make_diffusion(args, weights=False)
    log('Geometry AE 编码')
    result = helper.get_latent_and_condition(prepared['batch'], ae, is_mode=True, is_run_sqvae=False)
    torch.save(result['condition_params'], args.output / 'condition.pt')
    log('几何条件保存完成')


def sample(args):
    import torch
    from squadgen.network.models_sit import StackedRandomGenerator
    from squadgen.network.transport import Sampler, create_transport
    from squadgen.util.util import spatial_smoothing
    condition = torch.load(args.output / 'condition.pt', weights_only=True, map_location='cpu')
    batch = read_prepared(args)['batch']
    model = make_diffusion(args)
    random = StackedRandomGenerator(torch.device('cpu'), [args.seed])
    latent = random.randn([1, model.n_latents, model.channels], device='cpu')
    points = torch.cat([batch[f'xyz_fps_{args.res}'], 0.1 * batch[f'normal_fps_{args.res}']], dim=-1)
    latent = spatial_smoothing(points, latent, 32, 2, smooth_iter=10, use_taubin_smoothing=True)
    sampler = Sampler(create_transport('Linear', 'velocity', None))
    solver = sampler.sample_ode(sampling_method=args.solver, num_steps=args.steps)
    evaluations = 0
    start = time.monotonic()

    def forward(x, t, **kwargs):
        nonlocal evaluations
        evaluations += 1
        tick = time.monotonic()
        output = model(x, t, **kwargs)
        if not torch.isfinite(output['x']).all():
            raise RuntimeError('扩散网络出现非有限输出')
        log(f'扩散评估 {evaluations}：t={t[0].item():.5f}，本次 {time.monotonic()-tick:.1f}s，总计 {time.monotonic()-start:.1f}s')
        return output

    latent = model.denormalize_latents(solver(latent, forward, condition_params=condition)[-1]).float()
    torch.save(latent, args.output / 'latent.pt')
    save_json(args.output / 'sample-info.json', {
        'network_evaluations': evaluations, 'solver': args.solver, 'saved_time_points': args.steps,
        'atol': 1e-6, 'rtol': 1e-3, 'res': args.res, 'seed': args.seed,
        'seconds': time.monotonic() - start, 'dtype': 'float32',
    })


def decode(args):
    import numpy as np
    import torch
    from squadgen.util.util import de_norm_pca
    prepared = read_prepared(args)
    latent = torch.load(args.output / 'latent.pt', weights_only=True, map_location='cpu')
    ae = make_ae(args)
    queries = prepared['queries']
    log('SQ-VAE 布局场解码')
    # 最后特征与查询坐标无关。先与原始 decode_batch 比较，确认缓存不会更改网络计算。
    features = ae.latent_vae.return_last_features(latent)
    test_queries = queries[:, :16]
    official = ae.latent_vae.decode_batch(latent, {'xyz_query': test_queries})
    cached = ae.latent_vae.query_last_features(features, test_queries)
    for key in official:
        torch.testing.assert_close(cached[key], official[key], rtol=1e-5, atol=1e-6)
    chunks = {}
    for start in range(0, queries.shape[1], args.query_chunk):
        output = ae.latent_vae.query_last_features(features, queries[:, start:start+args.query_chunk])
        for key, value in output.items():
            if not torch.isfinite(value).all():
                raise RuntimeError('解码场存在非有限数据：' + key)
            chunks.setdefault(key, []).append(value[0].numpy())
        if start % (args.query_chunk * 10) == 0:
            log(f'解码 {min(start+args.query_chunk,queries.shape[1])}/{queries.shape[1]}')
    fields = {key: np.concatenate(value) for key, value in chunks.items()}
    fields['xyz'] = queries[0].numpy()
    fields['invT'] = prepared['batch']['invT'][0]
    fields = de_norm_pca(fields, fields['invT'])
    for key in ['gdcdf', 'xyz', 'offset1', 'offset2', 'offset3', 'offsetb', 'offsetd']:
        fields.pop(key, None)
    np.savez(args.output / 'extract_mesh.npz', **fields)
    save_json(args.output / 'decode-info.json', {
        'queries': queries.shape[1], 'chunk_size': args.query_chunk,
        'cached_features_match_official_decode': True,
        'fields': {k: list(v.shape) for k, v in fields.items()},
    })


def extract(args):
    from plyfile import PlyData
    output = args.output / 'extracted_quad.ply'
    command = [str(ROOT / 'QuadTools/build/QuadExtraction'),
               '-i', str(args.output / 'gt_mesh_subdiv.obj'),
               '-f', str(args.output / 'extract_mesh.npz'), '-o', str(output),
               '--ringsize=8', '--verbose=true', '-a', '150', '--div=0',
               '-t', '0.1', '-s', '3', '-r', '15']
    log('运行真实 QuadExtraction：' + ' '.join(command))
    subprocess.run(command, check=True, cwd=ROOT)
    if not output.is_file():
        raise RuntimeError('提取工具没有生成实际网格')
    mesh = PlyData.read(output)
    faces = mesh['face']['vertex_indices']
    if len(faces) == 0:
        raise RuntimeError('输出网格为空')
    counts = {}
    for face in faces:
        counts[str(len(face))] = counts.get(str(len(face)), 0) + 1
    vertices = mesh['vertex']
    with (args.output / 'extracted_quad.obj').open('w') as stream:
        stream.write('# SQuadGen candidate; native polygon topology retained\n')
        for vertex in vertices:
            stream.write(f"v {vertex['x']:.9g} {vertex['y']:.9g} {vertex['z']:.9g}\n")
        for face in faces:
            stream.write('f ' + ' '.join(str(int(index)+1) for index in face) + '\n')
    quality = subprocess.run([str(ROOT / 'QuadTools/build/QuadQuality'), '-i', str(output),
                              '-j', str(args.output), '-v'], cwd=ROOT, check=False)
    save_json(args.output / 'extraction-info.json', {
        'vertices': len(vertices), 'faces': len(faces), 'face_degree_counts': counts,
        'all_quads': set(counts) == {'4'}, 'quad_quality_exit_code': quality.returncode,
        'status': 'candidate-generated-not-yet-accepted',
    })
    log(f'实际生成网格：{len(vertices)} 顶点，{len(faces)} 面；面边数统计 {counts}')


def main():
    args = arguments()
    original_hash = digest(args.input)
    started = time.monotonic()
    report = {'stage': args.stage, 'status': 'running', 'input_sha256': original_hash,
              'arguments': {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}}
    report_path = args.output / f'{args.stage}-status.json'
    save_json(report_path, report)
    try:
        if args.stage == 'all':
            for stage in ['prepare', 'encode', 'sample', 'decode', 'extract']:
                log('启动独立阶段：' + stage)
                # 每阶段独立进程，使 mmap 权重与临时张量在阶段结束后完全释放。
                subprocess.run([sys.executable, '-u', str(Path(__file__).resolve()), *sys.argv[1:], '--stage', stage], check=True, cwd=ROOT)
        else:
            os.environ['OMP_NUM_THREADS'] = str(args.threads)
            os.environ['OPENBLAS_NUM_THREADS'] = str(args.threads)
            import torch
            torch.set_num_threads(args.threads)
            torch.set_num_interop_threads(1)
            with torch.no_grad():
                {'prepare': prepare, 'encode': encode, 'sample': sample, 'decode': decode, 'extract': extract}[args.stage](args)
        if digest(args.input) != original_hash:
            raise RuntimeError('原输入指纹改变')
        report['status'] = 'completed'
    except Exception as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        report['process_peak_rss_mib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 if resource else None
        report['source_unchanged'] = digest(args.input) == original_hash
        save_json(report_path, report)


if __name__ == '__main__':
    main()
