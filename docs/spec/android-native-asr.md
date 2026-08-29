# Android 原生语音识别（sherpa-onnx AAR）实现文档（伪代码）

## 桥接口（window.NativeDisplay）

APK 通过 `addJavascriptInterface` 注入，display.html 探测到 `window.NativeDisplay` 后新增 ASR 能力（与 compute 桥共用同一对象）。

```
asrStatus() -> String JSON            # {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
asrEnsureModel() -> String            # "ready" | "downloading" | {"error":"..."}；异步下载经 onNativeAsrModel 回调
asrRecognizeAsync(requestId, pcmBase64, useVoiceprint, multiSpeaker) -> String JSON # 立即返回 accepted；结果经 onNativeAsrResult 回调
asrRecognize(pcmBase64) -> String JSON # 旧 APK 兼容入口；同步阻塞≤60s
window.onNativeAsrModel({state,progress,error})  # 原生→JS：downloading(进度)/ready/error
window.onNativeAsrResult({requestId,text,error,speaker,segments}) # 原生→JS：异步识别结果
```

## AsrPcm（纯逻辑，JVM 单测）

```
decodeS16(bytes: ByteArray) -> FloatArray   # s16le → [-1,1] Float32；奇数长度忽略末字节；空输入→空数组
encodeS16(samples: FloatArray) -> ByteArray # Float32 → s16le；越界 clamp[-1,1]
```

## AsrModelFiles（纯逻辑，JVM 单测）

```
MIN_MODEL_SIZE_BYTES = 50MB
needsDownload(model, tokens) -> Boolean  # 缺文件或模型 <50MB（视为损坏）→ true
purge(model, tokens)                     # 删除模型/tokens/.tmp
```

## AsrModelManager（Kotlin 单例）

```
状态机: not_ready → downloading → ready | error
ensureModel(baseUrl, onModelEvent):
  已 ready → return "ready"；已 downloading → return "downloading"
  置 downloading → 立即在主线程回调 onModelEvent({state:"downloading",progress:0}) → 后台线程:
    serverHashes = 读取 model.int8.onnx.sha256 和 tokens.txt.sha256；读取失败返回 null
    localVerified = 模型、tokens、本地两个 .sha256 都存在 且 (serverHashes=null 或本地 hash 等于 serverHashes)
    localVerified → 跳过模型 hash 计算和模型下载，直接加载
    非 localVerified 且 serverHashes=null → 返回“无法获取模型校验 hash”，不下载无校验模型
    非 localVerified 且 serverHashes存在:
      okTokens = 下载 tokens.txt 到 .tmp，完成后计算 hash 并与 serverHashes.tokens 比较，成功才改名
      okModel  = okTokens && 下载 model.int8.onnx 到 .tmp，完成后计算 hash 并与 serverHashes.model 比较，成功才改名
      okModel → 保存两个本地 .sha256；任一步 hash 不匹配则删除临时/模型/hash 文件
    loadOk = okModel && hasEnoughMemory(availMem>400MB) && AsrEngine.load(context, model, tokens)
    成功 → ready
    失败 → error；三分支：
      下载失败      → AsrModelFiles.purge（模型/tokens/.tmp 全清）
      内存不足      → 保留已下载文件（内存释放后可重试加载），仅清 .tmp
      加载自检失败  → AsrModelFiles.purge（清损坏文件）
statusJson(): {"state","progress","error"}
```

## AsrEngine（Kotlin 单例，sherpa-onnx OfflineRecognizer）

```
load(context, model, tokens) -> Boolean
  当前 ASR CpuPolicy = 已配置 policy 或 CpuCluster.detect().policy(1, 1)
  newPool = AsrEnginePool.configure(policy, model, tokens, sherpaFactory)
  newPool 构造成功 -> 原子替换 currentPool；旧池 retireAfterUse
  newPool 构造失败 -> 保留旧池；返回 false
configurePolicy(policy):
  保存最新 ASR policy
  currentPool 不存在 -> 仅保存 policy，等待模型加载时生效
  currentPool 存在 -> 使用当前 model/tokens 构造 newPool；成功后替换并 retire 旧池；失败则保留旧池
recognize(samples):
  空输入 -> 抛 IllegalArgumentException
  currentPool 不存在 -> 抛 IllegalStateException
  retain currentPool -> currentPool.recognize(samples) -> release retain
```

## NativeBridge（异步识别桥）

```
asrStatus()             → asrModelManager.statusJson()
asrEnsureModel()        → serverBaseUrl=主线程缓存的 origin；asrModelManager.ensureModel{ 事件→主线程 evaluateJavascript onNativeAsrModel }
cpuConfigure(configJson):
  cfg = JSON.parse(configJson)
  topology = CpuCluster.detect()
  asrPolicy = topology.policy(cfg.asr.bigCoreCount, cfg.asr.littleCoreCount)
  AsrEngine.configurePolicy(asrPolicy)
  返回 {ok:true, asr:{bigCpus,littleCpus,cpuMask,totalCoreCount,fallback}, topology:{...}}
  # Task 3 只应用 ASR policy，不创建 TTS pool；TTS 字段保留到后续 Task 4/5
asrRecognizeAsync(requestId, pcmBase64, useVoiceprint, multiSpeaker):
  未 ready → 立即返回 error
  accepted → asrExecutor 并发提交 Base64.decode→AsrPcm.decodeS16→纯 ASR 或声纹流程
  完成/异常/超过 60s → mainHandler.evaluateJavascript(onNativeAsrResult)
旧 APK 没有 asrRecognizeAsync → display.html 使用同步 asrRecognize 兼容回退
updateServerOrigin(url) → ServerOrigin.fromUrl(url) 写入 @Volatile serverOrigin
serverBaseUrl()         → 只读 serverOrigin，不访问 WebView
```

## AsrEnginePool（Task 3 ASR 并发池）

```
AsrEnginePool.configure(policy, modelFile, tokensFile, recognizerFactory):
  slotCount = max(1, policy.totalCoreCount)
  slotCpuMasks = policy.selectedCpus 映射为单 CPU mask
  policy.selectedCpus 为空 -> slotCpuMasks = [0]
  为 0 until slotCount:
    recognizer = recognizerFactory.create(modelFile, tokensFile, numThreads=1)
    slot = { id, cpuMask, singleThreadExecutor, recognizer }
  任一 slot 构造失败 -> release 已构造 recognizer；抛异常
  返回 pool(slots, idleQueue)

pool.recognize(samples):
  retain 已由 AsrEngine 完成，确保 retire 不会释放当前调用持有的旧池
  slot = idleQueue.take()
  try:
    在 slot.singleThreadExecutor 提交:
      CpuAffinity.applyCurrentThread(slot.cpuMask)
      # affinity 返回 false 只记录日志，不影响识别结果
      recognizer.recognize(samples)
    等待 slot future 返回文本
  finally:
    retire 标记未设置 -> idleQueue.offer(slot)
    retire 标记已设置 -> slot.release()

pool.retireAfterUse():
  标记 retired
  不释放正在使用的 slot
  activeUsers == 0 -> 释放全部空闲 slot
  activeUsers > 0 -> 不丢弃空闲 slot；已 retain 且阻塞在 idleQueue.take 的旧请求仍要被旧 slot 服务
  识别完成:
    activeUsers > 0 -> slot 放回 idleQueue，唤醒旧池里已 retain 的排队请求
    activeUsers == 0 且 retired -> 释放全部空闲 slot
  slot.release 使用原子保护，避免重复 release；最终每个 slot executor 都 shutdown

PoolRecognizer:
  recognize(samples):
    createStream -> acceptWaveform(samples,16000) -> decode(stream)
    text = getResult(stream).text.trim()
    finally stream.release()
  release():
    recognizer.release()
```

## CpuCluster / CpuAffinity（Task 2 共享原语）

```
CpuCluster.detect(reader):
  possibleText = reader("/sys/devices/system/cpu/possible")
  onlineText = reader("/sys/devices/system/cpu/online")
  possibleIds = parseCpuRangeList(possibleText)
  onlineIds = parseCpuRangeList(onlineText)
  candidateIds = onlineIds 非空 ? onlineIds : possibleIds
  对 candidateIds 按 cpuId 升序读取 cpu/cpuId/cpufreq/cpuinfo_max_freq
  频率可读且 >0 -> 记录 CpuInfo(id, maxFreq)
  没有可用频率但有 candidateIds -> 返回 CpuTopology(candidateIds freq=0, fallback=true, reason="no_freq")
  没有 candidateIds -> 返回 CpuTopology(empty, fallback=true, reason="no_cpu")
  否则返回 CpuTopology(cpuInfos, fallback=false)

CpuTopology(cpuInfos):
  cpus = 按 cpuId 升序去重后的 CpuInfo
  frequencyGroups = 按 maxFreq 升序分组
  bigCpus = 存在多个频率层级 ? 最高频组 cpuId 升序 : empty
  littleCpus = 存在多个频率层级 ? 非最高频组 cpuId 升序 : 全部 cpuId 升序
  fallback = cpuInfos 为空 或 只有一个频率层级

CpuTopology.policy(bigCoreCount, littleCoreCount):
  requestedBig = max(0, bigCoreCount)
  requestedLittle = max(0, littleCoreCount)
  supportedCpuIds = 0..62
  # Long 是有符号类型，bit63 会变成负数；Kotlin/JNI 统一不生成 CPU 63 或更高 ID 的 mask
  supportedBig = bigCpus.filter(id in supportedCpuIds)
  supportedLittle = littleCpus.filter(id in supportedCpuIds)
  selectedBig = supportedBig.take(requestedBig)
  selectedLittle = supportedLittle.take(requestedLittle)
  如果 selectedBig+selectedLittle 为空 且 requestedBig+requestedLittle > 0:
    fallbackPool = cpus.filter(id in supportedCpuIds) 按 maxFreq 降序、cpuId 升序
    selectedLittle = fallbackPool.take(1).cpuId
  selected 仍为空 -> 返回空 CpuPolicy(cpuMask=0, fallback=true, reason="clamped")
  mask = selectedBig + selectedLittle 按 cpuId 升序转换为正 Long bit mask
  fallback = topology.fallback 或 selected 数量小于 requested 数量 或请求包含不支持的 CPU 63+
  返回 CpuPolicy(bigCpus, littleCpus, cpuMask, effectiveBigCount, effectiveLittleCount, fallback, reason)

CpuAffinity.applyCurrentThread(cpuMask):
  cpuMask <= 0 -> 记录日志并返回 false
  调 nativeApplyCurrentThread(cpuMask)
  JNI 使用同一 supportedCpuIds=0..62 解析 mask，并对当前 native 线程调用 sched_setaffinity
  sched_setaffinity 成功 -> true
  syscall 不可用、权限拒绝、mask 非法或 native library 加载失败 -> 记录日志并返回 false
  不向 ASR 请求路径抛出异常
```

## AsrEngine（外部模型加载）

```
load(context, modelFile, tokensFile):
  组装 SenseVoice OfflineRecognizerConfig
  modelFile 和 tokensFile 使用 APK 私有目录的绝对路径
  recognizer = OfflineRecognizer(assetManager=null, config)
  # 绝对路径模型不是 APK assets；传入非空 AssetManager 会导致 AAR 错误读取 tokens
  成功返回 true；构造异常返回 false
```

## display.html（接入点）

```
全局: nativeAsrAvailable = !!(window.NativeDisplay?.asrStatus)；nativeAsrReady = false
onNativeAsrModel(payload):
  downloading → updateVoiceTextDisplay("语音模型下载中 N%")；N 缺省按 0 处理
  ready       → nativeAsrReady=true；updateVoiceTextDisplay("语音识别已就绪")；重新上报 capabilities.voiceRecognition=true
  error       → nativeAsrReady=false；提示失败
detectCapabilities.voiceRecognition:
  nativeAsrAvailable → JSON.parse(nativeBridge.asrStatus())；ready→true；downloading→立即显示当前进度并保持 false；not_ready/error→触发 asrEnsureModel() 报 false
  非 APK → false（录音端仍通过 /api/asr/status 判断公共 ASR 可用性）
detectCapabilities.webgpu:
  先以独立变量 webgpuDiag 保存异步探测诊断信息；完成 capabilities 对象初始化后再写入 capabilities._webgpuDiag
  # WebGPU 探测不得在对象字面量的 await 表达式中直接访问 capabilities，避免触发 JavaScript 暂时性死区异常
checkAsrStatus:
  所有显示端 → GET /api/asr/status；ready → voiceSupported=true
startVoiceRecording: getUserMedia → PcmAudioCapture → POST /api/asr/recognize
handleAsrAudio（仅服务器选择的 APK 提供端）:
  WAV/PCM → NativeDisplay.asrRecognizeAsync/asrRecognize
  结果 → asrResult 回服务器
录音显示端:
  不调用 NativeDisplay.asrRecognize/asrRecognizeAsync
  不调用 SherpaASR.recognizeBuffer/startStreaming
asrConfig:
  录音显示端 → GET /api/asr/status 判断 voiceSupported
  APK 提供端 → 原生模型 ready/error 更新 voiceRecognition
```

## 服务器（server-app.js）

```
GET /api/asr/model/:filename
  filename ∈ 白名单 {model.int8.onnx, model.int8.onnx.sha256, tokens.txt, tokens.txt.sha256}，否则 400
  ASR_MODEL_DIR = res/models/sensevoice；文件不存在 404
  .txt/.sha256 返回 text/plain，其余模型文件返回 application/octet-stream
  流式返回 + Content-Length（fs.createReadStream）
  stream.on('error') → 未发头 500 / 已发头 res.end()；res.on('close') → stream.destroy()（客户端断开清理）

## 真机测试记录（2026-08-19）

使用 SenseVoice 测试 WAV 通过 `/api/asr/recognize` 调用 APK；服务器 hash 接口可用，修复 origin 后模型已完成下载和本地 hash 保存，修复 AssetManager 参数后 APK 可进入 `ready`。

诊断结果：连续请求反复触发 `asrEnsureModel()`，模型目录未创建且没有 `ModelDownloader` 日志；`serverBaseUrl()` 在 JavaBridge 线程读取 `webView.url` 时持续产生线程告警。

修复设计：`MainActivity.onPageStarted/onPageFinished` 在主线程调用 `updateServerOrigin(pageUrl)`；JavaScript bridge 线程只读取缓存 origin，避免跨线程读取 WebView URL。下载和缓存复用实测已通过；`AsrEngine` 加载外部文件时传入空 AssetManager，避免 sherpa-onnx 将绝对路径文件按 Asset 读取。最终真机验证：`zh.wav` 返回“开饭时间早上9点至下午5点。”；串接 `zh.wav + en.wav` 返回一段完整 zh 文本“开放时间早上9点至下午5点。”，en 片段被声纹门控过滤。

本轮压测补充（2026-08-25）：模型自动下载、hash 校验、加载和 `asrStatus().state=ready` 均通过；服务器路由的 5 次串行 `zh.wav` 请求均到达 APK，但 `NativeDisplay.asrRecognize()` 返回 `{}`，服务器统一报告“显示端 ASR 识别失败”。调试声纹匹配路径另出现 `VoiceprintEngine.match` native 崩溃并导致 APK 进程退出。速度、P95 和长稳内存结论待原生识别结果链路修复后补测。
```

## Task 6 集成验证（伪代码）

```
runNodeIntegrationTests():
  执行 CPU 配置、display 消费、TTS 路由、重连、异步桥和 ASR native load focused tests
  断言 22 项全部通过

runAndroidBuild():
  执行 Android JVM tests + assembleDebug
  断言 BUILD SUCCESSFUL

deployDisplay2():
  npm run upload:apk
  npm run start:apk:display -- 2
  断言 APK 进程存活
  断言 WindowManager 存在 displayId=2 的 MainActivity

verifyAsrRuntime():
  读取服务器 cpuAffinity.asr
  默认值为 1 big + 1 little
  记录设备 CPU 拓扑与进程允许 CPU
  未观测到 affinity syscall 日志 -> 不宣称 syscall 已成功
  affinity 失败 -> 保持系统默认调度 fallback
```

## 录音（不变）

Manifest 加 RECORD_AUDIO；MainActivity 运行时权限；DisplayWebView.onPermissionRequest 授予 RESOURCE_AUDIO_CAPTURE。

## 2026-08-28 正式 APK ASR 增强接入伪代码

```text
配置页：
  GET/POST /api/config/asr 读取或保存 languageMode、denoise
  GET/POST /api/voiceprint/config 读取或保存 multiMode、speakerCount
  服务端保存配置后向 display 广播 asrConfig/voiceprintConfig

display.html：
  收到 asrConfig -> 缓存 languageMode、denoise
  收到 voiceprintConfig -> 缓存 multiMode、speakerCount，并调用 voiceprintConfigure
  收到 asrAudio：
    webm/wav -> 16kHz mono PCM
    调 NativeBridge.asrRecognizeAsync(requestId, pcm, useVoiceprint,
      multiSpeaker, denoise, languageMode, multiMode, speakerCount)
  旧 APK 缺少扩展参数时使用旧四参数入口

NativeBridge：
  denoise=true 且降噪引擎已加载 -> DenoiseAudioPolicy.prepare(rawSamples)
  否则直接使用 rawSamples
  languageMode.parse；非法值回退 AUTO
  不使用声纹 -> AsrEngine.recognize(preparedSamples, languageMode)
  普通单段声纹 -> 对 preparedSamples 提取 embedding、匹配，再对同一音频 ASR
  快速多段声纹 ->
    VoiceprintEngine.diarize(preparedSamples, speakerCount)
    按 speakerIndex 合并相邻区间
    每个 cluster 选择最长片段提取一次 embedding
    匹配声纹后按相邻人名合并时间区间
    对每个合并区间执行 ASR，并只清理首尾空白
  返回 text 或 segments，并携带 denoise/languageMode/multiMode 元数据

AsrEnginePool：
  recognizerFactory.create(modelFile, tokensFile, language)
  language 变化时构造新 pool，成功后替换旧 pool并延迟释放
  同一时刻只保留当前语言 pool，避免 SenseVoice 模型重复占用内存

SherpaDenoiseEngine：
  从 APK assets/speech-enhancement/gtcrn_simple.onnx 安装到 filesDir 临时目录
  OfflineSpeechDenoiser.run(samples, 16000) -> DenoisedAudio
  每次请求最多运行一次；引擎按 APK 生命周期复用

VoiceprintEngine：
  load(..., multiMode, speakerCount)
  FastClusteringConfig.numClusters = AUTO 或 1..5
  普通多段兼容入口仍可读取旧配置，但正式 UI 只暴露快速多段

  服务端结果边界：
  收到 display asrResult 后，对 text 和每个 segment.text 执行中英过滤
  过滤后为空的 segment 丢弃；保持原有 speaker 门控和错误语义
```

## 2026-08-28 内存不足重连与正式 APK 准确度修复伪代码

```text
requestedSlots = currentCpuPolicy.totalCoreCount
effectiveSlots = AsrMemoryPolicy.chooseSlots(
  availableBytes = ActivityManager.MemoryInfo.availMem,
  requestedSlots = requestedSlots,
  perRecognizerBudget = 400MB,
  singleRecognizerMinimum = 400MB
)

if effectiveSlots == 0:
  state = error("设备内存不足，无法加载语音模型")
else:
  AsrEnginePool.configure(slotCount = effectiveSlots)
  # 内存充足时仍保留核心数个 recognizer；只有预算不足才回退为 1 个

AsrEnginePool.configure:
  for index in 0 until slotCount:
    try create recognizer
    catch OutOfMemoryError:
      release all already-created slots
      rethrow memory error

display.html APK 录音:
  getUserMedia(audio: { echoCancellation:false, noiseSuppression:false })
  native APK -> AudioContext ScriptProcessor 采集原始 Float32
  按实际采样率重采样为 16kHz mono，封装 WAV
  非 APK -> 同样使用 PCM/WAV，不创建 MediaRecorder/WebM 录音上传路径

全端录音统一:
  控制端 chat.js -> PcmAudioCapture.start(stream) -> stopWav() -> /api/asr/recognize
  控制端 voiceprint-panel.js -> PcmAudioCapture.start(stream) -> stopWav() -> /api/voiceprint/register
  display.html -> PcmAudioCapture.start(stream) -> takeWav() -> /api/asr/recognize
  Node 子显示端 -> 现有 AudioRecorder/PvRecorder 的 16kHz PCM -> encodeWAV
  Go/C# 子显示端 -> 仅上传 WAV 文件名和 audio/wav Content-Type
  3rd/ttslive -> WebAudio 原始 Float32 -> 16kHz mono WAV -> /audio
  禁止新的 MediaRecorder/WebM 录音上传路径

内存错误:
  display.html 停止录音并上报 voiceRecognition=false
  后续普通 asrAudio 只返回错误，不再次调用 asrEnsureModel
```

## 2026-08-29 移除其他文字过滤伪代码

```text
asrOptions:
  兼容读取/保存 denoise
  languageMode 固定为 zh
  不读取、不保存、不广播 filterOtherText

display.html:
  收到 asrConfig -> 固定 languageMode='zh'，缓存 denoise
  调 NativeBridge.asrConfigure('zh', denoise)

NativeBridge:
  asrConfigure('zh', denoise) -> 保存固定中文和降噪配置
  普通 ASR、单段声纹、多段声纹 -> AsrEngine.recognize(准备后的音频, languageMode)
  结果只执行首尾空白清理，不执行 Unicode 脚本过滤

测试 APK HTTP:
  /api/asr 和 /api/voiceprint/test 的 language 只接受 auto、zh、en
  普通网页和声纹测试网页继续固定发送 language=zh
```
