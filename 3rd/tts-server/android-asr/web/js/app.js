import { downmixAudioBuffer, encodePcm16Wav, mergeFloatChunks, resampleMono, validateSamples } from './audio-utils.mjs';
import { createWorkerClient } from './worker-client.mjs';

const elements = {
  runtimeBadge: document.getElementById('runtimeBadge'),
  modelRootInput: document.getElementById('modelRootInput'),
  modelRootNote: document.getElementById('modelRootNote'),
  checkModelsButton: document.getElementById('checkModelsButton'),
  applyModelRootButton: document.getElementById('applyModelRootButton'),
  modelGrid: document.getElementById('modelGrid'),
  modelProgress: document.getElementById('modelProgress'),
  audioFileInput: document.getElementById('audioFileInput'),
  recordButton: document.getElementById('recordButton'),
  downloadAudioButton: document.getElementById('downloadAudioButton'),
  audioStatus: document.getElementById('audioStatus'),
  audioPlayer: document.getElementById('audioPlayer'),
  languageSelect: document.getElementById('languageSelect'),
  recognizeButton: document.getElementById('recognizeButton'),
  asrResult: document.getElementById('asrResult'),
  speakerNameInput: document.getElementById('speakerNameInput'),
  speakerCountSelect: document.getElementById('speakerCountSelect'),
  registerButton: document.getElementById('registerButton'),
  singleTestButton: document.getElementById('singleTestButton'),
  multiTestButton: document.getElementById('multiTestButton'),
  fastMultiTestButton: document.getElementById('fastMultiTestButton'),
  clearSpeakersButton: document.getElementById('clearSpeakersButton'),
  speakerList: document.getElementById('speakerList'),
  speakerModelInfo: document.getElementById('speakerModelInfo'),
  voiceprintResult: document.getElementById('voiceprintResult'),
};

const MODEL_URLS = [
  { key: 'sensevoice', label: 'SenseVoice INT8 + tokens', files: ['sensevoice/model.int8.onnx', 'sensevoice/tokens.txt'] },
  { key: 'voiceprint', label: '3D-Speaker ERes2Net base FP32', files: ['voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'] },
  { key: 'diarization', label: 'Pyannote segmentation INT8', files: ['voiceprint/pyannote_segmentation_3_0_int8.onnx'] },
];

let selectedSamples = null;
let selectedAudioName = '';
let audioObjectUrl = null;
let recording = false;
let recordChunks = [];
let recordContext = null;
let recordStream = null;
let recordSource = null;
let recordProcessor = null;
let recordMute = null;
let recordStartedAt = 0;
let recordTimer = null;
let busy = false;
let runtimeReady = false;

function defaultModelRoot() {
  return new URL('/mnt/aimodel/', window.location.origin).href;
}

function setRuntimeState(state, message) {
  elements.runtimeBadge.textContent = message;
  elements.runtimeBadge.classList.toggle('ready', state === 'ready');
  elements.runtimeBadge.classList.toggle('error', state === 'error');
}

function setBusyState(value) {
  busy = value;
  updateControls();
}

function updateControls() {
  const hasAudio = selectedSamples instanceof Float32Array && selectedSamples.length > 0;
  const canRun = runtimeReady && !busy && !recording && hasAudio;
  for (const button of [elements.recognizeButton, elements.registerButton, elements.singleTestButton, elements.multiTestButton, elements.fastMultiTestButton]) {
    button.disabled = !canRun;
  }
  elements.checkModelsButton.disabled = busy;
  elements.applyModelRootButton.disabled = busy;
  elements.clearSpeakersButton.disabled = busy || elements.speakerList.textContent === '无';
  elements.downloadAudioButton.disabled = !hasAudio || recording;
  elements.audioFileInput.disabled = recording || busy;
  elements.recordButton.disabled = busy;
  elements.recordButton.textContent = recording ? '停止录音' : '开始录音';
}

function updateSpeakerList(names = [], embeddingDim = 0) {
  elements.speakerList.textContent = names.length ? names.join('、') : '无';
  elements.speakerModelInfo.textContent = embeddingDim
    ? `embedding ${embeddingDim} 维 · 匹配阈值 0.50 · 仅当前页面内存`
    : '阈值 0.50 · 尚未加载模型';
  updateControls();
}

function setModelCard(key, text, state = '') {
  const card = elements.modelGrid.querySelector(`[data-model="${key}"] strong`);
  if (!card) return;
  card.textContent = text;
  card.classList.toggle('ready', state === 'ready');
  card.classList.toggle('error', state === 'error');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  const mib = bytes / 1024 / 1024;
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${mib.toFixed(1)} MiB`;
}

function normalizeModelRoot(value) {
  const input = value.trim() || defaultModelRoot();
  const url = new URL(input, window.location.origin);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模型路径必须使用 HTTP 或 HTTPS');
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function setAudio(blob, name, samples) {
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(blob);
  elements.audioPlayer.src = audioObjectUrl;
  elements.audioPlayer.hidden = false;
  selectedSamples = samples;
  selectedAudioName = name;
  const seconds = samples.length / 16000;
  elements.audioStatus.textContent = `${name} · ${seconds.toFixed(2)} 秒 · 16 kHz 单声道 · 本地处理`;
  updateControls();
}

async function decodeAudioFile(file) {
  if (!file) return;
  if (!/\.wav$/i.test(file.name) && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') {
    throw new Error('当前只接受 WAV 音频');
  }
  const context = new AudioContext();
  try {
    const fileBytes = await file.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(fileBytes.slice(0));
    const samples = downmixAudioBuffer(audioBuffer);
    validateSamples(samples);
    setAudio(new Blob([fileBytes], { type: 'audio/wav' }), file.name, samples);
  } finally {
    await context.close();
  }
}

function updateRecordClock() {
  const seconds = Math.min(60, Math.floor((performance.now() - recordStartedAt) / 1000));
  elements.audioStatus.textContent = `正在录音 · ${seconds}/60 秒 · 采样率 ${recordContext?.sampleRate || 0} Hz`;
  if (seconds >= 60) stopRecording();
}

async function releaseRecorder() {
  if (recordTimer) clearInterval(recordTimer);
  recordTimer = null;
  if (recordProcessor) {
    recordProcessor.onaudioprocess = null;
    recordProcessor.disconnect();
    recordProcessor = null;
  }
  recordSource?.disconnect();
  recordSource = null;
  recordMute?.disconnect();
  recordMute = null;
  for (const track of recordStream?.getTracks() || []) track.stop();
  recordStream = null;
  if (recordContext && recordContext.state !== 'closed') await recordContext.close();
  recordContext = null;
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前页面没有麦克风录音能力；请使用 HTTPS 或 localhost');
  recordStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  recordContext = new AudioContext();
  recordSource = recordContext.createMediaStreamSource(recordStream);
  recordProcessor = recordContext.createScriptProcessor(4096, 1, 1);
  recordMute = recordContext.createGain();
  recordMute.gain.value = 0;
  recordChunks = [];
  recordProcessor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    recordChunks.push(channel.slice());
  };
  recordSource.connect(recordProcessor);
  recordProcessor.connect(recordMute);
  recordMute.connect(recordContext.destination);
  recording = true;
  recordStartedAt = performance.now();
  recordTimer = setInterval(updateRecordClock, 250);
  elements.audioStatus.textContent = '正在录音 · 0/60 秒';
  updateControls();
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  const sourceRate = recordContext?.sampleRate || 16000;
  const chunks = recordChunks;
  recordChunks = [];
  try {
    await releaseRecorder();
    const samples = resampleMono(mergeFloatChunks(chunks), sourceRate);
    validateSamples(samples);
    setAudio(encodePcm16Wav(samples), 'microphone-recording.wav', samples);
  } catch (error) {
    elements.audioStatus.textContent = `录音失败：${error.message}`;
  } finally {
    updateControls();
  }
}

async function checkModelUrls() {
  const root = normalizeModelRoot(elements.modelRootInput.value);
  elements.modelRootInput.value = root.href;
  const sameOrigin = root.origin === window.location.origin;
  elements.modelRootNote.textContent = sameOrigin
    ? '同源 Apache 路径；模型只会在首次对应测试时下载。'
    : '跨源模型路径需要服务器允许浏览器 CORS 请求。';
  elements.modelProgress.textContent = '正在检查 Apache 模型文件…';
  for (const model of MODEL_URLS) setModelCard(model.key, '检查中');

  const outcomes = await Promise.all(MODEL_URLS.map(async (model) => {
    const results = await Promise.all(model.files.map(async (file) => {
      const url = new URL(file, root);
      try {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        return { ok: response.ok, status: response.status, size: response.headers.get('content-length') };
      } catch (error) {
        return { ok: false, status: 0, message: error.message };
      }
    }));
    const ok = results.every((result) => result.ok);
    const size = results.reduce((total, result) => total + Number(result.size || 0), 0);
    return { ...model, ok, size, results };
  }));

  for (const outcome of outcomes) {
    setModelCard(outcome.key, outcome.ok ? `可访问 · ${formatBytes(outcome.size)}` : `检查失败 · HTTP ${outcome.results.find((result) => !result.ok)?.status || '网络错误'}`, outcome.ok ? 'ready' : 'error');
  }
  elements.modelProgress.textContent = '路径检查完成。仅第一次运行相应识别流程时才会把模型载入浏览器内存。';
}

function renderSegments(segments) {
  if (!segments?.length) return '（没有可展示的多人分段）';
  return segments.map((segment, index) => {
    const time = `${Number(segment.start).toFixed(2)}–${Number(segment.end).toFixed(2)}s`;
    const score = Number.isFinite(segment.similarityScore) ? ` · 相似度 ${segment.similarityScore.toFixed(3)}` : '';
    const speaker = segment.speaker || '未匹配';
    const text = segment.text || '（未识别到文字）';
    return `${index + 1}. ${time} · cluster ${segment.clusterId} · ${speaker}${score}\n   ${text}${segment.error ? `\n   错误：${segment.error}` : ''}`;
  }).join('\n');
}

function formatVoiceprintResult(result) {
  const rows = [
    `模式：${result.mode}`,
    `识别文本：${result.text || '（未识别到文字）'}`,
    `总耗时：${result.elapsedMs ?? 0} ms`,
    `声纹耗时：${result.embeddingMs ?? 0} ms · 维度：${result.embeddingDim ?? 0}`,
  ];
  if (result.diarizationMs !== undefined) rows.push(`分段耗时：${result.diarizationMs} ms`);
  if (result.asrMs !== undefined) rows.push(`ASR 耗时：${result.asrMs} ms`);
  if (result.matchedSpeaker) rows.push(`匹配：${result.matchedSpeaker} · 相似度 ${Number(result.similarityScore).toFixed(3)} · 阈值 ${result.threshold.toFixed(2)}`);
  if (result.segments?.length) rows.push('', '分段结果：', renderSegments(result.segments));
  return rows.join('\n');
}

async function runRequest(type, payload, target) {
  if (!selectedSamples) throw new Error('请先选择 WAV 或完成录音');
  validateSamples(selectedSamples);
  setBusyState(true);
  target.textContent = '正在加载模型并运行…';
  elements.modelProgress.textContent = 'Worker 正在处理；首次模型下载可能需要一些时间。';
  const transferSamples = selectedSamples.slice();
  try {
    const result = await client.request(type, {
      ...payload,
      samples: transferSamples.buffer,
    }, [transferSamples.buffer]);
    if (result.speakers) updateSpeakerList(result.speakers, result.embeddingDim || Number(elements.speakerModelInfo.textContent.match(/embedding (\d+)/)?.[1]) || 0);
    target.textContent = type === 'recognize'
      ? `${result.text || '（未识别到文字）'}\n\nASR 耗时：${result.elapsedMs} ms`
      : formatVoiceprintResult(result);
    elements.modelProgress.textContent = '本次推理完成；已加载模型保留在当前 Worker 内存中。';
    return result;
  } catch (error) {
    target.textContent = `测试失败：${error.message}`;
    elements.modelProgress.textContent = `推理失败：${error.message}`;
    throw error;
  } finally {
    setBusyState(false);
  }
}

function onWorkerEvent(message) {
  if (message.type === 'runtime-ready') {
    runtimeReady = true;
    setRuntimeState('ready', 'WASM 已就绪');
    elements.modelProgress.textContent = 'WASM 已就绪；模型尚未下载。';
    client.request('status').then((status) => updateSpeakerList(status.registeredSpeakers, status.embeddingDim)).catch(() => {});
    checkModelUrls().catch((error) => {
      elements.modelProgress.textContent = `模型路径检查失败：${error.message}`;
    });
    updateControls();
    return;
  }
  if (message.type === 'runtime-error' || message.type === 'worker-error') {
    setRuntimeState('error', 'WASM 初始化失败');
    elements.modelProgress.textContent = message.message || 'WASM Worker 启动失败';
    return;
  }
  if (message.type === 'model-progress') {
    const progress = message.total
      ? `${message.filename} · ${formatBytes(message.loaded)} / ${formatBytes(message.total)} · ${message.percent}%`
      : `${message.filename} · 已下载 ${formatBytes(message.loaded)}`;
    elements.modelProgress.textContent = progress;
    return;
  }
  if (message.type === 'model-state') {
    const labels = { asr: 'SenseVoice', speaker: '3D-Speaker base', diarization: 'Pyannote INT8' };
    const cardKey = message.key === 'asr' ? 'sensevoice' : message.key === 'speaker' ? 'voiceprint' : 'diarization';
    const labelsByState = { loading: '加载中…', ready: '已加载', error: '加载失败' };
    setModelCard(cardKey, labelsByState[message.state] || '待加载', message.state);
    if (message.message) elements.modelProgress.textContent = `${labels[message.key]}：${message.message}`;
    return;
  }
  if (message.type === 'speaker-list') updateSpeakerList(message.names, message.embeddingDim);
  if (message.type === 'busy-state') setBusyState(message.busy);
  if (message.type === 'configured') elements.modelRootNote.textContent = `已应用模型目录：${message.modelRoot}`;
}

const client = createWorkerClient(new URL('./asr-worker.js', import.meta.url), onWorkerEvent);
elements.modelRootInput.value = defaultModelRoot();
client.send('configure', { modelRoot: elements.modelRootInput.value });

elements.audioFileInput.addEventListener('change', async () => {
  const file = elements.audioFileInput.files?.[0];
  if (!file) return;
  elements.audioStatus.textContent = `正在解码：${file.name}`;
  try {
    await decodeAudioFile(file);
    elements.voiceprintResult.textContent = '音频已就绪，可注册或进行声纹测试。';
  } catch (error) {
    selectedSamples = null;
    elements.audioStatus.textContent = `音频读取失败：${error.message}`;
  }
  updateControls();
});

elements.recordButton.addEventListener('click', async () => {
  try {
    if (recording) await stopRecording();
    else await startRecording();
  } catch (error) {
    await releaseRecorder();
    recording = false;
    elements.audioStatus.textContent = `录音失败：${error.message}`;
  }
  updateControls();
});

elements.downloadAudioButton.addEventListener('click', () => {
  if (!selectedSamples) return;
  const wav = selectedAudioName.toLowerCase().endsWith('.wav') && audioObjectUrl
    ? audioObjectUrl
    : URL.createObjectURL(encodePcm16Wav(selectedSamples));
  const link = document.createElement('a');
  link.href = wav;
  link.download = selectedAudioName || 'asr-recording.wav';
  link.click();
  if (wav !== audioObjectUrl) URL.revokeObjectURL(wav);
});

elements.checkModelsButton.addEventListener('click', async () => {
  try {
    await checkModelUrls();
  } catch (error) {
    elements.modelProgress.textContent = `路径检查失败：${error.message}`;
  }
});

elements.applyModelRootButton.addEventListener('click', async () => {
  try {
    const root = normalizeModelRoot(elements.modelRootInput.value);
    elements.modelRootInput.value = root.href;
    client.send('configure', { modelRoot: root.href });
    await checkModelUrls();
  } catch (error) {
    elements.modelRootNote.textContent = error.message;
  }
});

elements.recognizeButton.addEventListener('click', () => {
  runRequest('recognize', { language: elements.languageSelect.value }, elements.asrResult).catch(() => {});
});

elements.registerButton.addEventListener('click', () => {
  runRequest('register', { name: elements.speakerNameInput.value }, elements.voiceprintResult)
    .then((result) => { elements.voiceprintResult.textContent = `已注册：${result.name}\nembedding 维度：${result.embeddingDim}\n耗时：${result.elapsedMs} ms\n\n声纹仅保存在当前页面内存。`; })
    .catch(() => {});
});

function runVoiceprintTest(mode) {
  return runRequest('voiceprintTest', {
    mode,
    language: elements.languageSelect.value,
    speakerCount: Number(elements.speakerCountSelect.value),
  }, elements.voiceprintResult).catch(() => {});
}

elements.singleTestButton.addEventListener('click', () => runVoiceprintTest('SHERPA_SINGLE'));
elements.multiTestButton.addEventListener('click', () => runVoiceprintTest('SHERPA_MULTI'));
elements.fastMultiTestButton.addEventListener('click', () => runVoiceprintTest('SHERPA_MULTI_FAST'));
elements.clearSpeakersButton.addEventListener('click', async () => {
  try {
    const result = await client.request('clearSpeakers');
    updateSpeakerList(result.speakers);
    elements.voiceprintResult.textContent = '已清空当前页面内存中的声纹注册。';
  } catch (error) {
    elements.voiceprintResult.textContent = `清空失败：${error.message}`;
  }
});

window.addEventListener('beforeunload', () => {
  if (recording) releaseRecorder();
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  client.send('shutdown');
  client.terminate();
});

updateControls();
