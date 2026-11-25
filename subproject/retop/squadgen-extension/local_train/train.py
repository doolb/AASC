"""缓存上的单设备 LoRA 训练；官方 Linear/velocity 损失与严格断点恢复。"""
import argparse
from contextlib import nullcontext
import json
import math
from pathlib import Path
import time
import traceback

import torch

from .adapter import adapter_parameters, config_for, inject, load_adapter, read_bundle, save_bundle, sha256, write_json
from .cache import CachedDataset
from .runtime import (base_arguments, enable_checkpointing, identity, make_model, restore_rng,
                      rng_state, seed_all, setup, tree_to)


class SampleOrder:
    """独立随机生成器与持久化游标，梯度累积跨 epoch 也能准确恢复。"""

    def __init__(self, indices, seed):
        if not indices:
            raise ValueError('没有 train 分组样本')
        self.indices = list(indices)
        self.generator = torch.Generator().manual_seed(seed)
        self.order = []
        self.cursor = 0

    def next(self):
        if self.cursor == len(self.order):
            self.order = [self.indices[i] for i in torch.randperm(len(self.indices), generator=self.generator).tolist()]
            self.cursor = 0
        result = self.order[self.cursor]
        self.cursor += 1
        return result

    def state(self):
        return dict(indices=self.indices, order=self.order, cursor=self.cursor, rng=self.generator.get_state())

    def restore(self, state):
        if state['indices'] != self.indices or sorted(state['order']) != sorted(self.indices):
            raise ValueError('恢复数据顺序与训练分组不一致')
        if not 0 <= state['cursor'] <= len(state['order']):
            raise ValueError('恢复游标越界')
        self.order, self.cursor = state['order'], state['cursor']
        self.generator.set_state(state['rng'])


class Trainer:
    def __init__(self, model, dataset, contract):
        from squadgen.network.transport import create_transport
        self.model, self.dataset, self.contract = model, dataset, contract
        self.device = contract['device']
        self.params = adapter_parameters(model)
        if not self.params or {id(p) for p in self.params} != {id(p) for p in model.parameters() if p.requires_grad}:
            raise ValueError('优化器参数必须且只能包含 LoRA')
        self.optimizer = torch.optim.AdamW(self.params, lr=contract['lr'], weight_decay=contract['weight_decay'])
        self.scheduler = torch.optim.lr_scheduler.LambdaLR(self.optimizer, lambda _: 1.0)
        self.scaler = torch.amp.GradScaler('cuda', enabled=contract['precision'] == 'fp16')
        self.order = SampleOrder(dataset.indices('train'), contract['seed'])
        self.transport = create_transport('Linear', 'velocity', None)
        self.step = 0
        if contract['checkpointing']:
            enable_checkpointing(model)

    def autocast(self):
        return torch.autocast('cuda', dtype=torch.float16) if self.contract['precision'] == 'fp16' else nullcontext()

    def loss(self, sample, drop=False):
        sample = tree_to(sample, self.device)
        condition = sample['condition_params']
        if drop:
            condition = dict(condition, condition_global=[-torch.ones_like(t) for t in condition['condition_global']])
        with self.autocast():
            normalized = self.model.normalize_latents(sample['latent'])
            loss = self.transport.training_losses(self.model, normalized, {'condition_params': condition})['loss'].mean()
        if not torch.isfinite(loss):
            raise FloatingPointError('训练/验证损失非有限数')
        return loss

    def update(self):
        self.model.train()
        self.optimizer.zero_grad(set_to_none=True)
        losses, selected = [], []
        for _ in range(self.contract['accumulation']):
            index = self.order.next()
            selected.append(index)
            drop = bool(torch.rand(()) < self.contract['drop_prob'])
            loss = self.loss(self.dataset.read(index), drop=drop)
            self.scaler.scale(loss / self.contract['accumulation']).backward()
            losses.append(float(loss.detach()))
        self.scaler.unscale_(self.optimizer)
        # 对非有限梯度明确失败，不把跳过的更新计作已完成步数。
        norm = torch.nn.utils.clip_grad_norm_(self.params, self.contract['clip_grad'], error_if_nonfinite=True)
        self.scaler.step(self.optimizer)
        self.scaler.update()
        self.scheduler.step()
        self.optimizer.zero_grad(set_to_none=True)
        self.step += 1
        return dict(step=self.step, loss=sum(losses) / len(losses), grad_norm=float(norm), samples=selected)

    def validate(self):
        indices = self.dataset.indices('val')
        if not indices:
            raise ValueError('必须提供按基础资产隔离的 val 样本')
        saved = rng_state()
        was_training = self.model.training
        try:
            seed_all(12345)
            self.model.eval()
            with torch.no_grad():
                values = [float(self.loss(self.dataset.read(i))) for i in indices]
            return dict(latent_velocity_mse=sum(values) / len(values), samples=len(values), geometry_validated=False)
        finally:
            self.model.train(was_training)
            restore_rng(saved)

    def save(self, destination, base, validation=None):
        state = dict(format_version=1, contract=self.contract, step=self.step,
                     optimizer=self.optimizer.state_dict(), scheduler=self.scheduler.state_dict(),
                     scaler=self.scaler.state_dict(), random=rng_state(), order=self.order.state())
        metadata = dict(step=self.step, contract=self.contract, validation=validation)
        return save_bundle(destination, self.model, base, metadata, state)

    def restore(self, source, base):
        manifest, config, weights = read_bundle(source, base)
        if self.model._local_lora_config != config:
            raise ValueError('恢复适配器配置与当前模型不一致')
        if 'training_state.pt' not in manifest['files']:
            raise ValueError('只有推理权重；请用 --init-adapter 开始新训练阶段')
        state = torch.load(Path(source) / 'training_state.pt', map_location='cpu', weights_only=True)
        if state['format_version'] != 1 or state['contract'] != self.contract:
            raise ValueError('续训配置、数据指纹、设备或精度不匹配')
        if state['step'] != manifest['metadata']['step']:
            raise ValueError('续训步数与清单不一致')
        # 原位恢复增量，保持 optimizer 对参数对象的引用，调用者不必提前加载同一权重。
        parameters = dict(self.model.named_parameters())
        with torch.no_grad():
            for name, value in weights.items():
                parameters[name].copy_(value)
        self.optimizer.load_state_dict(state['optimizer'])
        self.scheduler.load_state_dict(state['scheduler'])
        self.scaler.load_state_dict(state['scaler'])
        self.order.restore(state['order'])
        self.step = state['step']
        restore_rng(state['random'])


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    base_arguments(parser)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--steps', type=int, default=100)
    parser.add_argument('--save-every', type=int, default=25)
    parser.add_argument('--rank', type=int, default=8)
    parser.add_argument('--alpha', type=float, default=8)
    parser.add_argument('--dropout', type=float, default=0)
    parser.add_argument('--lr', type=float, default=1e-4)
    parser.add_argument('--weight-decay', type=float, default=0.01)
    parser.add_argument('--accumulation', type=int, default=8)
    parser.add_argument('--clip-grad', type=float, default=1)
    parser.add_argument('--drop-prob', type=float, default=0.1)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--precision', choices=['fp16', 'fp32'], default='fp16')
    parser.add_argument('--checkpointing', action=argparse.BooleanOptionalAction, default=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--resume', type=Path)
    group.add_argument('--init-adapter', type=Path)
    return parser.parse_args()


def run(args):
    setup(args)
    if min(args.steps, args.save_every, args.accumulation) < 1:
        raise ValueError('steps/save-every/accumulation 必须为正数')
    if any(not math.isfinite(v) for v in (args.lr, args.weight_decay, args.clip_grad, args.drop_prob)):
        raise ValueError('训练参数必须为有限数')
    if args.lr <= 0 or args.weight_decay < 0 or args.clip_grad <= 0 or not 0 <= args.drop_prob <= 1:
        raise ValueError('学习率、衰减、裁剪或条件丢弃率无效')
    if args.device == 'cpu' and args.precision != 'fp32':
        raise ValueError('CPU 训练需要 --precision fp32')
    args.output.mkdir(parents=True, exist_ok=False)
    report = dict(status='running', geometry_validated=False, cuda_tested=args.device == 'cuda')
    started = time.monotonic()
    try:
        seed_all(args.seed)
        base = identity(args)
        model = make_model(args)
        config = config_for(model, args.rank, args.alpha, args.dropout)
        initial = args.resume or args.init_adapter
        if initial:
            load_adapter(model, initial, base)
            if model._local_lora_config != config:
                raise ValueError('请提供与已有适配器相同的 rank/alpha/dropout')
        else:
            inject(model, config)
        dataset = CachedDataset(args.cache, base, model)
        if not dataset.indices('val'):
            raise ValueError('缓存必须包含留出 val 分组')
        contract = {key: getattr(args, key) for key in ('res', 'device', 'precision', 'lr', 'weight_decay',
                    'accumulation', 'clip_grad', 'drop_prob', 'seed', 'checkpointing', 'threads')}
        contract.update(cache_fingerprint=dataset.fingerprint, adapter=config, torch_version=str(torch.__version__),
                        implementation={name: sha256(Path(__file__).parent / name)
                                        for name in ('adapter.py', 'runtime.py', 'cache.py', 'train.py')})
        trainer = Trainer(model, dataset, contract)
        if args.resume:
            trainer.restore(args.resume, base)
        if args.steps <= trainer.step:
            raise ValueError('--steps 是目标总步数，必须大于已恢复步数')
        if args.device == 'cuda':
            torch.cuda.reset_peak_memory_stats()
        report.update(trainable_parameters=sum(p.numel() for p in trainer.params), base=base,
                      initial_validation=trainer.validate(), contract=contract)
        write_json(args.output / 'report.json', report)
        with (args.output / 'metrics.jsonl').open('a') as log:
            while trainer.step < args.steps:
                metrics = trainer.update()
                metrics['elapsed_seconds'] = time.monotonic() - started
                log.write(json.dumps(metrics) + '\n')
                log.flush()
                print(json.dumps(metrics), flush=True)
                if trainer.step % args.save_every == 0 or trainer.step == args.steps:
                    validation = trainer.validate()
                    destination = args.output / f'step-{trainer.step:06d}'
                    trainer.save(destination, base, validation)
                    report.update(last_checkpoint=str(destination), step=trainer.step, validation=validation)
                    write_json(args.output / 'report.json', report)
        if identity(args) != base:
            raise RuntimeError('训练过程中底模或源码文件发生改变')
        report['status'] = 'completed'
    except Exception as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        if args.device == 'cuda':
            report.update(cuda_peak_allocated=torch.cuda.max_memory_allocated(), cuda_peak_reserved=torch.cuda.max_memory_reserved())
        write_json(args.output / 'report.json', report)


if __name__ == '__main__':
    run(arguments())
