"""在缩小的真实 SiT 上验证训练/恢复与严格读写，不把数值测试当成几何质量测试。"""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

import torch
from safetensors.torch import load_file, save_file

from .adapter import (adapter_parameters, adapter_state, config_for, inject, load_adapter,
                      read_bundle, remove_adapter, save_bundle, sha256, write_json)
from .cache import CachedDataset, validate_encoded, validate_samples
from .runtime import enable_checkpointing, seed_all
from .train import Trainer


def tiny_model():
    from squadgen.network.models_sit import SiT
    seed_all(12)
    model = SiT(n_latents=8, in_channels=4, depth=2, n_heads=2, d_head=8,
                in_channels_cond=6, is_pecode_latent=1, is_pecode_latent_pe=1,
                target_mu=[0.1] * 4, target_std=[1.2] * 4)
    # 新初始化 SiT 的输出层/门控为零；模拟已预训练的非零底模以检验真正的 LoRA 梯度。
    with torch.no_grad():
        torch.nn.init.normal_(model.final_layer.linear.weight, std=0.1)
        for block in model.blocks:
            torch.nn.init.normal_(block.adaLN_modulation[-1].weight, std=0.1)
    return model.eval().requires_grad_(False)


def sample():
    return dict(latent=torch.randn(1, 8, 4), condition_params=dict(condition=None, condition_global=[],
        pe_latent=dict(code=torch.randn(1, 8, 6), raw_pe=dict(input=torch.randn(1, 8, 3),
                      context_dict=dict(normal=torch.randn(1, 8, 3))))))


class MemoryDataset:
    def __init__(self):
        self.items = [sample() for _ in range(4)]

    def indices(self, split):
        return {'train': [0, 1, 2], 'val': [3], 'test': []}[split]

    def read(self, index):
        return copy.deepcopy(self.items[index])


def contract(checkpointing=True):
    return dict(device='cpu', precision='fp32', lr=1e-3, weight_decay=0.01, accumulation=2,
                clip_grad=1, drop_prob=0.1, seed=3, checkpointing=checkpointing)


class LoRATest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.base = {'base_id': 'test-base', 'files': {'base_weights': 'fixture'}}
        self.model = tiny_model()
        self.data = MemoryDataset()
        self.config = config_for(self.model, rank=2, alpha=2, dropout=0.1)

    def tearDown(self):
        self.directory.cleanup()

    def output(self, model):
        model.eval()
        item = self.data.read(0)
        with torch.no_grad():
            return model(item['latent'], torch.tensor([0.3]), item['condition_params'])['x']

    def trained(self):
        inject(self.model, self.config)
        trainer = Trainer(self.model, self.data, contract())
        trainer.update()
        return trainer

    def test_zero_disable_freeze_roundtrip_switch(self):
        original = copy.deepcopy(self.model.state_dict())
        baseline = self.output(self.model)
        inject(self.model, self.config)
        torch.testing.assert_close(self.output(self.model), baseline, rtol=0, atol=0)
        trainer = Trainer(self.model, self.data, contract())
        metrics = trainer.update()
        self.assertGreater(metrics['grad_norm'], 0)
        self.assertTrue(any(torch.count_nonzero(v) for k, v in adapter_state(self.model).items() if k.endswith('lora_B')))
        expected = self.output(self.model)
        self.assertFalse(torch.equal(expected, baseline))
        destination = save_bundle(self.root / 'adapter', self.model, self.base)
        state = load_file(destination / 'adapter_model.safetensors')
        self.assertEqual(set(state), set(adapter_state(self.model)))
        for module in self.model.modules():
            if hasattr(module, 'enabled'):
                module.enabled = False
        torch.testing.assert_close(self.output(self.model), baseline, rtol=0, atol=0)
        for _ in range(2):
            load_adapter(self.model, destination, self.base)
            torch.testing.assert_close(self.output(self.model), expected, rtol=0, atol=0)
        remove_adapter(self.model)
        for key, value in self.model.state_dict().items():
            torch.testing.assert_close(value, original[key], rtol=0, atol=0)

    def test_exact_next_update_after_resume(self):
        trainer = self.trained()
        trainer.save(self.root / 'step1', self.base, trainer.validate())
        expected_metrics = trainer.update()
        expected_state = adapter_state(self.model)
        model = tiny_model()
        inject(model, self.config)
        resumed = Trainer(model, self.data, contract())
        resumed.restore(self.root / 'step1', self.base)
        actual_metrics = resumed.update()
        self.assertEqual(actual_metrics, expected_metrics)
        for key, value in adapter_state(model).items():
            torch.testing.assert_close(value, expected_state[key], rtol=0, atol=0)

    def test_checkpointing_matches_plain_gradients(self):
        inject(self.model, self.config)
        plain = copy.deepcopy(self.model)
        enable_checkpointing(self.model)
        item = self.data.read(0)
        for model in (self.model, plain):
            seed_all(17)
            model.train()
            model(item['latent'], torch.tensor([0.2]), item['condition_params'])['x'].square().mean().backward()
        for a, b in zip(adapter_parameters(self.model), adapter_parameters(plain)):
            torch.testing.assert_close(a.grad, b.grad, rtol=0, atol=0)

    def test_wrong_base_and_integrity_fail_before_mutation(self):
        self.trained()
        path = save_bundle(self.root / 'adapter', self.model, self.base)
        expected = self.output(self.model)
        with self.assertRaisesRegex(ValueError, '指纹'):
            load_adapter(self.model, path, {'base_id': 'another'})
        torch.testing.assert_close(self.output(self.model), expected, rtol=0, atol=0)
        with (path / 'adapter_model.safetensors').open('ab') as stream:
            stream.write(b'broken')
        with self.assertRaisesRegex(ValueError, '指纹'):
            load_adapter(self.model, path, self.base)

    def test_missing_extra_shape_nonfinite_and_condition_rejected(self):
        self.trained()
        for kind in ('missing', 'extra', 'shape', 'nonfinite', 'condition'):
            with self.subTest(kind=kind):
                path = save_bundle(self.root / kind, self.model, self.base)
                filename = path / 'adapter_model.safetensors'
                weights = load_file(filename)
                key = next(iter(weights))
                if kind == 'missing':
                    weights.pop(key)
                if kind == 'extra':
                    weights['unexpected'] = torch.zeros(1)
                if kind == 'shape':
                    weights[key] = weights[key][:1]
                if kind == 'nonfinite':
                    weights[key].flatten()[0] = float('nan')
                save_file(weights, filename)
                if kind == 'condition':
                    config = json.loads((path / 'adapter_config.json').read_text())
                    config['condition_modules'] = ['budget']
                    write_json(path / 'adapter_config.json', config)
                manifest = json.loads((path / 'manifest.json').read_text())
                manifest['files'] = {name: sha256(path / name) for name in manifest['files']}
                write_json(path / 'manifest.json', manifest)
                with self.assertRaises(ValueError):
                    read_bundle(path, self.base)

    def test_resume_contract_and_inference_only_rejected(self):
        trainer = self.trained()
        trainer.save(self.root / 'train', self.base)
        trainer.contract = dict(trainer.contract, lr=0.2)
        with self.assertRaisesRegex(ValueError, '续训配置'):
            trainer.restore(self.root / 'train', self.base)
        save_bundle(self.root / 'inference', self.model, self.base)
        with self.assertRaisesRegex(ValueError, '只有推理'):
            trainer.restore(self.root / 'inference', self.base)
        with self.assertRaises(FileExistsError):
            save_bundle(self.root / 'inference', self.model, self.base)

    def test_cache_shapes_splits_and_tampering(self):
        with self.assertRaisesRegex(ValueError, '跨分组'):
            validate_samples([dict(asset_id='same', split='train'), dict(asset_id='same', split='val')])
        item = sample()
        validate_encoded(item, self.model)
        bad = copy.deepcopy(item)
        bad['latent'] = bad['latent'][:, :1]
        with self.assertRaisesRegex(ValueError, '形状'):
            validate_encoded(bad, self.model)
        torch.save(item, self.root / 'sample.pt')
        record = dict(asset_id='a', split='train', file='sample.pt', source_sha256='source', sha256=sha256(self.root / 'sample.pt'))
        manifest = dict(format_version=1, base=self.base, res=8, latent='raw-posterior-mode', samples=[record])
        write_json(self.root / 'manifest.json', manifest)
        dataset = CachedDataset(self.root, self.base, self.model)
        torch.testing.assert_close(dataset.read(0)['latent'], item['latent'])
        torch.save(bad, self.root / 'sample.pt')
        with self.assertRaisesRegex(ValueError, '改变'):
            dataset.read(0)

    def test_validation_does_not_change_training_rng(self):
        trainer = self.trained()
        before = torch.get_rng_state().clone()
        result = trainer.validate()
        self.assertFalse(result['geometry_validated'])
        torch.testing.assert_close(before, torch.get_rng_state(), rtol=0, atol=0)

    def test_official_npz_cache_and_training_entrypoint_fixture(self):
        from contextlib import redirect_stdout
        import io
        from omegaconf import OmegaConf
        from squadgen.network.models_vae_joint import create_joint_vae_from_config
        from squadgen.network.models_sit import create_sqdiffuse_from_config
        from .cache import build
        from .runtime import ROOT, identity, make_model
        from .train import run
        # 使用真实官方 CDF 数据，但模型缩小且随机初始化；只验证工程通路。
        ae_config = OmegaConf.load(ROOT / 'checkpoints/ckpts/sqvae_geomae.yaml')
        for key in ('latent_vae_params', 'cond_vae_params'):
            value = ae_config.model.params[key]
            value.dim, value.attn_depth, value.num_latents = 24, 1, 8
        ae_config.model.params.latent_vae_params.latent_dim = 4
        ae_config.model.params.cond_vae_params.latent_dim = 6
        diffusion = OmegaConf.create({'model': {'params': dict(depth=2, n_heads=2, d_head=8,
            condition_global_keys_list=[], is_last_feature=1, is_pecode_latent=1, is_pecode_latent_pe=1,
            target_mu=[0.1] * 4, target_std=[1.2] * 4)}})
        ae_path, diffusion_path = self.root / 'ae.yaml', self.root / 'diffusion.yaml'
        OmegaConf.save(ae_config, ae_path)
        OmegaConf.save(diffusion, diffusion_path)
        with redirect_stdout(io.StringIO()):
            ae = create_joint_vae_from_config(ae_config.model.params)
            model = create_sqdiffuse_from_config(diffusion.model.params, ae_config.model.params)
        with torch.no_grad():
            torch.nn.init.normal_(model.final_layer.linear.weight, std=0.1)
            for block in model.blocks:
                torch.nn.init.normal_(block.adaLN_modulation[-1].weight, std=0.1)
        save_file(ae.state_dict(), self.root / 'ae.safetensors')
        save_file(model.state_dict(), self.root / 'model.safetensors')
        write_json(self.root / 'samples.json', [dict(asset_id='official-fixture', split='train',
            path=str(ROOT / 'examples/59a7e911d0ed408f89bfd3010564c03e_3.npz'))])
        args = SimpleNamespace(base_id='tiny-fixture', base_weights=self.root / 'model.safetensors',
            ae_weights=self.root / 'ae.safetensors', base_config=diffusion_path, ae_config=ae_path,
            res=8, device='cpu', threads=1, samples=self.root / 'samples.json',
            output=self.root / 'cache', surface_points=64, seed=0)
        build(args)
        base = identity(args)
        loaded = make_model(args)
        dataset = CachedDataset(args.output, base, loaded)
        encoded = dataset.read(0)
        validate_encoded(encoded, loaded)
        # 独立随机张量只供入口自测的 val，不冒充第二个真实资产或泛化验收。
        manifest = json.loads((args.output / 'manifest.json').read_text())
        validation = copy.deepcopy(encoded)
        validation['latent'] = torch.randn_like(validation['latent'])
        torch.save(validation, args.output / 'validation.pt')
        manifest['samples'].append(dict(asset_id='synthetic-validation', split='val', file='validation.pt',
            source_sha256='synthetic-fixture-only', sha256=sha256(args.output / 'validation.pt')))
        write_json(args.output / 'manifest.json', manifest)
        args.cache, args.output = args.output, self.root / 'training'
        args.steps, args.save_every, args.rank, args.alpha, args.dropout = 1, 1, 2, 2, 0
        args.lr, args.weight_decay, args.accumulation, args.clip_grad, args.drop_prob = 1e-3, 0.01, 1, 1, 0.1
        args.precision, args.checkpointing, args.resume, args.init_adapter = 'fp32', True, None, None
        run(args)
        report = json.loads((args.output / 'report.json').read_text())
        self.assertEqual(report['status'], 'completed')
        self.assertFalse(report['geometry_validated'])
        args.resume, args.output, args.steps = args.output / 'step-000001', self.root / 'resumed', 2
        run(args)
        self.assertEqual(json.loads((args.output / 'report.json').read_text())['step'], 2)
        # 检查实际 CPU 推理入口，包括未指定适配器的原路径。
        import shutil
        from local_cpu.run_shoulder import make_diffusion
        checkpoint_dir = self.root / 'inference-base'
        checkpoint_dir.mkdir()
        for source, name in ((args.base_weights, 'sqdiffuse.safetensors'), (args.ae_weights, 'sqvae_geomae.safetensors'),
                             (args.base_config, 'sqdiffuse.yaml'), (args.ae_config, 'sqvae_geomae.yaml')):
            shutil.copyfile(source, checkpoint_dir / name)
        inference_args = SimpleNamespace(res=8, checkpoint_dir=checkpoint_dir, base_id=args.base_id,
            output=self.root, adapter=args.output / 'step-000002')
        expected_model = make_model(args)
        load_adapter(expected_model, inference_args.adapter, base)
        expected_model.eval()
        inference_model = make_diffusion(inference_args)
        with torch.no_grad():
            t = torch.tensor([0.3])
            actual = inference_model(encoded['latent'], t, encoded['condition_params'])['x']
            expected = expected_model(encoded['latent'], t, encoded['condition_params'])['x']
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        inference_args.adapter = None
        raw_model = make_diffusion(inference_args)
        for name, value in raw_model.state_dict().items():
            torch.testing.assert_close(value, model.state_dict()[name], rtol=0, atol=0)


if __name__ == '__main__':
    unittest.main()
