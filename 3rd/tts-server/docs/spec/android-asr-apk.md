# 独立 Android 离线语音识别 APK 实现伪代码

## 模型构建和加载

```text
requiredFiles = ["model.int8.onnx", "tokens.txt"]
copy requiredFiles from res/models/sensevoice to build/generated/assets/asr
package assets/asr and arm64-v8a libcpu-affinity.so

on application start:
    copy assets/asr to filesDir/models/sensevoice using temporary files
    apply selectedCpuMode
    recognizer = OfflineRecognizer(16kHz, SenseVoice model, tokens, cpu)
    state = ready or error
```

## 音频输入

```text
recordButton.toggle:
    if recording is false:
        request RECORD_AUDIO permission
        start AudioRecord(16000, mono, PCM_16BIT)
        state = recording
    else:
        stop AudioRecord
        save PCM as temporary WAV
        state = audioReady

selectAudio:
    uri = ACTION_OPEN_DOCUMENT(audio/*)
    bytes = read uri
    if WAV PCM:
        samples = decode WAV and resample to 16kHz mono
    else:
        decoded = Android MediaExtractor + MediaCodec
        samples = resample decoded PCM to 16kHz mono
selectedAudio = samples

saveCurrentWav:
    reject when selectedAudio is null or empty
    wav = encode selectedAudio as PCM 16-bit, mono, 16kHz WAV
    if Android version >= 10:
        insert wav into MediaStore Downloads with MIME audio/wav
    else:
        write wav to app-specific external Music directory
    show saved file name in audio status
```

## 识别流程

```text
recognize(samples):
    reject when model state is not ready
    reject when samples is empty or duration > 60 seconds
    acquire singleRecognitionLock
    apply selectedCpuMode
    start = monotonicMilliseconds()
    stream = recognizer.createStream()
    stream.acceptWaveform(samples, 16000)
    recognizer.decode(stream)
    text = recognizer.getResult(stream).text
    release stream
    elapsedMs = monotonicMilliseconds() - start
    return text, elapsedMs

webAndNativeOfflineAsr:
    do not expose a language selector in the test page
    submit ordinary offline ASR and voiceprint segment ASR with language = "zh"
    keep the HTTP language parameter for direct external compatibility
    keep streaming ASR on the fixed bilingual Zipformer model
```

## HTTP 服务

```text
startHttp(port):
    server = ServerSocket(0.0.0.0, port)
    while running:
        socket = server.accept()
        dispatch socket on httpExecutor

GET /:
    return embedded HTML page
    page shows file picker, record button, play current WAV button, save current WAV button,
        recognize button, result text and elapsed time
    browser recording requests microphone permission
    recording PCM is downmixed/resampled and encoded to 16kHz mono WAV in browser
    page fetches /health and submits selected WAV bytes to /api/asr
    save button downloads the selected current WAV with a .wav file name

GET /health:
    return JSON(modelState, httpRunning, cpuModeStatus)

POST /api/asr:
    if another recognition is active:
        return 409 busy
    body = read request body with size limit
    samples = decode WAV or interpret raw PCM
    text, elapsedMs = recognize(samples)
    return JSON(success=true, text, elapsedMs)

on stop:
    close server socket
    reject new connections
```

## CPU 模式

```text
selectedCpuMode = SharedPreferences.get("cpu_mode", AUTO)
on mode changed:
    SharedPreferences.put("cpu_mode", selectedCpuMode)
    status = CpuAffinity.apply(selectedCpuMode)
    display status
```

## 2026-08-29 移除其他文字过滤

```text
supportedLanguage = auto | zh | en
拒绝 zh-en-filter 参数
普通 ASR、声纹分段 ASR -> 返回 recognizer text.trim()
不执行 Unicode 脚本过滤，不删除日文、韩文或其他文字
```
