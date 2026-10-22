import * as ort from 'onnxruntime-node';
import { performance } from 'node:perf_hooks';
import { ServiceError, requireService } from '../core/errors.mjs';
import { INPUT_SHAPES, exactKeys, shapeCount, sha256 } from '../core/benchmark-common.mjs';
import { BODY25_NAMES, BODY25_EDGES, NODE_SOURCE } from '../core/body25.mjs';
import { DEFAULT_MODEL_DIR } from '../core/paths.mjs';
import { createPreprocessor } from '../core/preprocess.mjs';
import { validateBBox } from '../core/protocol.mjs';
import { verifyModel } from '../core/model-files.mjs';
import { inspectSession, captureOutputs } from './benchmark.mjs';

const rows = (data, count, stride) => Array.from({ length: count }, (_, index) => data.slice(index * stride, (index + 1) * stride));

// 一个引擎只持有一个session；HTTP请求不允许换模型、dtype或EP。
export class Hmr2Engine {
  constructor(options = {}) {
    this.options = { modelDir: DEFAULT_MODEL_DIR, provider: process.platform === 'win32' ? 'dml' : 'cpu',
      deviceId: 0, intraOpNumThreads: 4, ...options };
    requireService(['dml', 'cpu'].includes(this.options.provider), 400, 'invalid_config', '当前构建只支持明确DML或CPU，不能伪装CUDA');
    requireService(Number.isSafeInteger(this.options.deviceId) && this.options.deviceId >= 0 && this.options.deviceId <= 15,
      400, 'invalid_config', 'DML adapter ordinal必须是0至15整数');
    requireService(Number.isSafeInteger(this.options.intraOpNumThreads) &&
      this.options.intraOpNumThreads >= 1 && this.options.intraOpNumThreads <= 32,
      400, 'invalid_config', 'ORT intraOp线程数必须是1至32整数');
    this.session = null;
    this.busy = false;
    this.ready = false;
    this.closing = false;
    this.loadCount = 0;
    this.modelLoadMs = 0;
    this.startupMs = 0;
    this.active = null;
    this.loadPromise = null;
    this.closePromise = null;
  }

  async load() {
    requireService(!this.closing, 503, 'model_not_ready', '引擎已关闭');
    if (this.ready) return this;
    if (!this.loadPromise) this.loadPromise = this.loadOnce();
    await this.loadPromise;
    return this;
  }

  async loadOnce() {
    const start = performance.now();
    const model = await verifyModel({ modelDir: this.options.modelDir });
    this.prepare = await createPreprocessor(this.options);
    const sessionOptions = { executionProviders: this.options.provider === 'dml' ? [{ name: 'dml', deviceId: this.options.deviceId }] : ['cpu'],
      executionMode: 'sequential', enableMemPattern: false, graphOptimizationLevel: 'all',
      intraOpNumThreads: this.options.intraOpNumThreads, interOpNumThreads: 1, logSeverityLevel: 3 };
    if (this.options.profileFilePrefix) {
      sessionOptions.enableProfiling = true;
      sessionOptions.profileFilePrefix = this.options.profileFilePrefix;
    }
    let session;
    try {
      const loadStart = performance.now();
      session = await ort.InferenceSession.create(model.modelPath, sessionOptions);
      requireService(!this.closing, 503, 'model_not_ready', '引擎已关闭');
      this.modelLoadMs = performance.now() - loadStart;
      this.metadata = inspectSession(session);
      this.model = model;
      this.session = session;
      this.sessionOptions = sessionOptions;
      this.loadCount += 1;
      this.ready = true;
      this.startupMs = performance.now() - start;
    } catch {
      if (session) {
        try { await session.release(); }
        catch { throw new ServiceError(503, 'model_load_failed', 'ONNX会话释放失败'); }
      }
      if (this.closing) throw new ServiceError(503, 'model_not_ready', '引擎已关闭');
      throw new ServiceError(503, 'model_load_failed', 'ONNX模型加载失败；不会自动回退CPU或替换模型');
    }
  }

  deviceInfo() {
    return this.options.provider === 'dml'
      ? { device: `dml:${this.options.deviceId}`, gpu: { index: this.options.deviceId, name: null, ordinalSystem: 'DXGI EnumAdapters1', nameStatus: 'unknown' } }
      : { device: 'cpu', gpu: null };
  }

  memory() {
    return { allocator: 'unknown', gpuAllocator: 'unknown', allocatedMiB: null, reservedMiB: null, peakAllocatedMiB: null,
      peakReservedMiB: null, deviceFreeMiB: null, deviceTotalMiB: null, hostRssBytes: process.memoryUsage().rss,
      note: 'ORT GPU allocator未暴露；hostRssBytes是宿主RSS，不是GPU显存' };
  }

  health() {
    return { type: 'hmr2.health', ready: this.ready, model: 'HMR2.0b', source: NODE_SOURCE,
      ...this.deviceInfo(), precision: 'fp32', loadCount: this.loadCount, busy: this.busy,
      modelLoadMs: this.modelLoadMs, startupMs: this.startupMs, memory: this.memory(),
      runtime: { name: 'onnxruntime-node', version: ort.env.versions.node, requestedEp: this.options.provider,
        actualAssignment: { status: 'unknown', reason: 'no independent ORT profile for this session' }, inputOutputPrecision: 'fp32', internalPrecision: 'unknown', tf32: 'unknown',
        modelVerified: Boolean(this.model?.verified), modelFiles: this.model?.files ?? [] } };
  }

  async exclusive(operation) {
    requireService(this.ready && !this.closing, 503, 'model_not_ready', '模型尚未就绪');
    requireService(!this.busy, 503, 'gpu_busy', '推理正在运行，请稍后重试');
    this.busy = true;
    try {
      this.active = operation();
      return await this.active;
    } finally {
      this.active = null;
      this.busy = false;
    }
  }

  async predictBytes(bytes, bbox) {
    return this.exclusive(async () => {
      const start = performance.now();
      const prepared = await this.prepare(bytes, bbox);
      return this.inferPrepared(prepared, performance.now() - start, start);
    });
  }

  // 仅本地代码基准可调用；HTTP没有Tensor/file/path入口。
  async runPrepared(inputs, metadata) {
    return this.exclusive(() => this.inferPrepared({ inputs, metadata }, 0, performance.now()));
  }

  async inferPrepared(prepared, preprocessMs, totalStart) {
    const { inputs, metadata } = prepared;
    try {
      exactKeys(inputs, INPUT_SHAPES, 'prepared.inputs');
      for (const [name, shape] of Object.entries(INPUT_SHAPES)) {
        requireService(inputs[name] instanceof Float32Array && inputs[name].length === shapeCount(shape, name) && inputs[name].every(Number.isFinite),
          400, 'invalid_batch', 'CPU FP32输入无效：' + name);
      }
      requireService(metadata && Array.isArray(metadata.imageSize) && metadata.imageSize.length === 2 &&
        metadata.imageSize.every((size, index) => Number.isSafeInteger(size) && size > 0 && size === inputs.img_size[index]) &&
        metadata.imageSize[0] * metadata.imageSize[1] <= (this.options.maxPixels ?? 40_000_000) &&
        inputs.box_size[0] > 0, 400, 'invalid_batch', '批次尺寸或bbox_size无效');
      try {
        validateBBox(metadata.boxXYXY, ...metadata.imageSize);
        requireService(Array.isArray(metadata.boxXYXY) && ['supplied', 'full_image_fallback'].includes(metadata.bboxSource),
          400, 'invalid_batch', '批次框或来源无效');
        if (metadata.bboxSource === 'full_image_fallback') {
          requireService(metadata.boxXYXY.every((value, index) => value === [0, 0, ...metadata.imageSize][index]),
            400, 'invalid_batch', 'fallback批次必须使用全图框');
        }
      } catch { throw new ServiceError(400, 'invalid_batch', '批次框/来源无效'); }
      const inputHash = sha256(Buffer.from(inputs.img.buffer, inputs.img.byteOffset, inputs.img.byteLength));
      requireService(inputHash === metadata.inputTensorSha256, 400, 'invalid_batch', '输入摘要与元数据不一致');
      const feeds = Object.fromEntries(Object.entries(INPUT_SHAPES).map(([name, shape]) => [name, new ort.Tensor('float32', inputs[name], shape)]));
      const runStart = performance.now();
      const outputs = captureOutputs(await this.session.run(feeds));
      const modelRunMs = performance.now() - runStart;
      requireService(outputs.principalPointPx.data.every((value, index) => value === metadata.imageSize[index] / 2),
        500, 'inference_failed', '模型主点与原图尺寸不一致');
      requireService(sha256(Buffer.from(inputs.img.buffer, inputs.img.byteOffset, inputs.img.byteLength)) === inputHash,
        500, 'input_mutated', 'ORT运行修改了输入Tensor');
      return this.resultDto(outputs, metadata, { preprocessMs, modelRunMs, totalMs: performance.now() - totalStart });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(500, 'inference_failed', 'ONNX推理或输出合同校验失败；不会生成伪姿态');
    }
  }

  resultDto(outputs, metadata, { preprocessMs, modelRunMs, totalMs }) {
    const cameraTranslation = outputs.cameraTranslation.data;
    const focalLengthPx = outputs.focalLengthPx.data[0];
    const principalPoint = outputs.principalPointPx.data;
    return { type: 'hmr2.result', schemaVersion: 1, model: 'HMR2.0b', source: NODE_SOURCE,
      ...this.deviceInfo(), precision: 'fp32', imageSize: metadata.imageSize,
      boxXYXY: metadata.boxXYXY, bboxSource: metadata.bboxSource, names: BODY25_NAMES, edges: BODY25_EDGES,
      xyz: rows(outputs.xyz.data, 25, 3), xy: rows(outputs.xy.data, 25, 2),
      rotations24: rows(outputs.rotations24.data, 24, 9).map((matrix) => rows(matrix, 3, 3)),
      betas10: outputs.betas10.data, predCam: outputs.predCam.data, cameraTranslation,
      projection: { focalLengthPx, principalPointPx: principalPoint },
      camera: { translation: cameraTranslation, focalLengthPx, principalPoint }, cameraDepth: outputs.cameraDepth.data,
      inputTensorSha256: metadata.inputTensorSha256, preprocessing: metadata.preprocessing ?? null,
      modelLoadMs: this.modelLoadMs, inferenceMs: modelRunMs,
      timingMs: { preprocess: preprocessMs, modelRun: modelRunMs, total: totalMs, modelLoad: this.modelLoadMs,
        hostToDevice: null, network: null, lbs: null, projection: null, deviceToHost: null },
      timingBoundary: 'modelRun/inferenceMs是完整ORT run至CPU九输出拷贝校验，不能与Torch network或network+LBS纯阶段混比',
      runtime: this.health().runtime, memory: this.memory() };
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.ready = false;
    // 先拒绝新工作，再等既有加载/推理；并发close只共享这一条清理链。
    this.closePromise = (async () => {
      try {
        if (this.loadPromise) { try { await this.loadPromise; } catch { /* 加载失败仍需继续清理 */ } }
        if (this.active) { try { await this.active; } catch { /* 推理失败仍需继续清理 */ } }
        const session = this.session;
        this.session = null;
        if (session) {
          try {
            if (this.options.profileFilePrefix) await session.endProfiling();
          } finally {
            await session.release();
          }
        }
      } finally {
        this.ready = false;
      }
    })();
    return this.closePromise;
  }
}
