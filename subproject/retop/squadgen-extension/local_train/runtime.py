"""官方模型构造、身份与随机状态；不依赖语言模型或 PEFT。"""
from contextlib import redirect_stdout
import io
from pathlib import Path
import random
import subprocess
import types

import torch
from omegaconf import OmegaConf
from safetensors.torch import load_file

from .adapter import sha256

ROOT = Path(__file__).resolve().parents[1]


def base_arguments(parser):
    parser.add_argument('--base-id', default='squadgen-official')
    parser.add_argument('--base-weights', type=Path, default=ROOT / 'checkpoints/ckpts/sqdiffuse.safetensors')
    parser.add_argument('--ae-weights', type=Path, default=ROOT / 'checkpoints/ckpts/sqvae_geomae.safetensors')
    parser.add_argument('--base-config', type=Path, default=ROOT / 'checkpoints/ckpts/sqdiffuse.yaml')
    parser.add_argument('--ae-config', type=Path, default=ROOT / 'checkpoints/ckpts/sqvae_geomae.yaml')
    parser.add_argument('--res', type=int, default=1024)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cuda')
    parser.add_argument('--threads', type=int, default=2)


def setup(args):
    if not 1 <= args.res <= 12500 or args.threads < 1:
        raise ValueError('无效 res/threads')
    if args.device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('未发现 CUDA；需要 CPU 时请显式选择 --device cpu')
    torch.set_num_threads(args.threads)


def identity(args):
    files = {key: sha256(getattr(args, key)) for key in ('base_weights', 'ae_weights', 'base_config', 'ae_config')}
    source_names = ['squadgen/network/models_sit.py', 'squadgen/network/models_ae.py',
                    'squadgen/network/models_vae_joint.py', 'squadgen/network/utils.py',
                    'squadgen/network/transport/transport.py', 'squadgen/network/transport/path.py']
    commit = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    return dict(base_id=args.base_id, files=files, source_commit=commit,
                source_files={name: sha256(ROOT / name) for name in source_names},
                latent_convention='official-mode-raw-normalize-in-loss-v1')


def configs(args):
    ae = OmegaConf.load(args.ae_config).model.params
    diffusion = OmegaConf.load(args.base_config).model.params
    ae.latent_vae_params.num_latents = args.res
    ae.cond_vae_params.num_latents = args.res
    return ae, diffusion


def make_model(args, kind='diffusion', weights=True):
    from squadgen.network.models_sit import create_sqdiffuse_from_config
    from squadgen.network.models_vae_joint import create_joint_vae_from_config
    ae, diffusion = configs(args)
    constructors = {'diffusion': lambda: create_sqdiffuse_from_config(diffusion, ae),
                    'ae': lambda: create_joint_vae_from_config(ae)}
    with redirect_stdout(io.StringIO()), torch.device('meta'):
        model = constructors[kind]()
    if not weights:
        return model
    filename = args.base_weights if kind == 'diffusion' else args.ae_weights
    model.load_state_dict(load_file(filename, device='cpu'), strict=True, assign=True)
    if any(t.is_meta for t in list(model.parameters()) + list(model.buffers())):
        raise RuntimeError('严格加载后仍存在 meta 张量')
    return model.to(args.device).eval().requires_grad_(False)


def tree_to(value, device):
    if isinstance(value, torch.Tensor):
        return value.to(device)
    if isinstance(value, dict):
        return {k: tree_to(v, device) for k, v in value.items()}
    if isinstance(value, list):
        return [tree_to(v, device) for v in value]
    return value


def enable_checkpointing(model):
    from torch.utils.checkpoint import checkpoint
    for block in model.blocks:
        if hasattr(block, '_local_original_forward'):
            continue
        block._local_original_forward = block.forward

        def forward(self, x, c):
            if self.training and torch.is_grad_enabled():
                return checkpoint(self._local_original_forward, x, c, use_reentrant=False)
            return self._local_original_forward(x, c)

        block.forward = types.MethodType(forward, block)


def seed_all(seed):
    random.seed(seed)
    torch.manual_seed(seed)


def rng_state():
    return dict(python=random.getstate(), torch=torch.get_rng_state(),
                cuda=torch.cuda.get_rng_state_all() if torch.cuda.is_available() else [])


def restore_rng(state):
    random.setstate(state['python'])
    torch.set_rng_state(state['torch'])
    if state['cuda']:
        if not torch.cuda.is_available() or len(state['cuda']) != torch.cuda.device_count():
            raise ValueError('CUDA 随机状态与当前设备不兼容')
        torch.cuda.set_rng_state_all(state['cuda'])
