"""隔离CPU参考：继承原服务prepare_image，仅load覆盖为CPU依赖初始化；不构造模型/CUDA/HTTP。"""
from pathlib import Path
import argparse, contextlib, hashlib, importlib.util, io, json, os, sys, types
os.environ['CUDA_VISIBLE_DEVICES'] = ''
sys.dont_write_bytecode = True

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', default=r'E:\ai\ai-depthmap')
parser.add_argument('--cases', required=True)
parser.add_argument('--out', required=True)
args = parser.parse_args()
base = Path(args.source_dir).resolve()
out = Path(args.out).resolve()
if out.exists(): raise RuntimeError('参考输出目录已存在，拒绝覆盖')
out.mkdir(parents=True)
spec = importlib.util.spec_from_file_location('hmr2_cpu_reference_original', base / 'hmr2_gpu_service.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)

class CpuReference(original.HMR2Engine):
    def load(self):
        if self._loaded: return self
        import cv2, numpy as np, torch
        if str(self.runtime_dir) not in sys.path:
            sys.path.insert(0, str(self.runtime_dir))
        original._namespace_hmr2(self.runtime_dir)
        from yacs.config import CfgNode
        import hmr2.datasets.vitdet_dataset as dataset_module
        self._np, self._torch = np, torch
        self._cfg = CfgNode({'MODEL': {'IMAGE_SIZE': 256, 'IMAGE_MEAN': [.485, .456, .406], 'IMAGE_STD': [.229, .224, .225], 'BBOX_SHAPE': [192, 256]}})
        self.observed = {}
        actual_decode = cv2.imdecode
        def decode(*values, **kwargs):
            image = actual_decode(*values, **kwargs)
            self.observed['decodedBgr'] = image.copy() if image is not None else None
            return image
        self._cv2 = types.SimpleNamespace(imdecode=decode, IMREAD_COLOR=cv2.IMREAD_COLOR, error=cv2.error)
        actual_patch = dataset_module.generate_image_patch_cv2
        def patch(*values, **kwargs):
            warp, matrix = actual_patch(*values, **kwargs)
            self.observed['warpBgr'], self.observed['matrix'] = warp.copy(), matrix.copy()
            return warp, matrix
        dataset_module.generate_image_patch_cv2 = patch
        actual_gaussian = dataset_module.gaussian
        def gaussian(image, *values, **kwargs):
            self.observed['gaussianSigma'] = float(kwargs['sigma'])
            return actual_gaussian(image, *values, **kwargs)
        dataset_module.gaussian = gaussian
        self._dataset = dataset_module.ViTDetDataset
        self._loaded = True
        return self

engine = CpuReference(base / 'models/hmr2', base / 'hmr2_runtime')
engine.load()
records = []
for case in json.loads(Path(args.cases).read_text(encoding='utf-8')):
    name = case['name']
    if not name.replace('-', '').replace('_', '').isalnum(): raise RuntimeError('样本名无效')
    folder = out / name
    folder.mkdir()
    encoded = Path(case['imagePath']).read_bytes()
    engine.observed = {}
    try:
        # 原Dataset的factor print仅捕获，不污染JSON/stdout；算法仍直接原函数。
        with contextlib.redirect_stdout(io.StringIO()):
            inputs, metadata = engine.prepare_image(encoded, case.get('bbox'))
        import numpy as np
        entries = {}
        for key, tensor in inputs.items():
            array = tensor.numpy().astype('<f4', copy=False)
            data = array.tobytes(order='C')
            (folder / (key + '.bin')).write_bytes(data)
            entries[key] = {'shape': list(array.shape), 'sha256': hashlib.sha256(data).hexdigest()}
        stages = {}
        for key in ['decodedBgr', 'warpBgr', 'matrix']:
            array = engine.observed[key]
            data = array.tobytes(order='C')
            (folder / (key + '.bin')).write_bytes(data)
            stages[key] = {'shape': list(array.shape), 'dtype': str(array.dtype), 'sha256': hashlib.sha256(data).hexdigest()}
        records.append({'name': name, 'metadata': metadata, 'inputs': entries, 'stages': stages,
                        'gaussianSigma': engine.observed.get('gaussianSigma'), 'ok': True})
    except original.ServiceError as error:
        records.append({'name': name, 'ok': False, 'error': {'status': error.status, 'code': error.code}})
report = {'scope': 'CPU-only inherited original prepare_image; no checkpoint/backbone/SMPL/CUDA model/HTTP',
          'sourceServiceSha256': hashlib.sha256((base / 'hmr2_gpu_service.py').read_bytes()).hexdigest(),
          'versions': {'numpy': engine._np.__version__, 'torch': engine._torch.__version__, 'opencv': __import__('cv2').__version__},
          'records': records}
(out / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'reference': str(out), 'samples': len(records), 'scope': report['scope']}))
