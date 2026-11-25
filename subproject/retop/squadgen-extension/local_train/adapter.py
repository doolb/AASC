"""冻结底模、注入 LoRA、严格校验与原子发布；不合并或覆盖底模。"""
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile

import torch
from torch import nn
from safetensors.torch import load_file, save_file

FORMAT = 1
TARGET = re.compile(r"blocks\.\d+\.attn\.(qkv|proj)")


def sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def json_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n')


class LoRALinear(nn.Module):
    """底层参数只读；FP32 增量配合 autocast，初始 B=0 保持原输出。"""

    def __init__(self, base, rank, alpha, dropout):
        super().__init__()
        self.base = base.requires_grad_(False)
        self.lora_A = nn.Parameter(torch.empty(rank, base.in_features, device=base.weight.device))
        self.lora_B = nn.Parameter(torch.zeros(base.out_features, rank, device=base.weight.device))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        self.dropout = nn.Dropout(dropout)
        self.scale = alpha / rank
        self.enabled = True

    def forward(self, x):
        result = self.base(x)
        if not self.enabled:
            return result
        delta = torch.nn.functional.linear(self.dropout(x.to(self.lora_A.dtype)), self.lora_A)
        delta = torch.nn.functional.linear(delta, self.lora_B)
        return result + (delta * self.scale).to(result.dtype)


def targets(model):
    found = {}
    for name, module in model.named_modules():
        if TARGET.fullmatch(name):
            base = module.base if isinstance(module, LoRALinear) else module
            if not isinstance(base, nn.Linear):
                raise ValueError(f'目标不是线性层：{name}')
            found[name] = [base.out_features, base.in_features]
    if not found:
        raise ValueError('没有匹配到 SQ-Diffuse attention qkv/proj')
    expected = {f'blocks.{i}.attn.{part}' for i in range(len(model.blocks)) for part in ('qkv', 'proj')}
    if set(found) != expected:
        raise ValueError('attention 层数量/路径不完整')
    return found


def config_for(model, rank=8, alpha=8.0, dropout=0.0):
    config = dict(format_version=FORMAT, rank=rank, alpha=alpha, dropout=dropout,
                  scaling='alpha/r', targets=targets(model), condition_modules=[])
    validate_config(config)
    return config


def validate_config(config):
    if set(config) != {'format_version', 'rank', 'alpha', 'dropout', 'scaling', 'targets', 'condition_modules'}:
        raise ValueError('未知或缺失的适配器配置字段')
    if config['format_version'] != FORMAT or config['scaling'] != 'alpha/r':
        raise ValueError('不支持的适配器格式/缩放')
    if config['condition_modules']:
        raise ValueError('首版不支持额外条件模块，拒绝丢弃权重')
    rank, alpha, dropout = config['rank'], config['alpha'], config['dropout']
    if type(rank) is not int or rank < 1:
        raise ValueError('rank 必须为正整数')
    if not math.isfinite(alpha) or alpha <= 0 or not math.isfinite(dropout) or not 0 <= dropout < 1:
        raise ValueError('alpha/dropout 无效')
    for name, shape in config['targets'].items():
        if not TARGET.fullmatch(name) or len(shape) != 2 or any(type(n) is not int or n <= 0 for n in shape):
            raise ValueError('目标层描述无效')
        if rank > min(shape):
            raise ValueError(f'rank 大于目标层维度：{name}')


def remove_adapter(model):
    # 只撤下增量包装，底层参数从未被相加，切换不会积累历史增量。
    for name, module in list(model.named_modules()):
        if isinstance(module, LoRALinear):
            parent, leaf = name.rsplit('.', 1)
            setattr(model.get_submodule(parent), leaf, module.base)
    model.requires_grad_(False)
    model.__dict__.pop('_local_lora_config', None)


def inject(model, config):
    validate_config(config)
    if targets(model) != config['targets']:
        raise ValueError('底模目标层名称或形状不匹配')
    remove_adapter(model)
    for name in config['targets']:
        parent, leaf = name.rsplit('.', 1)
        module = model.get_submodule(name)
        setattr(model.get_submodule(parent), leaf, LoRALinear(module, config['rank'], config['alpha'], config['dropout']))
    model._local_lora_config = json.loads(json.dumps(config))
    return model


def adapter_parameters(model):
    return [p for name, p in model.named_parameters() if name.endswith(('.lora_A', '.lora_B'))]


def adapter_state(model):
    return {name: value.detach().cpu().contiguous().clone() for name, value in model.named_parameters()
            if name.endswith(('.lora_A', '.lora_B'))}


def validate_state(state, config):
    expected = {}
    for name, (out_size, in_size) in config['targets'].items():
        expected[name + '.lora_A'] = (config['rank'], in_size)
        expected[name + '.lora_B'] = (out_size, config['rank'])
    if set(state) != set(expected):
        raise ValueError('LoRA 权重缺键或多键')
    for key, shape in expected.items():
        tensor = state[key]
        if tuple(tensor.shape) != shape or tensor.dtype != torch.float32 or not torch.isfinite(tensor).all():
            raise ValueError(f'LoRA 张量形状、精度或有限性不合法：{key}')


def save_bundle(path, model, identity, metadata=None, training_state=None):
    """新版本只发布到不存在的目录，失败不破坏旧产物。"""
    path = Path(path)
    if path.exists():
        raise FileExistsError(f'不覆盖已有版本：{path}')
    config = model._local_lora_config
    validate_config(config)
    state = adapter_state(model)
    validate_state(state, config)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.' + path.name + '-', dir=path.parent))
    try:
        save_file(state, temporary / 'adapter_model.safetensors')
        write_json(temporary / 'adapter_config.json', config)
        names = ['adapter_model.safetensors', 'adapter_config.json']
        if training_state is not None:
            torch.save(training_state, temporary / 'training_state.pt')
            names.append('training_state.pt')
        manifest = dict(format_version=FORMAT, base=identity, metadata=metadata or {},
                        files={name: sha256(temporary / name) for name in names})
        write_json(temporary / 'manifest.json', manifest)
        # 回读校验之后发布，临时目录与最终目录处于同一文件系统。
        read_bundle(temporary, identity)
        if path.exists():
            raise FileExistsError(path)
        temporary.rename(path)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return path


def read_bundle(path, identity):
    path = Path(path)
    manifest = json.loads((path / 'manifest.json').read_text())
    if manifest.get('format_version') != FORMAT or manifest.get('base') != identity:
        raise ValueError('底模/AE/源码或配置指纹不匹配')
    required = {'adapter_model.safetensors', 'adapter_config.json'}
    names = set(manifest['files'])
    if not required <= names or names - required - {'training_state.pt'}:
        raise ValueError('产物清单缺失或包含不支持文件')
    for name, digest in manifest['files'].items():
        if sha256(path / name) != digest:
            raise ValueError(f'文件指纹不匹配：{name}')
    config = json.loads((path / 'adapter_config.json').read_text())
    validate_config(config)
    state = load_file(path / 'adapter_model.safetensors', device='cpu')
    validate_state(state, config)
    return manifest, config, state


def load_adapter(model, path, identity):
    manifest, config, state = read_bundle(path, identity)
    # 在改变当前模型前完成全部校验，失败不会留下半加载的适配器。
    if targets(model) != config['targets']:
        raise ValueError('模型结构与适配器不一致')
    inject(model, config)
    params = dict(model.named_parameters())
    with torch.no_grad():
        for name, value in state.items():
            params[name].copy_(value)
    return manifest
