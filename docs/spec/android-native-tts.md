# Android 原生语音生成（Microsoft Embedded Speech SDK）实现文档（伪代码）

## 桥接口（window.NativeDisplay）

APK 通过 `addJavascriptInterface` 注入，display.html 探测到 `window.NativeDisplay` 后新增 `ttsGeneration` 能力。

```
ttsStatus() -> String JSON              # {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
ttsEnsureModel() -> String              # "ready" | "downloading" | {"error":"..."}；异步经 onNativeTtsModel 回调
ttsSynthesize(text) -> String JSON      # 输入文本；返回 {"audio":"<base64 wav>"} 或 {"error":"..."}；同步阻塞≤30s
window.onNativeTtsModel({state,progress,error})  # 原生→JS：downloading(进度)/ready/error
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

## TtsEngine（Kotlin 单例，Embedded Speech SDK）

```
load(context, modelDir):
  modelDir 有效且含 2052.INI → EmbeddedSpeechConfig.fromPath(modelDir)
  setSpeechSynthesisOutputFormat(Riff24Khz16BitMonoPcm)
  voiceName = probeVoice(config)        # 优先包含 Xiaoxiao，否则第一个声线
  config.setSpeechSynthesisVoice(voiceName, embeddedKey)
  synthesizer?.close(); synthesizer = SpeechSynthesizer(config); ready = true
 失败 → ready=false；返回 false
synthesize(text):
  synchronized(this):
    text 为空 → 抛异常；synth 未加载 → 抛异常
    result = synth.SpeakText(text)
    reason == SynthesizingAudioCompleted → return getAudioData()
    否则 → 抛命名错误（含取消详情）
probeVoice(config): getVoicesAsync() → 优先匹配 Xiaoxiao，否则 voices[0]
release(): synchronized(this) { ready=false; synthesizer?.close(); synthesizer=null }
```

## NativeBridge（新增 3 方法）

```
ttsStatus()           → ttsModelManager.statusJson()
ttsEnsureModel()      → serverBaseUrl=主线程缓存 origin；ttsModelManager.ensureModel{ 主线程 evaluateJavascript onNativeTtsModel }
ttsSynthesize(text)   → 未 ready 回 error；否则 ttsExecutor.submit{ TtsEngine.synthesize } → future.get(30s)
                        → 超时回 error；正常回 {"audio": base64(NO_WRAP) wav}
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
  ready → ttsSynthesize(text) → ttsResult{audioData} 或 {error}
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
GET  /api/tts/model-manifest       → 读 res/models/tts/manifest.json（Content-Length 流式）
GET  /api/tts/model/:filename      → filename∈白名单，否则 400；文件不存在 404
                                     文本类返回 application/json，模型文件返回 octet-stream；错误处理流清理

findDisplayWithTts():
  displayClients 中首个 state.capabilities.ttsGeneration 的显示端

sendTtsGenerateToDisplay(display, text, requestId):
  Promise + 60s 定时器 → 下发 ttsGenerate{text,requestId}
  收到 ttsResult → resolve({audioData}) / reject(error)；close/超时 → reject

generateTtsWithFallback(text, voice, speed):
  tts.device==='display':
    display = findDisplayWithTts()
    display → try await sendTtsGenerateToDisplay → base64 写 res/uploads/tts/*.wav → return path
              catch → 打日志后落服务端
    无 display → 日志“无在线支持 TTS 的显示端，回退服务端”
  return tts.generateTTS(text, voice, speed)      # server 模式或回退

display WS 收到 ttsResult:
  pendingDisplayTtsRequests.get(requestId) → clearTimeout → resolve/reject → return

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
