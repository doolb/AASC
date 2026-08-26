package com.aasc.asr

// 内置普通网页，避免 HTTP 测试时还需要手写请求或依赖外部静态资源。
object AsrWebPage {
    const val HTML = """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>离线语音识别</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 720px; margin: 0 auto; padding: 24px; line-height: 1.5; }
    h1 { margin-top: 0; }
    section { padding: 16px; margin-top: 16px; border: 1px solid #8885; border-radius: 10px; }
    button, input { font: inherit; }
    button { margin-top: 12px; padding: 8px 18px; cursor: pointer; }
    #result { white-space: pre-wrap; min-height: 96px; padding: 12px; background: #8882; border-radius: 6px; }
    .muted { opacity: .75; }
    .error { color: #d33; }
  </style>
</head>
<body>
  <h1>离线语音识别</h1>
  <p id="health" class="muted">正在检查模型状态…</p>
  <section>
    <label for="audio">选择 WAV 音频</label><br>
    <input id="audio" type="file" accept="audio/wav,.wav">
    <br>
    <button id="record" type="button">开始录音</button>
    <button id="recognize" type="button">开始识别</button>
    <p id="fileStatus" class="muted">尚未选择音频</p>
  </section>
  <section>
    <h2>识别文本</h2>
    <div id="result">等待识别</div>
    <p id="elapsed" class="muted"></p>
  </section>
  <script>
    const audio = document.getElementById('audio');
    const record = document.getElementById('record');
    const recognize = document.getElementById('recognize');
    const health = document.getElementById('health');
    const fileStatus = document.getElementById('fileStatus');
    const result = document.getElementById('result');
    const elapsed = document.getElementById('elapsed');
    let selectedAudio = null;
    let selectedAudioName = '';
    let recording = false;
    let mediaStream = null;
    let audioContext = null;
    let mediaSource = null;
    let processor = null;
    let silentGain = null;
    let recordingChunks = [];
    let recordingSampleRate = 0;

    function mergeChunks(chunks) {
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const merged = new Float32Array(length);
      let offset = 0;
      chunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.length;
      });
      return merged;
    }

    function resample(samples, sourceRate, targetRate) {
      if (sourceRate === targetRate) return samples;
      const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
      const output = new Float32Array(outputLength);
      const ratio = sourceRate / targetRate;
      for (let index = 0; index < outputLength; index += 1) {
        const position = index * ratio;
        const left = Math.floor(position);
        const right = Math.min(left + 1, samples.length - 1);
        const weight = position - left;
        output[index] = samples[left] * (1 - weight) + samples[right] * weight;
      }
      return output;
    }

    function encodeWav(samples) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeText = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
      writeText(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeText(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      samples.forEach((sample, index) => {
        const clipped = Math.max(-1, Math.min(1, sample));
        view.setInt16(44 + index * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
      });
      return buffer;
    }

    function releaseRecorder() {
      if (processor) processor.disconnect();
      if (mediaSource) mediaSource.disconnect();
      if (silentGain) silentGain.disconnect();
      if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
      if (audioContext) audioContext.close();
      processor = null;
      mediaSource = null;
      silentGain = null;
      mediaStream = null;
      audioContext = null;
    }

    async function startRecording() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器录音需要 HTTPS 或 localhost 安全页面');
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('浏览器不支持 AudioContext');
      audioContext = new AudioContextClass();
      mediaSource = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      recordingChunks = [];
      recordingSampleRate = audioContext.sampleRate;
      processor.onaudioprocess = (event) => {
        recordingChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      mediaSource.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      recording = true;
      record.textContent = '停止录音';
      fileStatus.textContent = '录音中…';
    }

    function stopRecording() {
      if (!recording) return;
      recording = false;
      const samples = resample(mergeChunks(recordingChunks), recordingSampleRate, 16000);
      selectedAudio = new Blob([encodeWav(samples)], { type: 'audio/wav' });
      selectedAudioName = 'browser-recording.wav';
      record.textContent = '开始录音';
      fileStatus.textContent = '录音完成：' + Math.round(samples.length / 16000) + ' 秒';
      releaseRecorder();
    }

    async function loadHealth() {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        health.textContent = data.modelReady
          ? '模型已就绪｜CPU：' + (data.cpuMode || 'AUTO')
          : '模型尚未就绪';
        health.classList.toggle('error', !data.modelReady);
      } catch (error) {
        health.textContent = '状态检查失败：' + error.message;
        health.classList.add('error');
      }
    }

    audio.addEventListener('change', () => {
      const file = audio.files[0];
      selectedAudio = file || null;
      selectedAudioName = file ? file.name : '';
      fileStatus.textContent = file ? '已选择：' + file.name : '尚未选择音频';
    });

    record.addEventListener('click', async () => {
      if (recording) {
        stopRecording();
        return;
      }
      try {
        await startRecording();
      } catch (error) {
        releaseRecorder();
        fileStatus.textContent = '录音失败：' + error.message;
      }
    });

    recognize.addEventListener('click', async () => {
      if (!selectedAudio) {
        result.textContent = '请先选择 WAV 音频';
        return;
      }
      if (!selectedAudioName.toLowerCase().endsWith('.wav')) {
        result.textContent = '网页上传目前只支持 WAV 音频';
        return;
      }
      recognize.disabled = true;
      result.textContent = '识别中…';
      elapsed.textContent = '';
      try {
        const response = await fetch('/api/asr', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: selectedAudio
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '识别失败');
        result.textContent = data.text || '（未识别到文本）';
        elapsed.textContent = '识别耗时：' + data.elapsedMs + ' ms';
      } catch (error) {
        result.textContent = '识别失败：' + error.message;
      } finally {
        recognize.disabled = false;
      }
    });

    loadHealth();
  </script>
</body>
</html>
"""
}
