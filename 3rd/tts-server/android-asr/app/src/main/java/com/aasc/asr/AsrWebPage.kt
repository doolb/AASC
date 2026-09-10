package com.aasc.asr

// 内置普通网页，避免 HTTP 测试时还需要手写请求或依赖外部静态资源。
object AsrWebPage {
    const val HTML = """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>离线语音识别与 Sherpa 声纹测试</title>
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
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
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
    <button id="playCurrentAudio" type="button" disabled>播放当前 WAV</button>
    <button id="saveCurrentAudio" type="button" disabled>保存当前 WAV</button>
    <button id="stopCurrentAudio" type="button" disabled>停止播放</button>
    <audio id="currentAudio" controls preload="metadata" hidden></audio>
    <label><input id="asrDenoise" type="checkbox"> ASR 文字降噪（GTCRN）</label>
    <button id="recognize" type="button">开始识别</button>
    <p id="fileStatus" class="muted">尚未选择音频</p>
  </section>
  <section>
    <h2>识别文本</h2>
    <div id="result">等待识别</div>
    <p id="elapsed" class="muted"></p>
  </section>
  <section>
    <h2>Sherpa 声纹测试</h2>
    <p id="voiceprintStatus" class="muted">正在检查声纹模型状态…</p>
    <p class="muted">先在上方选择 WAV，填写名称并注册；随后选择待测 WAV，运行单段或多段流程。</p>
    <label for="speakerName">注册名称</label><br>
    <input id="speakerName" type="text" placeholder="例如 ZH 或 EN">
    <br>
    <label><input id="voiceprintDenoise" type="checkbox"> 声纹降噪（GTCRN）</label>
    <p class="muted">声纹注册、分段和匹配使用此开关；注册与测试请保持设置一致。</p>
    <button id="registerSpeaker" type="button">注册当前音频</button>
    <button id="testSingle" type="button">Sherpa 单段</button>
    <button id="testMulti" type="button">Sherpa 多段</button>
    <button id="testMultiFast" type="button">Sherpa 快速多段</button>
    <label for="speakerCount">多段模式实际人数</label>
    <select id="speakerCount">
      <option value="AUTO">自动</option>
      <option value="1">1 人</option>
      <option value="2">2 人</option>
      <option value="3">3 人</option>
      <option value="4">4 人</option>
      <option value="5">5 人</option>
    </select>
    <pre id="voiceprintResult">等待声纹测试</pre>
  </section>
  <section>
    <h2>Sherpa 流式 ASR</h2>
    <p class="muted">通过浏览器麦克风实时发送 16 kHz PCM，服务端返回增量文本。</p>
    <button id="streamStart" type="button">开始流式识别</button>
    <button id="streamFile" type="button">流式发送当前 WAV</button>
    <button id="streamStop" type="button" disabled>停止并获取最终结果</button>
    <pre id="streamResult">等待流式识别</pre>
  </section>
  <script>
    const audio = document.getElementById('audio');
    const record = document.getElementById('record');
    const recognize = document.getElementById('recognize');
    const playCurrentAudio = document.getElementById('playCurrentAudio');
    const saveCurrentAudio = document.getElementById('saveCurrentAudio');
    const stopCurrentAudioButton = document.getElementById('stopCurrentAudio');
    const currentAudio = document.getElementById('currentAudio');
    const health = document.getElementById('health');
    const fileStatus = document.getElementById('fileStatus');
    const result = document.getElementById('result');
    const elapsed = document.getElementById('elapsed');
    const voiceprintStatus = document.getElementById('voiceprintStatus');
    const speakerName = document.getElementById('speakerName');
    const asrDenoise = document.getElementById('asrDenoise');
    const voiceprintDenoise = document.getElementById('voiceprintDenoise');
    const registerSpeaker = document.getElementById('registerSpeaker');
    const testSingle = document.getElementById('testSingle');
    const testMulti = document.getElementById('testMulti');
    const testMultiFast = document.getElementById('testMultiFast');
    const speakerCount = document.getElementById('speakerCount');
    const voiceprintResult = document.getElementById('voiceprintResult');
    const streamStart = document.getElementById('streamStart');
    const streamFile = document.getElementById('streamFile');
    const streamStop = document.getElementById('streamStop');
    const streamResult = document.getElementById('streamResult');
    let selectedAudio = null;
    let selectedAudioName = '';
    let currentAudioUrl = null;
    let recording = false;
    let mediaStream = null;
    let audioContext = null;
    let mediaSource = null;
    let processor = null;
    let silentGain = null;
    let recordingChunks = [];
    let recordingSampleRate = 0;
    let streamSocket = null;
    let streamMediaStream = null;
    let streamAudioContext = null;
    let streamSource = null;
    let streamProcessor = null;
    let streamSilentGain = null;
    let streaming = false;

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

    function encodePcm16(samples) {
      const buffer = new ArrayBuffer(samples.length * 2);
      const view = new DataView(buffer);
      samples.forEach((sample, index) => {
        const clipped = Math.max(-1, Math.min(1, sample));
        view.setInt16(index * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
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

    function stopCurrentAudio() {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      stopCurrentAudioButton.disabled = true;
      playCurrentAudio.disabled = !selectedAudio;
      saveCurrentAudio.disabled = !selectedAudio;
    }

    function setSelectedAudio(value, name) {
      stopCurrentAudio();
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
      selectedAudio = value || null;
      selectedAudioName = name || '';
      if (selectedAudio) {
        currentAudioUrl = URL.createObjectURL(selectedAudio);
        currentAudio.src = currentAudioUrl;
        currentAudio.hidden = false;
        playCurrentAudio.disabled = false;
        saveCurrentAudio.disabled = false;
        fileStatus.textContent = '已选择：' + selectedAudioName;
      } else {
        currentAudio.removeAttribute('src');
        currentAudio.load();
        currentAudio.hidden = true;
        playCurrentAudio.disabled = true;
        saveCurrentAudio.disabled = true;
        fileStatus.textContent = '尚未选择音频';
      }
    }

    async function startRecording() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器录音需要 HTTPS 或 localhost 安全页面');
      }
      stopCurrentAudio();
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
      setSelectedAudio(new Blob([encodeWav(samples)], { type: 'audio/wav' }), 'browser-recording.wav');
      record.textContent = '开始录音';
      fileStatus.textContent = '录音完成：' + Math.round(samples.length / 16000) + ' 秒';
      releaseRecorder();
    }

    function releaseStreamingRecorder() {
      if (streamProcessor) streamProcessor.disconnect();
      if (streamSource) streamSource.disconnect();
      if (streamSilentGain) streamSilentGain.disconnect();
      if (streamMediaStream) streamMediaStream.getTracks().forEach((track) => track.stop());
      if (streamAudioContext) streamAudioContext.close();
      streamProcessor = null;
      streamSource = null;
      streamSilentGain = null;
      streamMediaStream = null;
      streamAudioContext = null;
    }

    function connectStreamingSocket() {
      const WebSocketClass = window.WebSocket;
      if (!WebSocketClass) throw new Error('浏览器不支持 WebSocket');
      streamResult.textContent = '连接流式 ASR…';
      const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      streamSocket = new WebSocketClass(protocol + location.host + '/api/asr/stream');
      streamSocket.binaryType = 'arraybuffer';
      streamSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'partial') streamResult.textContent = data.text || '（等待文本）';
          if (data.type === 'final') {
            streamResult.textContent = data.text || '（未识别到文本）';
            stopStreaming(false);
          }
          if (data.type === 'error') streamResult.textContent = '流式识别失败：' + data.error;
        } catch (error) {
          streamResult.textContent = '流式响应格式错误：' + error.message;
        }
      };
      return new Promise((resolve, reject) => {
        streamSocket.addEventListener('open', resolve, { once: true });
        streamSocket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
      });
    }

    async function startStreaming() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器录音需要 HTTPS 或 localhost 安全页面；也可以使用“流式发送当前 WAV”');
      }
      const WebSocketClass = window.WebSocket;
      await connectStreamingSocket();
      streamMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('浏览器不支持 AudioContext');
      streamAudioContext = new AudioContextClass();
      streamSource = streamAudioContext.createMediaStreamSource(streamMediaStream);
      streamProcessor = streamAudioContext.createScriptProcessor(4096, 1, 1);
      streamSilentGain = streamAudioContext.createGain();
      streamSilentGain.gain.value = 0;
      streamProcessor.onaudioprocess = (event) => {
        if (!streamSocket || streamSocket.readyState !== WebSocketClass.OPEN) return;
        const input = new Float32Array(event.inputBuffer.getChannelData(0));
        const pcm = encodePcm16(resample(input, streamAudioContext.sampleRate, 16000));
        streamSocket.send(pcm);
      };
      streamSource.connect(streamProcessor);
      streamProcessor.connect(streamSilentGain);
      streamSilentGain.connect(streamAudioContext.destination);
      streaming = true;
      streamStart.disabled = true;
      streamFile.disabled = true;
      streamStop.disabled = false;
      streamResult.textContent = '流式识别中…';
    }

    async function startStreamingFile() {
      if (!selectedAudio) throw new Error('请先选择 WAV 音频');
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('浏览器不支持 AudioContext');
      const decodeContext = new AudioContextClass();
      try {
        const audioBuffer = await decodeContext.decodeAudioData(await selectedAudio.arrayBuffer());
        const channelCount = audioBuffer.numberOfChannels;
        const channelData = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));
        const mono = new Float32Array(audioBuffer.length);
        for (let index = 0; index < mono.length; index += 1) {
          mono[index] = channelData.reduce((total, channel) => total + channel[index], 0) / channelCount;
        }
        const samples = resample(mono, audioBuffer.sampleRate, 16000);
        await connectStreamingSocket();
        streaming = true;
        streamStart.disabled = true;
        streamFile.disabled = true;
        streamStop.disabled = false;
        streamResult.textContent = 'WAV 流式发送中…';
        for (let offset = 0; offset < samples.length; offset += 3200) {
          if (!streamSocket || streamSocket.readyState !== WebSocket.OPEN) throw new Error('WebSocket 已断开');
          streamSocket.send(encodePcm16(samples.slice(offset, offset + 3200)));
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        stopStreaming(true);
      } finally {
        await decodeContext.close();
      }
    }

    function stopStreaming(sendEnd = true) {
      const socket = streamSocket;
      streaming = false;
      streamStart.disabled = false;
      streamFile.disabled = false;
      streamStop.disabled = true;
      releaseStreamingRecorder();
      if (sendEnd && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'end' }));
        streamResult.textContent = '正在整理最终结果…';
        return;
      }
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
      streamSocket = null;
    }

    async function loadHealth() {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        health.textContent = data.modelReady
          ? '模型已就绪｜流式 ASR：' + (data.streamingReady ? '已就绪' : '未就绪') + '｜CPU：' + (data.cpuMode || 'AUTO')
          : '模型尚未就绪';
        health.classList.toggle('error', !data.modelReady);
        const voiceprintResponse = await fetch('/api/voiceprint/status');
        const voiceprint = await voiceprintResponse.json();
        voiceprintStatus.textContent = voiceprint.modelReady
          ? 'Sherpa 声纹模型已就绪｜维度：' + voiceprint.embeddingDim + '｜已注册：' + voiceprint.speakers.join(', ')
          : 'Sherpa 声纹模型尚未就绪';
        voiceprintStatus.classList.toggle('error', !voiceprint.modelReady);
      } catch (error) {
        health.textContent = '状态检查失败：' + error.message;
        health.classList.add('error');
      }
    }

    audio.addEventListener('change', () => {
      const file = audio.files[0];
      setSelectedAudio(file || null, file ? file.name : '');
    });

    playCurrentAudio.addEventListener('click', async () => {
      if (!selectedAudio) return;
      try {
        await currentAudio.play();
        stopCurrentAudioButton.disabled = false;
      } catch (error) {
        fileStatus.textContent = '播放失败：' + error.message;
      }
    });

    saveCurrentAudio.addEventListener('click', () => {
      if (!selectedAudio) return;
      const link = document.createElement('a');
      link.href = currentAudioUrl;
      link.download = selectedAudioName.toLowerCase().endsWith('.wav') ? selectedAudioName : 'asr-recording.wav';
      document.body.appendChild(link);
      link.click();
      link.remove();
      fileStatus.textContent = '已开始保存：' + link.download;
    });

    stopCurrentAudioButton.addEventListener('click', () => stopCurrentAudio());
    currentAudio.addEventListener('ended', () => {
      stopCurrentAudioButton.disabled = true;
      playCurrentAudio.disabled = !selectedAudio;
    });
    window.addEventListener('beforeunload', () => {
      stopCurrentAudio();
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
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
        const query = new URLSearchParams({ language: 'zh' });
        query.set('asrDenoise', asrDenoise.checked ? '1' : '0');
        const response = await fetch('/api/asr?' + query.toString(), {
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

    registerSpeaker.addEventListener('click', async () => {
      if (!selectedAudio) {
        voiceprintResult.textContent = '请先选择注册 WAV';
        return;
      }
      if (!speakerName.value.trim()) {
        voiceprintResult.textContent = '请填写注册名称';
        return;
      }
      registerSpeaker.disabled = true;
      voiceprintResult.textContent = '注册中…';
      try {
        const query = new URLSearchParams({
          name: speakerName.value.trim(),
          voiceprintDenoise: voiceprintDenoise.checked ? '1' : '0'
        });
        const response = await fetch('/api/voiceprint/register?' + query.toString(), {
          method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: selectedAudio
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '注册失败');
        voiceprintResult.textContent = '已注册：' + data.name + '（embedding 维度：' + data.embeddingDim + '）';
        loadHealth();
      } catch (error) {
        voiceprintResult.textContent = '注册失败：' + error.message;
      } finally {
        registerSpeaker.disabled = false;
      }
    });

    async function testVoiceprint(mode, button) {
      if (!selectedAudio) {
        voiceprintResult.textContent = '请先选择待测 WAV';
        return;
      }
      button.disabled = true;
      testSingle.disabled = true;
      testMulti.disabled = true;
      testMultiFast.disabled = true;
      voiceprintResult.textContent = '测试中…';
      try {
        const query = new URLSearchParams({
          mode,
          asrDenoise: asrDenoise.checked ? '1' : '0',
          voiceprintDenoise: voiceprintDenoise.checked ? '1' : '0',
          language: 'zh'
        });
        if (mode === 'SHERPA_MULTI' || mode === 'SHERPA_MULTI_FAST') query.set('speakerCount', speakerCount.value);
        const response = await fetch('/api/voiceprint/test?' + query.toString(), {
          method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: selectedAudio
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '测试失败');
        voiceprintResult.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        voiceprintResult.textContent = '测试失败：' + error.message;
      } finally {
        testSingle.disabled = false;
        testMulti.disabled = false;
        testMultiFast.disabled = false;
      }
    }

    testSingle.addEventListener('click', () => testVoiceprint('SHERPA_SINGLE', testSingle));
    testMulti.addEventListener('click', () => testVoiceprint('SHERPA_MULTI', testMulti));
    testMultiFast.addEventListener('click', () => testVoiceprint('SHERPA_MULTI_FAST', testMultiFast));

    streamStart.addEventListener('click', async () => {
      if (streaming) return;
      try {
        await startStreaming();
      } catch (error) {
        stopStreaming(false);
        streamResult.textContent = '流式启动失败：' + error.message;
      }
    });
    streamFile.addEventListener('click', async () => {
      if (streaming) return;
      try {
        await startStreamingFile();
      } catch (error) {
        stopStreaming(false);
        streamResult.textContent = 'WAV 流式启动失败：' + error.message;
      }
    });
    streamStop.addEventListener('click', () => stopStreaming(true));

    loadHealth();
  </script>
</body>
</html>
"""
}
