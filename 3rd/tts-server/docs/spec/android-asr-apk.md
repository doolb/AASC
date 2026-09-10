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

## 真机部署验收伪代码

```text
build:
    execute npm --prefix 3rd/tts-server run build:android-asr
    require Gradle assembleDebug succeeds
    apk = android-asr/app/build/outputs/apk/debug/app-debug.apk

install:
    device = adb device 192.168.1.6:5555
    adb install -r apk
    adb grant com.aasc.asr RECORD_AUDIO
    adb launch com.aasc.asr/.MainActivity

verify:
    require package versionName == 0.1.0
    require process com.aasc.asr is alive
    require resumedActivity == com.aasc.asr/.MainActivity
    require startup log has Sherpa model initialization
    reject FATAL EXCEPTION or AndroidRuntime crash log

## 2026-09-10 声纹匹配分数与阈值伪代码

```text
voiceprintThreshold = configured threshold, default 0.5
registeredEmbeddings = current speaker name -> embedding map

setDatabase(database):
    speakerManager.replace database
    registeredEmbeddings = copy database for diagnostics

match(embedding):
    matchedSpeaker = speakerManager.search(embedding, voiceprintThreshold)
    bestSpeaker, bestScore = registeredEmbeddings
        map each speaker embedding to cosineSimilarity(embedding, speaker embedding)
        choose the highest score
    if matchedSpeaker exists:
        similarityScore = cosineSimilarity(embedding, registeredEmbeddings[matchedSpeaker])
    else:
        similarityScore = bestScore or null
    return matchedSpeaker, similarityScore, voiceprintThreshold

singleTest:
    match = match(fullAudioEmbedding)
    return matchedSpeaker = match.speaker,
        similarityScore = match.score,
        threshold = match.threshold

multiTest:
    for each segment:
        match = match(segmentEmbedding)
        return speaker = match.speaker,
            similarityScore = match.score
    return threshold = voiceprintThreshold

voiceprintStatus:
    return modelReady, embeddingDim, registered speakers,
        threshold = voiceprintThreshold

voiceprintResultJson:
    serialize top-level similarityScore and threshold
    serialize each segment similarityScore
    keep existing speaker/matchedSpeaker values unchanged
```

## 2026-09-10 声纹分段后处理优化伪代码

```text
diarizeAudio(samples, speakerCount):
    rawSegments = sherpaDiarization.process(samples, speakerCount)
    candidateSegments = mergeAdjacentSegmentsWithSameCluster(rawSegments)
    return candidateSegments

matchSegment(samples, segment):
    segmentSamples = slice(samples, segment.start, segment.end)
    embedding = voiceprintExtractor.compute(segmentSamples)
    match = match(embedding)
    return segment.withMatch(match)

postProcessSegments(samples, candidateSegments):
    matchedSegments = candidateSegments.map(segment -> matchSegment(samples, segment))
    result = empty list
    index = 0
    while index < matchedSegments.size:
        current = matchedSegments[index]
        if current.isShortVoiceprintCandidate and current.isUnknown:
            neighbor = findAdjacentKnownSpeaker(result, matchedSegments, index)
            if neighbor exists:
                combined = combineAudioIntervals(neighbor, current)
                combinedMatch = matchSegment(samples, combined.interval)
                if combinedMatch.speaker == neighbor.speaker:
                    replace neighbor and current with combinedMatch
                    index = next unconsumed segment
                    continue
        append current to result
        index += 1
    return mergeAdjacentSegmentsWithSameRegisteredSpeaker(result)

multiTest:
    candidates = diarizeAudio(samples, speakerCount)
    finalSegments = postProcessSegments(samples, candidates)
    for segment in finalSegments:
        text = asrEngine.recognize(slice(samples, segment.start, segment.end), "zh")
        return segment.start, segment.end, segment.clusterId,
            segment.speaker, segment.similarityScore, text

testRequest:
    pass speakerCount to both SHERPA_MULTI and SHERPA_MULTI_FAST
    default speakerCount = AUTO
```

## 2026-09-10 ASR 文字与声纹双降噪伪代码

```text
resolveDenoiseFlags(request):
    legacy = request.denoise
    asrDenoise = request.asrDenoise if present else legacy
    voiceprintDenoise = request.voiceprintDenoise if present else legacy
    return asrDenoise, voiceprintDenoise

prepareVoiceprintTestAudio(samples, asrDenoise, voiceprintDenoise):
    if asrDenoise == voiceprintDenoise:
        shared = prepareAudio(samples, asrDenoise)
        return asrAudio = shared, voiceprintAudio = shared
    return asrAudio = prepareAudio(samples, asrDenoise),
        voiceprintAudio = prepareAudio(samples, voiceprintDenoise)

ordinaryAsrRequest:
    asrDenoise = request.asrDenoise if present else request.denoise
    asrAudio = prepareAudio(samples, asrDenoise)
    result = asrEngine.recognize(asrAudio.samples, "zh")
    return text, elapsedMs, asrDenoise, asrAudio.elapsedMs

voiceprintRegisterRequest:
    voiceprintDenoise = request.voiceprintDenoise if present else request.denoise
    voiceprintAudio = prepareAudio(samples, voiceprintDenoise)
    embedding = voiceprintExtractor.compute(voiceprintAudio.samples)
    save embedding
    return voiceprintDenoise, voiceprintAudio.elapsedMs

voiceprintTestRequest:
    asrDenoise, voiceprintDenoise = resolveDenoiseFlags(request)
    asrAudio, voiceprintAudio = prepareVoiceprintTestAudio(
        samples, asrDenoise, voiceprintDenoise
    )
    segments = diarizeAndMatch(voiceprintAudio.samples, speakerCount)
    for segment in segments:
        text = asrEngine.recognize(slice(asrAudio.samples, segment.start, segment.end), "zh")
    return legacy denoise = voiceprintDenoise,
        asrDenoise, voiceprintDenoise,
        asrDenoiseMs, voiceprintDenoiseMs,
        segments and text

webPage:
    show checkbox "ASR 文字降噪" for /api/asr
    show checkbox "声纹降噪" for registration and voiceprint test
    submit asrDenoise for text recognition
    submit voiceprintDenoise for registration and voiceprint test
```

验证：Android JVM 全量单元测试 52 个通过；Debug APK 构建并安装到 `SM-N9500` 真机；独立开关、同时开启复用和旧 `denoise` 参数均完成 WAV 回归。
