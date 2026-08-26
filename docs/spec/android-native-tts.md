# Android 原生语音生成（Microsoft Embedded Speech SDK）实现文档（伪代码）

## 桥接口（window.NativeDisplay）

APK 通过 `addJavascriptInterface` 注入，display.html 探测到 `window.NativeDisplay` 后新增 `ttsGeneration` 能力。

```
ttsStatus() -> String JSON              # {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
ttsEnsureModel() -> String              # "ready" | "downloading" | {"error":"..."}；异步经 onNativeTtsModel 回调
ttsSynthesizeAsync(requestId,text) -> String JSON # 成功提交 accepted:true；桥侧满载 accepted:false；已提交结果经 onNativeTtsResult 回调
ttsSynthesize(text) -> String JSON      # 旧 APK 兼容入口；同步阻塞≤60s
window.onNativeTtsModel({state,progress,error})  # 原生→JS：downloading(进度)/ready/error
window.onNativeTtsResult({requestId,audio,error}) # 原生→JS：异步 WAV 结果
WS ttsGenerating{requestId}              # 显示端接受生成任务后的开始回执
```

## TtsModelFiles（纯逻辑）

```
FILE_NAMES = [14 个嵌入式 TTS 模型文件名]
MIN_MAIN_FILE_BYTES = 40MB               # MSTTSLocZhCN.dat 主模型阈值
needsDownload(modelDir):
  缺任一 file 或 mainFile < 40MB → true；否则 false
purge(modelDir): 删除每个 FILE_NAMES 及其 .tmp
```

## TtsModelManager（Kotlin 单例）

```
状态机: not_ready → downloading → ready | error
ensureModel(baseUrl, onModelEvent):
  已 ready → return "ready"；已 downloading → return "downloading"
  置 downloading → 主线程回 onModelEvent({state:"downloading",progress:0}) → 后台线程:
    manifest = fetch("/api/tts/model-manifest")  # [{name,sha256}]；失败 → error
    localHashes = 读取 filesDir/models/tts/hashes.json
    allVerified = 每个 manifest 项 的 本地文件存在 且 localHashes[name]===sha256
    allVerified → hasEnoughMemory(availMem>200MB) && TtsEngine.load → ready / error
    否则逐文件:
      本地已验证 → 跳过
      否则 download("/api/tts/model/<name>", dest, sha256, 进度)：
        写 .tmp → 计算 sha256 → 匹配 → 原子改名；不匹配 → 删除
      任一下载失败 → error + purge 模型文件
    全部成功 → 保存 hashes.json → 内存检查 + TtsEngine.load → ready / error
statusJson(): {"state","progress","error"}
```

## TtsEngine（Kotlin 单例，Embedded Speech SDK + TTS 并发池）

```
当前 TTS CpuPolicy = 已配置 policy 或 CpuCluster.detect().policy(1, 1, false)
当前 modelDir = 最近一次加载成功的 TTS 模型目录
当前 pool = 最近一次构造成功的 TtsEnginePool

load(context, modelDir):
  modelDir 有效且含 2052.INI → EmbeddedSpeechConfig.fromPath(modelDir)
  setSpeechSynthesisOutputFormat(Riff24Khz16BitMonoPcm)
  voiceName = probeVoice(config)        # 优先包含 Xiaoxiao，否则第一个声线
  newPool = TtsEnginePool.configure(policy, modelDir, voiceName, embeddedKey, microsoftFactory)
  newPool 构造成功后替换 currentPool；旧 pool retire，不释放正在合成或已排队的旧 caller
  ready = true；currentModelDir = modelDir
 失败 → ready=false；返回 false

configurePolicy(policy):
  保存 currentPolicy
  当前未加载模型 → return true
  使用当前 modelDir 和新 policy 构造 newPool
  构造成功 → 替换 currentPool；旧 pool retire；return true
  构造失败 → 保留旧 pool 和旧 ready 状态；return false

synthesize(text):
  text 为空 → 抛异常
  synchronized(lock) retain 当前 pool；未加载 → 抛异常
  pool.synthesizeRetained(text) → 返回 WAV bytes
  finally releaseRetain，确保旧 pool 最后一个 caller 退出后才释放 idle slot

probeVoice(modelDir):
  config = EmbeddedSpeechConfig.fromPath(modelDir)
  config.setSpeechSynthesisOutputFormat(Riff24Khz16BitMonoPcm)
  probe = SpeechSynthesizer(config, null AudioConfig)
  result = getVoicesAsync()
  优先匹配 Xiaoxiao，否则 voices[0]
  finally result.close()
  finally probe.close()

release():
  synchronized(lock):
    ready=false；currentModelDir=null；currentPool=null
    oldPool.retire()
```

## TtsEnginePool（Task 4 TTS 并发池）

```
TtsEnginePool.configure(policy, modelDir, voiceName, embeddedKey, synthesizerFactory, affinityApplier):
  slotCount = max(1, policy.totalCoreCount)
  slotMasks = policy.selectedCpus 非空 ? 每个 CPU 单独转换为 mask : slotCount 个 0 mask
  admissionLimit = slotCount + slotCount   # slotCount 个活跃请求 + slotCount 个排队请求
  admission = fair Semaphore(admissionLimit)
  对每个 slot:
    config = EmbeddedSpeechConfig.fromPath(modelDir)
    config.setSpeechSynthesisOutputFormat(Riff24Khz16BitMonoPcm)
    config.setSpeechSynthesisVoice(voiceName, embeddedKey)
    synthesizer = synthesizerFactory.create(config, outputMode=SILENT_WAV)
    # microsoftFactory 必须用 SpeechSynthesizer(config, null AudioConfig)，生成 WAV，不输出到扬声器
    slot = TtsSlot(id, mask, synthesizer, singleThreadExecutor)
  任一 slot 构造失败 → 释放已构造 slot 后抛异常
  返回 pool(slots, idleSlots)

pool.synthesize(text):
  retain()
  try synthesizeRetained(text)
  finally releaseRetain()

pool.synthesizeRetained(text):
  admission.tryAcquire() 失败 -> 抛 RejectedExecutionException("TTS 请求过多，请稍后重试")
  idleSlots.take() 获取 bounded slot；最多只有 slotCount 个 caller 在这里排队
  try slot.synthesize(text)
  finally:
    returnOrRelease(slot)
    admission.release()  # 无论 idleSlots.take 或合成是否抛异常都必须释放

slot.synthesize(text):
  提交到 slot 单线程 worker:
    CpuAffinity.applyCurrentThread(cpuMask)
    # affinity false 是性能降级，不改变合成结果
    result = synthesizer.SpeakText(text)
    reason == SynthesizingAudioCompleted → return result.audioData
    否则 → 抛命名错误（含取消详情）
    finally result.close()
  外层等待 worker future；如果等待线程被 interrupt，继续等到本 slot 真实完成，避免同一 synthesizer 被并发复用

pool.retire():
  标记 retired，不再被 TtsEngine 作为新 currentPool 获取
  activeUsers == 0 → 释放 idleSlots 中所有 synthesizer 和 slot executor
  activeUsers > 0 → 已 retain 的 in-flight/queued caller 继续使用旧池；最后一个 releaseRetain 再释放

returnOrRelease(slot):
  retired 且没有其他 retained caller 等待该旧池 → release slot
  否则 slot 放回 idle queue，继续服务已 retain 的旧请求
```

## NativeBridge（异步合成桥）

```
ttsStatus()           → ttsModelManager.statusJson()
ttsEnsureModel()      → serverBaseUrl=主线程缓存 origin；ttsModelManager.ensureModel{ 主线程 evaluateJavascript onNativeTtsModel }
cpuConfigure(configJson):
  topology = CpuCluster.detect()
  asrPolicy = topology.policy(config.asr.bigCoreCount, config.asr.littleCoreCount, config.asr.preferBigCores)
  ttsPolicy = topology.policy(config.tts.bigCoreCount, config.tts.littleCoreCount, config.tts.preferBigCores)
  AsrEngine.configurePolicy(asrPolicy) 失败 → 返回 error
  synchronized(ttsSubmitLock):
    TtsEngine.configurePolicy(ttsPolicy) 失败 → 返回 error
    ttsBridgeDispatcher.reconfigure(max(1, ttsPolicy.totalCoreCount))
  返回 {ok:true, asr:policyJson, tts:policyJson, topology:topologyJson}

cpuConfigureAsync(configJson):
  key = configJson 的稳定配置 key
  synchronized(cpuConfigLock):
    如果 key == lastAppliedKey 或 key == pending.key:
      立即返回 {accepted:true, coalesced:true}
    pending = {key, configJson}                 # 新配置覆盖旧待处理配置
    如果后台 worker 未运行:
      标记 running=true
      cpuConfigExecutor.execute(drainCpuConfigQueue)
  立即返回 {accepted:true}                      # JavaScript bridge 线程不等待引擎重建

drainCpuConfigQueue():
  循环:
    synchronized(cpuConfigLock):
      request = pending
      pending = null
      request 为空 -> running=false; 返回
    result = applyCpuConfig(request.configJson)  # 后台串行执行原 cpuConfigure 主体
    synchronized(cpuConfigLock):
      result 成功 -> lastAppliedKey=request.key

AsrEngine.configurePolicy(policy):
  synchronized(lock):
    如果 currentPolicy == policy:
      直接返回 true                           # 不重建 recognizer pool
    currentPolicy = policy
  构造新 pool，成功后安全替换旧 pool

TtsEngine.configurePolicy(policy):
  synchronized(lock):
    如果 currentPolicy == policy:
      直接返回 true                           # 不重建 SpeechSynthesizer pool
    currentPolicy = policy
  构造新 pool，成功后安全替换旧 pool

voiceprintConfigure 回调:
  后台模型任务得到 event
  mainHandler.post:
    webView.evaluateJavascript(window.onVoiceprintModel(event))

TtsBridgeDispatcher(workerCount):
  workerCount = max(1, workerCount)
  executor = fixed ThreadPoolExecutor(workerCount, workerCount, ArrayBlockingQueue(workerCount))
  submit(task):
    synchronized(dispatcherLock):
      executor.submit(task) 失败 → 抛 RejectedExecutionException("TTS 请求过多，请稍后重试")
  reconfigure(workerCount):
    synchronized(dispatcherLock):
      replacement = new fixed executor(max(1, workerCount), queue=max(1, workerCount))
      current = replacement
      old.shutdown()                 # 排空已提交任务，不中断 active/queued work

ttsSynthesizeAsync(requestId,text):
  未 ready → 立即返回 error
  synchronized(ttsSubmitLock):
    ttsBridgeDispatcher.submit(TtsEngine.synthesize) 失败 → 立即返回 {accepted:false,error}，不注册超时、不回调
    accepted → 仅已提交任务由 bridge worker 执行 TtsEngine.synthesize
  TtsEnginePool 继续限制 slotCount 个活跃请求 + slotCount 个排队请求
  完成/异常/超过 60s → mainHandler.evaluateJavascript(onNativeTtsResult)
旧 APK 没有 ttsSynthesizeAsync → display.html 使用同步 ttsSynthesize 兼容回退
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

CpuTopology.policy(bigCoreCount, littleCoreCount, preferBigCores=false):
  requestedBig = max(0, bigCoreCount)
  requestedLittle = max(0, littleCoreCount)
  supportedCpuIds = 0..62
  # Long 是有符号类型，bit63 会变成负数；Kotlin/JNI 统一不生成 CPU 63 或更高 ID 的 mask
  supportedBig = bigCpus.filter(id in supportedCpuIds)
  supportedLittle = littleCpus.filter(id in supportedCpuIds)
  requestedTotal = requestedBig + requestedLittle
  如果 preferBigCores:
    selectedBig = supportedBig.take(requestedTotal)
    selectedLittle = supportedLittle.take(max(0, requestedTotal - selectedBig.size))
  否则:
    selectedBig = supportedBig.take(requestedBig)
    selectedLittle = supportedLittle.take(requestedLittle)
  如果 selectedBig+selectedLittle 为空 且 requestedBig+requestedLittle > 0:
    fallbackPool = cpus.filter(id in supportedCpuIds) 按 maxFreq 降序、cpuId 升序
    selectedLittle = fallbackPool.take(1).cpuId
  selected 仍为空 -> 返回空 CpuPolicy(cpuMask=0, fallback=true, reason="clamped")
  mask = selectedBig + selectedLittle 按 cpuId 升序转换为正 Long bit mask
  fallback = topology.fallback 或 selected 数量小于 requestedTotal 或（未开启优先大核时大/小核分别不足）或请求包含不支持的 CPU 63+
  返回 CpuPolicy(bigCpus, littleCpus, cpuMask, effectiveBigCount, effectiveLittleCount, fallback, reason)

CpuAffinity.applyCurrentThread(cpuMask):
  cpuMask <= 0 -> 记录日志并返回 false
  调 nativeApplyCurrentThread(cpuMask)
  JNI 使用同一 supportedCpuIds=0..62 解析 mask，并对当前 native 线程调用 sched_setaffinity
  sched_setaffinity 成功 -> true
  syscall 不可用、权限拒绝、mask 非法或 native library 加载失败 -> 记录日志并返回 false
  不向 TTS 请求路径抛出异常
```

## 线程与音频输出约束

```text
ttsExecutor = TtsBridgeDispatcher(max(1, currentTtsPolicy.totalCoreCount))
桥侧 worker 数 = slotCount；桥侧 queue capacity = slotCount
异步入口 → 在 ttsSubmitLock 内提交；满载时立即返回 accepted:false，不注册回调/超时
同步兼容入口 → 在 ttsSubmitLock 内提交并等待 Future；满载时立即返回普通 error JSON
cpuConfigure 成功应用 TTS policy 且 slotCount 变化 → 在 ttsSubmitLock 内 swap dispatcher；旧 executor shutdown() 排空已提交任务
真实 TTS 并发上限由 TtsEnginePool 的 max(1, CpuPolicy.totalCoreCount) 控制；pool 公平 Semaphore(slotCount * 2) 是额外安全层
每个 TTS slot 使用自己的单线程 worker 和独立 SpeechSynthesizer
SpeechSynthesizer(config, null AudioConfig) → 生成 WAV，不输出到默认扬声器
服务器收到 ttsResult → 统一下发一次 tts action=playAudio → 显示端只播放一次
```

## Task 6 集成验证（伪代码）

```
runNodeIntegrationTests():
  执行 CPU 配置、display UI、TTS 路由、重连、异步桥和 ASR native load focused tests
  断言 22 项全部通过

runAndroidBuildAndDeploy():
  执行 testDebugUnitTest + assembleDebug
  npm run upload:apk
  npm run start:apk:display -- 2
  断言 APK 进程存活且 displayId=2 有 MainActivity

verifyConcurrentTts():
  读取默认 tts policy = 1 big + 1 little
  同时提交 3 个 ttsGenerate
  断言 3 个 ttsGenerating 和 3 个 ttsResult 均收到
  断言没有超时、失败或重复播放错误
  推断前两个请求由两个 slot 并行，第三个请求进入有限队列
  不将未采集的 PSS/native heap 或 affinity syscall 成功率标记为已验证
```

## 当前 APK 100 字性能验证

```text
测试文本长度 = 100 个汉字
请求次数 = 10
并发数 = 1
tts.device = display
成功 = 10；失败 = 0；超时 = 0
总耗时 = 35687ms
平均单次 = 3562.5ms
最大单次 = 4620ms
```

## display.html（接入点）

```
全局: nativeTtsAvailable = !!(window.NativeDisplay?.ttsStatus)
      nativeTtsReady = false；ttsDevice = 'server'；localTtsEnabled = false
detectCapabilities:
  ttsGeneration 默认 false
  nativeTtsAvailable → st=JSON.parse(nativeBridge.ttsStatus())；ready → nativeTtsReady=true/能力 true
    not_ready|error 且 localTtsEnabled → ttsEnsureModel()
onNativeTtsModel(payload):
  downloading → 记录进度；ready → nativeTtsReady=true + 上报能力 true
  error → nativeTtsReady=false + 上报能力 false
reportNativeTtsCapability(ready): 更新 currentCapabilities.ttsGeneration → WS capabilities
ensureNativeTtsModel(): ttsStatus()=ready → 上报 true；downloading → 等待；not_ready|error → ttsEnsureModel()
handleTtsGenerate(data):
  !nativeTtsAvailable → ttsResult{error:'原生 TTS 不可用'}
  !nativeTtsReady → localTtsEnabled 时 ensureNativeTtsModel() → ttsResult{error:'模型下载中'}
  ready → ttsSynthesizeAsync(requestId,text) → onNativeTtsResult → ttsResult{audioData} 或 {error}
  旧 APK 无异步入口 → 回退 ttsSynthesize(text)
  原生合成器不绑定默认扬声器；生成阶段只返回 WAV，不播放
switch:
  ttsConfig: ttsDevice/localTtsEnabled 赋值
    localTtsEnabled=true → ready?上报 true : ensureNativeTtsModel()
    localTtsEnabled=false → nativeTtsReady=false + 上报 false
  ttsGenerate: handleTtsGenerate(data)
```

## 服务器（server-app.js）

```
config.tts.device 默认 'server'
GET  /api/config/ttsDevice         → {device}
POST /api/config/ttsDevice         → 校验 server|display；config.set；广播 ttsDeviceChanged
                                     → 对每个显示端下发 ttsConfig{device, localTtsEnabled}
config.cpuAffinity 默认 {
  asr: { bigCoreCount: 1, littleCoreCount: 1 },
  tts: { bigCoreCount: 1, littleCoreCount: 1 }
}
normalizeCpuAffinityConfig(raw):
  对 asr/tts 的 bigCoreCount/littleCoreCount 逐项读取
  缺失、旧配置残缺、非法存量或单引擎 0/0 → 该引擎回退默认 1+1
  返回规范化后的四个非负整数
validateCpuAffinityPayload(payload):
  payload 不是 object/null → error
  字段缺失 → 使用默认值
  显式提供的字段不是非负整数（负数/小数/字符串/null）→ error
  asr.bigCoreCount + asr.littleCoreCount <= 0 → error
  tts.bigCoreCount + tts.littleCoreCount <= 0 → error
  返回规范化 cpuAffinity
GET  /api/config/cpuAffinity       → {status:'success', cpuAffinity: normalizeCpuAffinityConfig(config.get('cpuAffinity'))}
POST /api/config/cpuAffinity       → validateCpuAffinityPayload(req.body)
                                     error → 400
                                     success → config.set('cpuAffinity', normalized)
                                     → broadcastToControls({type:'cpuAffinityChanged', cpuAffinity: normalized})
                                     → sendCpuConfigToAllDisplays({type:'cpuConfig', asr, tts})
                                     → {status:'success', cpuAffinity: normalized}
GET  /api/tts/model-manifest       → 读 res/models/tts/manifest.json（Content-Length 流式）
GET  /api/tts/model/:filename      → filename∈白名单，否则 400；文件不存在 404
                                     文本类返回 application/json，模型文件返回 octet-stream；错误处理流清理

findDisplayWithTts():
  displayClients 中首个 state.capabilities.ttsGeneration 的显示端

sendTtsGenerateToDisplay(display, text, requestId):
  下发 ttsGenerate{text,requestId}
  3s 内未收到 ttsGenerating → reject('未收到开始生成回执')
  收到 ttsGenerating → 继续等待 ttsResult
  ttsResult{audioData} → resolve({audioData})；ttsResult{error} → reject(error)
  显示端断开或总计 60s 未完成 → reject

generateTtsWithFallback(text, voice, speed):
  tts.device==='display':
    display = findDisplayWithTts()
    display → try await sendTtsGenerateToDisplay → base64 写 res/uploads/tts/*.wav → return path
              catch → 打日志后落服务端
    无 display → 日志“无在线支持 TTS 的显示端，回退服务端”
  return tts.generateTTS(text, voice, speed)      # server 模式或回退

所有服务端 TTS 入口:
  API / 聊天 / Agent / 文本媒体 / 语音指令 / 提醒 / 整点报时
  → generateTtsWithFallback(text, voice, speed)
  → 禁止在入口直接调用 tts.generateTTS

TaskManager:
  setGenerateTts(generateTtsWithFallback)
  builtin task context.generateTTS = 注入的统一路由
  time.announce 使用 context.generateTTS 生成音频

display WS 收到 ttsResult:
  pendingDisplayTtsRequests.get(requestId) → clearTimeout → resolve/reject → return

display WS 初始化:
  连接建立后先发送 serverStartTime / displayId / logReportConfig
  然后发送 asrConfig / ttsConfig / cpuConfig
  旧客户端忽略未知的 cpuConfig，不影响 restoreState / playlistStart

部署验证:
  构建 APK -> 使用设备匹配的 debug keystore 签名
  adb push 到设备 -> pm install -r                  # 保留应用数据
  启动 display 2 -> pidof/dumpsys activity 确认 MainActivity 前台
  logcat 未出现 FATAL EXCEPTION/ANR，持续收到 renderUpdate

当前设备运行参数:
  asr.bigCoreCount=2, asr.littleCoreCount=0
  tts.bigCoreCount=2, tts.littleCoreCount=0
  通过 POST /api/config/cpuAffinity 下发，显示端不重启即可异步切换

能力:
  DEFAULT_CAPABILITIES / SUB_DISPLAY_CAPABILITIES 增加 ttsGeneration:false
  display actor / map actor 能力列表新增 voice-generation(语音生成)
```

## 构建约束

```
APK minSdk=26（Android 8.0+）：
  Embedded SDK 依赖 azure-core@1.58.1，该版本使用 MethodHandle，
  D8 在 minSdk<26 时无法 dex
原生库仅打包 arm64-v8a
```

## 控制端（upload + tts.js）

```
TtsDevice:
  init(): GET /api/config/ttsDevice → currentDevice → updateUI()
  setDevice(device): POST /api/config/ttsDevice → 成功 updateUI + toast
  updateUI(): 高亮 server/display 按钮；状态文案含可用显示端数量（ttsGeneration）
  handleDeviceChanged(device): currentDevice=device → updateUI()
upload.html 按钮组: ttsDeviceServerBtn / ttsDeviceDisplayBtn / ttsDeviceStatus
websocket.js:
  ttsDeviceChanged → TtsDevice.handleDeviceChanged
  displayList 刷新 → TtsDevice.updateUI
main.js: TtsDevice.init()
display-list/device-list/device-tree: ttsGeneration 能力图标与编辑器
```

## 模型资源

```
res/models/tts/
  2052.INI, MSTTSLocEnUS.dat, MSTTSLocZhCN.dat, MSTTSLocZhCN.ini,
  Tokens.xml, ZhCN.address.dat, ZhCN.message.dat, ZhCN.mixlingual.dat,
  ZhCN.name.dat, am_v5_decoder.bin, am_v5_encoder.bin,
  device_vocoder_v6_streaming.bin, phones.txt, punc.txt
  manifest.json（每个文件 sha256，约 75MB 总量）

## 2026-08-25 实测记录（伪代码）

```
device = connectAdb("SM-N9500", api=28, abi="arm64-v8a")
assert apk.assembleDebug() == success
assert androidUnitTests(tempDir="/mnt/AASC/tmp") == 36 passed

assert device.modelHashes == server.manifestHashes
assert actor("display-ec4p3r2z").capabilities contains "voice-generation"

for round in 1..8:
  result = POST("/api/tts/generate", text="连续第 round 次 TTS 内存稳定性测试")
  assert result.status == "success"
  assert wav(result.audioUrl).format == {sampleRate: 24000, bits: 16, channels: 1}
  record devicePss, nativeHeap, processId

assert processId unchanged
assert noLog("OutOfMemoryError", "FATAL EXCEPTION")
wait 30 seconds
assert nativeHeap remains near 156.6MB

forceStop(displayWithVoiceGeneration)
fallback = POST("/api/tts/generate", text="显示端离线回退服务端测试")
assert fallback.status == "success"
assert serverLog contains "回退服务端"
restart(display)
assert actor("display-ec4p3r2z").capabilities contains "voice-generation"
```
```
