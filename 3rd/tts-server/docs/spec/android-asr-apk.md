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
```

## HTTP 服务

```text
startHttp(port):
    server = ServerSocket(0.0.0.0, port)
    while running:
        socket = server.accept()
        dispatch socket on httpExecutor

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
