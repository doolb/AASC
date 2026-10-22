import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 由模块真实路径定位项目，不依赖npm调用时的cwd，便于根命令和子包命令共存。
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, '../..');
export const DEFAULT_MODEL_DIR = path.join(PROJECT_ROOT, 'res/models/hmr2-node-onnx/fp32-op18-dml-static');
export const DEFAULT_LOCAL_SOURCE_DIR = 'E:/ai/ai-depthmap/hmr2_node_onnx/models/fp32-op18-dml-static';
export const DEFAULT_FIXTURES = 'E:/ai/ai-depthmap/hmr2_node_onnx/fixtures/manifest.json';
export const DEFAULT_RESULTS_DIR = path.join(PROJECT_ROOT, 'tmp/hmr2-node-onnx');
export const DEFAULT_PORT = 8769;
