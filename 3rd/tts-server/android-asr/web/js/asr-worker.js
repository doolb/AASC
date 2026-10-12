// 浏览器推理 Worker：加载固定 WASM 运行时，音频和临时声纹库只留在此 Worker 内存。
// 该固定 Sherpa 浏览器包装依赖 window/global 名称；在专用 Worker 中将它们映射到 WorkerGlobalScope。
self.window = self;
self.global = self;
importScripts(new URL('./speaker-utils.js', self.location.href).href);

const MODEL_FILES = Object.freeze({
  asr: Object.freeze({
    model: 'sensevoice/model.int8.onnx',
    tokens: 'sensevoice/tokens.txt',
  }),
  speaker: 'voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
  diarization: 'voiceprint/pyannote_segmentation_3_0_int8.onnx',
});
const MATCH_THRESHOLD = 0.5;
const SAMPLE_RATE = 16000;

let modelRoot = new URL('/mnt/aimodel/', self.location.origin).href;
let runtimeReady = false;
let isBusy = false;
let asrModelState = 'not-loaded';
let speakerModelState = 'not-loaded';
let diarizationModelState = 'not-loaded';
let asrModelPaths = null;
let speakerModelPath = null;
let diarizationModelPath = null;
let asrRecognizer = null;
let asrLanguage = null;
let speakerExtractor = null;
let speakerManager = null;
let diarization = null;
let registeredEmbeddings = new Map();

function postWorkerEvent(type, data = {}) {
  self.postMessage({ type, ...data });
}

function getModelUrl(relativePath) {
  return new URL(relativePath, modelRoot).href;
}

function setModelRoot(value) {
  const nextRoot = new URL(value, self.location.origin);
  if (nextRoot.protocol !== 'http:' && nextRoot.protocol !== 'https:') {
    throw new Error('模型地址必须使用 HTTP 或 HTTPS');
  }
  nextRoot.search = '';
  nextRoot.hash = '';
  if (!nextRoot.pathname.endsWith('/')) nextRoot.pathname += '/';
  const normalized = nextRoot.href;
  if (normalized === modelRoot) return;
  if (runtimeReady) releaseModels();
  modelRoot = normalized;
}

function releaseModels() {
  asrRecognizer?.free();
  asrRecognizer = null;
  asrLanguage = null;
  diarization?.free();
  diarization = null;
  speakerManager?.free();
  speakerManager = null;
  speakerExtractor?.free();
  speakerExtractor = null;
  registeredEmbeddings.clear();
  for (const path of ['/asr-web/asr/model.int8.onnx', '/asr-web/asr/tokens.txt', '/asr-web/voiceprint/embedding.onnx', '/asr-web/voiceprint/segmentation.onnx']) {
    try {
      if (Module.FS.stat(path)) Module.FS.unlink(path);
    } catch (_error) {
      // 首次加载或路径切换时文件可能不存在，保持释放流程可重复。
    }
  }
  asrModelPaths = null;
  speakerModelPath = null;
  diarizationModelPath = null;
  asrModelState = 'not-loaded';
  speakerModelState = 'not-loaded';
  diarizationModelState = 'not-loaded';
}

function modelStatus() {
  return {
    modelRoot,
    asr: asrModelState,
    speaker: speakerModelState,
    diarization: diarizationModelState,
    registeredSpeakers: [...registeredEmbeddings.keys()],
    embeddingDim: speakerExtractor?.dim() || 0,
    threshold: MATCH_THRESHOLD,
    runtimeReady,
    busy: isBusy,
  };
}

async function loadModelFile(relativePath, wasmPath, requestId) {
  const url = getModelUrl(relativePath);
  const folder = wasmPath.slice(0, wasmPath.lastIndexOf('/'));
  if (!SherpaOnnx.FileSystem.safeCreateDirectory(folder)) {
    throw new Error(`无法创建 WASM 模型目录：${folder}`);
  }
  SherpaOnnx.onDownloadProgress = (progress) => {
    postWorkerEvent('model-progress', {
      requestId,
      filename: progress.filename,
      loaded: progress.loaded,
      total: progress.total,
      percent: progress.percent,
    });
  };
  const loaded = await SherpaOnnx.FileSystem.safeLoadFile(url, wasmPath, false);
  if (!loaded || loaded.success !== true) {
    throw new Error(`模型加载失败：${url}。请确认 Apache 路径、文件权限和同源/CORS 设置。`);
  }
  return loaded.path;
}

async function ensureAsrModel(requestId) {
  if (asrModelPaths) return asrModelPaths;
  asrModelState = 'loading';
  postWorkerEvent('model-state', { requestId, key: 'asr', state: asrModelState });
  try {
    const model = await loadModelFile(MODEL_FILES.asr.model, '/asr-web/asr/model.int8.onnx', requestId);
    const tokens = await loadModelFile(MODEL_FILES.asr.tokens, '/asr-web/asr/tokens.txt', requestId);
    asrModelPaths = { model, tokens };
    asrModelState = 'ready';
    postWorkerEvent('model-state', { requestId, key: 'asr', state: asrModelState });
    return asrModelPaths;
  } catch (error) {
    asrModelState = 'error';
    postWorkerEvent('model-state', { requestId, key: 'asr', state: asrModelState, message: error.message });
    throw error;
  }
}

async function ensureSpeakerModel(requestId) {
  if (speakerExtractor && speakerManager) return;
  speakerModelState = 'loading';
  postWorkerEvent('model-state', { requestId, key: 'speaker', state: speakerModelState });
  try {
    speakerModelPath = await loadModelFile(MODEL_FILES.speaker, '/asr-web/voiceprint/embedding.onnx', requestId);
    speakerExtractor = SherpaOnnx.SpeakerId.createExtractor(
      { modelDir: '/asr-web/voiceprint', modelPath: speakerModelPath },
      { numThreads: 1, debug: false, provider: 'cpu' }
    );
    speakerManager = SherpaOnnx.SpeakerId.createManager(speakerExtractor.dim());
    speakerModelState = 'ready';
    postWorkerEvent('model-state', { requestId, key: 'speaker', state: speakerModelState });
    postWorkerEvent('speaker-list', { names: [...registeredEmbeddings.keys()], embeddingDim: speakerExtractor.dim() });
  } catch (error) {
    speakerModelState = 'error';
    postWorkerEvent('model-state', { requestId, key: 'speaker', state: speakerModelState, message: error.message });
    throw error;
  }
}

async function ensureDiarizationModel(requestId) {
  await ensureSpeakerModel(requestId);
  if (diarizationModelPath) return diarizationModelPath;
  diarizationModelState = 'loading';
  postWorkerEvent('model-state', { requestId, key: 'diarization', state: diarizationModelState });
  try {
    diarizationModelPath = await loadModelFile(MODEL_FILES.diarization, '/asr-web/voiceprint/segmentation.onnx', requestId);
    diarizationModelState = 'ready';
    postWorkerEvent('model-state', { requestId, key: 'diarization', state: diarizationModelState });
    return diarizationModelPath;
  } catch (error) {
    diarizationModelState = 'error';
    postWorkerEvent('model-state', { requestId, key: 'diarization', state: diarizationModelState, message: error.message });
    throw error;
  }
}

function createRecognizer(language) {
  return new OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      tokens: asrModelPaths.tokens,
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
      senseVoice: {
        model: asrModelPaths.model,
        language,
        useInverseTextNormalization: 1,
      },
    },
    decodingMethod: 'greedy_search',
  }, Module);
}

function validateLanguage(language) {
  const normalized = String(language || 'auto').trim().toLowerCase();
  if (!['auto', 'zh', 'en'].includes(normalized)) {
    throw new Error('语言模式必须是自动、中文或英文');
  }
  return normalized;
}

function validateAudio(samples) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error('没有可识别的音频');
  }
  if (samples.length > SAMPLE_RATE * 60) throw new Error('音频长度不能超过 60 秒');
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('音频包含无效采样值');
  }
}

function getRecognizer(language) {
  if (asrRecognizer && asrLanguage === language) return asrRecognizer;
  asrRecognizer?.free();
  asrRecognizer = createRecognizer(language);
  asrLanguage = language;
  if (!asrRecognizer.handle) throw new Error('SenseVoice 识别器初始化失败');
  return asrRecognizer;
}

async function recognize(samples, language, requestId) {
  validateAudio(samples);
  await ensureAsrModel(requestId);
  const recognizer = getRecognizer(validateLanguage(language));
  const started = performance.now();
  const stream = recognizer.createStream();
  try {
    stream.acceptWaveform(SAMPLE_RATE, samples);
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    return { text: String(result.text || '').trim(), elapsedMs: Math.round(performance.now() - started) };
  } finally {
    stream.free();
  }
}

function extractEmbedding(samples) {
  validateAudio(samples);
  const stream = speakerExtractor.createStream();
  try {
    speakerExtractor.acceptWaveform(stream, SAMPLE_RATE, samples);
    speakerExtractor.inputFinished(stream);
    if (!speakerExtractor.isReady(stream)) throw new Error('音频太短，无法提取稳定声纹');
    const embedding = speakerExtractor.computeEmbedding(stream);
    if (!embedding.length) throw new Error('声纹模型没有返回 embedding');
    return embedding;
  } finally {
    speakerExtractor.destroyStream(stream);
  }
}

function matchEmbedding(embedding) {
  const matched = speakerManager.search(embedding, MATCH_THRESHOLD) || null;
  let best = null;
  for (const [name, stored] of registeredEmbeddings) {
    const score = AsrWebSpeakerUtils.cosineSimilarity(embedding, stored);
    if (score !== null && (!best || score > best.score)) best = { name, score };
  }
  const matchedScore = matched
    ? AsrWebSpeakerUtils.cosineSimilarity(embedding, registeredEmbeddings.get(matched))
    : null;
  return {
    speaker: matched,
    similarityScore: matchedScore ?? best?.score ?? null,
    threshold: MATCH_THRESHOLD,
  };
}

function sliceSamples(samples, start, end) {
  const startIndex = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const endIndex = Math.min(samples.length, Math.ceil(end * SAMPLE_RATE));
  if (endIndex <= startIndex) throw new Error('声纹分段没有有效音频');
  return samples.slice(startIndex, endIndex);
}

async function testSingle(samples, language, requestId) {
  await ensureSpeakerModel(requestId);
  await ensureAsrModel(requestId);
  const started = performance.now();
  const embeddingStarted = performance.now();
  const match = matchEmbedding(extractEmbedding(samples));
  const embeddingMs = Math.round(performance.now() - embeddingStarted);
  const recognized = await recognize(samples, language, requestId);
  return {
    mode: 'SHERPA_SINGLE',
    matchedSpeaker: match.speaker,
    similarityScore: match.similarityScore,
    threshold: match.threshold,
    embeddingDim: speakerExtractor.dim(),
    text: recognized.text,
    embeddingMs,
    asrMs: recognized.elapsedMs,
    elapsedMs: Math.round(performance.now() - started),
    segments: [],
  };
}

function createDiarization(speakerCount) {
  const config = {
    segmentation: {
      pyannote: { model: diarizationModelPath },
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
    },
    embedding: { model: speakerModelPath, numThreads: 1, debug: 0, provider: 'cpu' },
    clustering: { numClusters: speakerCount === 0 ? -1 : speakerCount, threshold: MATCH_THRESHOLD },
    minDurationOn: 0.3,
    minDurationOff: 0.5,
  };
  if (!diarization) {
    diarization = SherpaOnnx.SpeakerDiarization.createDiarization(
      { segmentationPath: diarizationModelPath, embeddingPath: speakerModelPath },
      { numThreads: 1, provider: 'cpu', numClusters: config.clustering.numClusters, threshold: MATCH_THRESHOLD, minDurationOn: 0.3, minDurationOff: 0.5 }
    );
  } else {
    diarization.setConfig(config);
  }
  return diarization;
}

async function matchSegment(samples, segment, onEmbedding) {
  try {
    const segmentSamples = sliceSamples(samples, segment.start, segment.end);
    const started = performance.now();
    const match = matchEmbedding(extractEmbedding(segmentSamples));
    onEmbedding(Math.round(performance.now() - started));
    return { ...segment, match, error: null };
  } catch (error) {
    return {
      ...segment,
      match: { speaker: null, similarityScore: null, threshold: MATCH_THRESHOLD },
      error: error.message || '声纹提取失败',
    };
  }
}

async function resolveSegments(samples, segments, onEmbedding) {
  return AsrWebSpeakerUtils.resolveMatchedSegments(segments, (start, end, clusterId) =>
    matchSegment(samples, { start, end, clusterId }, onEmbedding));
}

async function recognizeSegments(samples, segments, language, requestId, onAsr) {
  const results = [];
  for (const segment of segments) {
    if (segment.error) {
      results.push({
        start: segment.start,
        end: segment.end,
        clusterId: segment.clusterId,
        speaker: segment.match.speaker,
        similarityScore: segment.match.similarityScore,
        text: '',
        error: segment.error,
      });
      continue;
    }
    try {
      const result = await recognize(sliceSamples(samples, segment.start, segment.end), language, requestId);
      onAsr(result.elapsedMs);
      results.push({
        start: segment.start,
        end: segment.end,
        clusterId: segment.clusterId,
        speaker: segment.match.speaker,
        similarityScore: segment.match.similarityScore,
        text: result.text,
      });
    } catch (error) {
      results.push({
        start: segment.start,
        end: segment.end,
        clusterId: segment.clusterId,
        speaker: segment.match.speaker,
        similarityScore: segment.match.similarityScore,
        text: '',
        error: error.message || '分段 ASR 失败',
      });
    }
  }
  return results;
}

function validateSpeakerCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 5) {
    throw new Error('说话人数必须选择自动或 1–5 人');
  }
  return count;
}

async function testMulti(samples, language, speakerCount, requestId, fast) {
  validateAudio(samples);
  await ensureDiarizationModel(requestId);
  const started = performance.now();
  const diarizationStarted = performance.now();
  const rawSegments = createDiarization(validateSpeakerCount(speakerCount)).process(samples);
  const diarizationMs = Math.round(performance.now() - diarizationStarted);
  const merged = AsrWebSpeakerUtils.mergeDiarizedSegments(rawSegments);
  let embeddingMs = 0;
  let matched;

  if (fast) {
    const representatives = new Map();
    for (const segment of merged) {
      const previous = representatives.get(segment.clusterId);
      if (!previous || segment.end - segment.start > previous.end - previous.start) {
        representatives.set(segment.clusterId, segment);
      }
    }
    const matchByCluster = new Map();
    for (const [clusterId, representative] of representatives) {
      matchByCluster.set(clusterId, await matchSegment(samples, representative, (elapsed) => { embeddingMs += elapsed; }));
    }
    matched = merged.map((segment) => ({
      ...segment,
      match: matchByCluster.get(segment.clusterId)?.match || { speaker: null, similarityScore: null, threshold: MATCH_THRESHOLD },
      error: matchByCluster.get(segment.clusterId)?.error || null,
    }));
  } else {
    matched = [];
    for (const segment of merged) {
      matched.push(await matchSegment(samples, segment, (elapsed) => { embeddingMs += elapsed; }));
    }
  }

  const resolved = await resolveSegments(samples, matched, (elapsed) => { embeddingMs += elapsed; });
  let asrMs = 0;
  const results = await recognizeSegments(samples, resolved, language, requestId, (elapsed) => { asrMs += elapsed; });
  return {
    mode: fast ? 'SHERPA_MULTI_FAST' : 'SHERPA_MULTI',
    matchedSpeaker: null,
    similarityScore: null,
    threshold: MATCH_THRESHOLD,
    embeddingDim: speakerExtractor.dim(),
    text: results.map((segment) => segment.text).filter(Boolean).join(' '),
    segments: results,
    diarizationMs,
    embeddingMs,
    asrMs,
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function withBusy(requestId, callback) {
  if (isBusy) throw new Error('上一项推理尚未完成');
  isBusy = true;
  postWorkerEvent('busy-state', { requestId, busy: true });
  try {
    return await callback();
  } finally {
    isBusy = false;
    postWorkerEvent('busy-state', { requestId, busy: false });
  }
}

async function handleRecognize(message) {
  return withBusy(message.requestId, async () => {
    const result = await recognize(new Float32Array(message.samples), message.language, message.requestId);
    return { ...result, model: 'SenseVoice INT8' };
  });
}

async function handleRegister(message) {
  return withBusy(message.requestId, async () => {
    const name = String(message.name || '').trim();
    if (!name) throw new Error('请填写注册名称');
    const samples = new Float32Array(message.samples);
    validateAudio(samples);
    await ensureSpeakerModel(message.requestId);
    const started = performance.now();
    const embedding = extractEmbedding(samples);
    if (registeredEmbeddings.has(name)) speakerManager.remove(name);
    if (!speakerManager.add(name, embedding)) throw new Error(`声纹注册失败：${name}`);
    registeredEmbeddings.set(name, embedding);
    const names = [...registeredEmbeddings.keys()];
    postWorkerEvent('speaker-list', { names, embeddingDim: speakerExtractor.dim() });
    return {
      name,
      embeddingDim: embedding.length,
      elapsedMs: Math.round(performance.now() - started),
      speakers: names,
    };
  });
}

async function handleVoiceprintTest(message) {
  return withBusy(message.requestId, async () => {
    const samples = new Float32Array(message.samples);
    validateAudio(samples);
    const language = validateLanguage(message.language);
    const result = message.mode === 'SHERPA_SINGLE'
      ? await testSingle(samples, language, message.requestId)
      : await testMulti(samples, language, message.speakerCount, message.requestId, message.mode === 'SHERPA_MULTI_FAST');
    return { ...result, speakers: [...registeredEmbeddings.keys()] };
  });
}

async function handleClearSpeakers() {
  for (const name of registeredEmbeddings.keys()) speakerManager?.remove(name);
  registeredEmbeddings.clear();
  postWorkerEvent('speaker-list', { names: [], embeddingDim: speakerExtractor?.dim() || 0 });
  return { speakers: [] };
}

const handlers = {
  status: async () => modelStatus(),
  recognize: handleRecognize,
  register: handleRegister,
  voiceprintTest: handleVoiceprintTest,
  clearSpeakers: handleClearSpeakers,
};

self.Module = {
  locateFile(path) {
    if (path.endsWith('.wasm')) return new URL(`../vendor/${path}`, self.location.href).href;
    return new URL(`../vendor/${path}`, self.location.href).href;
  },
  onRuntimeInitialized() {
    runtimeReady = true;
    // APK 本地注册库不能写入正式库；关闭 WASM 包自己的 IndexedDB 模型副本，只使用 HTTP 缓存。
    SherpaOnnx.Cache.get = async () => null;
    SherpaOnnx.Cache.put = async () => undefined;
    postWorkerEvent('runtime-ready');
  },
  onAbort(message) {
    postWorkerEvent('runtime-error', { message: String(message || 'WASM 初始化失败') });
  },
};

importScripts(
  new URL('../vendor/sherpa-onnx-core.js', self.location.href).href,
  new URL('../vendor/sherpa-onnx-asr.js', self.location.href).href,
  new URL('../vendor/sherpa-onnx-speaker.js', self.location.href).href,
  new URL('../vendor/sherpa-onnx-speaker-id.js', self.location.href).href,
  new URL('../vendor/sherpa-onnx-wasm-combined.js', self.location.href).href
);

self.onmessage = async (event) => {
  const message = event.data || {};
  const requestId = message.requestId;
  if (message.type === 'configure') {
    try {
      setModelRoot(message.modelRoot || new URL('/mnt/aimodel/', self.location.origin).href);
      postWorkerEvent('configured', { modelRoot });
    } catch (error) {
      postWorkerEvent('request-error', { requestId, message: error.message });
    }
    return;
  }
  if (message.type === 'shutdown') {
    releaseModels();
    self.close();
    return;
  }
  if (!runtimeReady) {
    postWorkerEvent('request-error', { requestId, message: 'WASM 推理引擎尚未就绪' });
    return;
  }
  const handler = handlers[message.type];
  if (!handler) {
    postWorkerEvent('request-error', { requestId, message: `未知的 Worker 操作：${message.type}` });
    return;
  }
  try {
    const data = await handler(message);
    postWorkerEvent('result', { requestId, data });
  } catch (error) {
    postWorkerEvent('request-error', { requestId, message: error.message || '推理失败' });
  }
};
