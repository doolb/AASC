"""将官方 CDFGen patchboard 样本编码为可校验的训练缓存。"""
import argparse
import json
from pathlib import Path
import shutil
import tempfile

import torch

from .adapter import json_hash, sha256, write_json
from .runtime import base_arguments, identity, make_model, seed_all, setup, tree_to


def validate_samples(samples):
    if not isinstance(samples, list) or not samples:
        raise ValueError('样本清单必须为非空数组')
    groups = {}
    for item in samples:
        asset, split = item.get('asset_id'), item.get('split')
        if not isinstance(asset, str) or not asset or split not in ('train', 'val', 'test'):
            raise ValueError('样本必须有 asset_id 与 train/val/test 分组')
        if asset in groups and groups[asset] != split:
            raise ValueError(f'同一资产跨分组泄漏：{asset}')
        groups[asset] = split


def validate_tensors(value, location='sample'):
    if isinstance(value, torch.Tensor):
        if not value.is_floating_point() or not torch.isfinite(value).all():
            raise ValueError(f'缓存张量不是有限浮点数：{location}')
        return
    if isinstance(value, dict):
        for key, tensor in value.items():
            validate_tensors(tensor, location + '.' + key)
        return
    if isinstance(value, list):
        for tensor in value:
            validate_tensors(tensor, location)
        return
    if value is not None:
        raise ValueError(f'缓存包含未约定对象：{location}')


def validate_encoded(sample, model):
    if set(sample) != {'latent', 'condition_params'}:
        raise ValueError('缓存需要且仅允许 latent 与 condition_params')
    validate_tensors(sample)
    if tuple(sample['latent'].shape) != (1, model.n_latents, model.channels):
        raise ValueError('latent 形状与模型/res 不一致')
    condition = sample['condition_params']
    if set(condition) != {'condition', 'condition_global', 'pe_latent'}:
        raise ValueError('条件字段不符合官方接口')
    if len(condition['condition_global']) != len(model.condition_global_keys_list):
        raise ValueError('全局条件数量不一致')
    for value in condition['condition_global']:
        if tuple(value.shape) != (1, 1):
            raise ValueError('全局条件形状应为 [1, 1]')
    pe = condition['pe_latent']
    if model.is_pecode_latent:
        if tuple(pe['code'].shape) != (1, model.n_latents, model.in_channels_cond):
            raise ValueError('几何条件 code 形状不匹配')
    raw = pe.get('raw_pe') if model.is_pecode_latent_pe else pe if model.is_pe_latent else None
    if raw is not None:
        shape = (1, model.n_latents, 3)
        if tuple(raw['input'].shape) != shape or tuple(raw['context_dict']['normal'].shape) != shape:
            raise ValueError('几何坐标/法线锚点不匹配')


class CachedDataset:
    """启动时验证清单和全部哈希，逐样本读取，避免数据全驻留内存。"""

    def __init__(self, root, expected_identity, model):
        self.root = Path(root).resolve()
        self.manifest = json.loads((self.root / 'manifest.json').read_text())
        if self.manifest.get('format_version') != 1 or self.manifest.get('base') != expected_identity:
            raise ValueError('缓存底模/编码配置不匹配')
        if self.manifest.get('res') != model.n_latents or self.manifest.get('latent') != 'raw-posterior-mode':
            raise ValueError('缓存 res 或 latent 约定不匹配')
        self.samples = self.manifest['samples']
        validate_samples(self.samples)
        self.model = model
        source_splits = {}
        for item in self.samples:
            filename = item['file']
            if Path(filename).name != filename or not filename.endswith('.pt'):
                raise ValueError('缓存路径必须为目录内的普通 .pt 文件名')
            path = self.root / filename
            if path.is_symlink() or sha256(path) != item['sha256']:
                raise ValueError(f'缓存指纹不匹配：{filename}')
            source = item['source_sha256']
            if source in source_splits and source_splits[source] != item['split']:
                raise ValueError('同一源文件以不同资产名称跨分组')
            source_splits[source] = item['split']
        self.fingerprint = json_hash(self.manifest)

    def indices(self, split):
        return [i for i, item in enumerate(self.samples) if item['split'] == split]

    def read(self, index):
        item = self.samples[index]
        path = self.root / item['file']
        # 训练过程中也拒绝被替换的缓存，恢复与连续训练的输入必须相同。
        if sha256(path) != item['sha256']:
            raise ValueError('缓存文件在训练过程中发生改变')
        sample = torch.load(path, weights_only=True, map_location='cpu')
        validate_encoded(sample, self.model)
        return sample


def build(args):
    import numpy as np
    from data_tools.test_load_new_format import load_patch_data_reformat
    setup(args)
    seed_all(args.seed)
    samples = json.loads(args.samples.read_text())
    validate_samples(samples)
    if args.output.exists():
        raise FileExistsError('缓存目录已存在，请使用新目录')
    if args.surface_points < 1:
        raise ValueError('surface-points 必须为正数')
    base = identity(args)
    helper = make_model(args, weights=False)
    ae = make_model(args, kind='ae')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.' + args.output.name + '-', dir=args.output.parent))
    try:
        records = []
        for index, item in enumerate(samples):
            source = (args.samples.parent / item['path']).resolve()
            source_hash = sha256(source)
            # 显式禁用 pickle；损坏样本直接报错，不沿用官方 Dataset 的无限跳过循环。
            with np.load(source, allow_pickle=False) as data:
                raw = load_patch_data_reformat(str(source), file=dict(data),
                    num_surface=args.surface_points, num_surface_query=1,
                    fps_num_list=[args.res, 4 * args.res], fps_return_type='first',
                    generator=np.random.default_rng(args.seed + index), is_add_noise=False)
            batch = {k: torch.from_numpy(np.array(v, dtype=np.float32, copy=True)).unsqueeze(0)
                     for k, v in raw.items()}
            batch['udf_query'] = torch.zeros(1, 1, 1)
            with torch.no_grad():
                result = helper.get_latent_and_condition(tree_to(batch, args.device), ae, is_mode=True)
            sample = tree_to({k: result[k] for k in ('latent', 'condition_params')}, 'cpu')
            validate_encoded(sample, helper)
            if sha256(source) != source_hash:
                raise RuntimeError('编码过程中源文件改变')
            filename = f'{index:06d}.pt'
            torch.save(sample, temporary / filename)
            records.append(dict(asset_id=item['asset_id'], split=item['split'], file=filename,
                                source_sha256=source_hash, source=str(source), sha256=sha256(temporary / filename)))
            print(f'编码完成 {index + 1}/{len(samples)}: {item["asset_id"]}', flush=True)
        manifest = dict(format_version=1, base=base, res=args.res, latent='raw-posterior-mode',
                        preprocessing=dict(seed=args.seed, surface_points=args.surface_points,
                                           loader_sha256=sha256(Path(load_patch_data_reformat.__code__.co_filename))),
                        samples=records)
        write_json(temporary / 'manifest.json', manifest)
        CachedDataset(temporary, base, helper)
        temporary.rename(args.output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base_arguments(parser)
    parser.add_argument('--samples', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--surface-points', type=int, default=16384)
    parser.add_argument('--seed', type=int, default=0)
    build(parser.parse_args())


if __name__ == '__main__':
    main()
