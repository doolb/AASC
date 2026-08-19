# Android 原生语音识别（sherpa-onnx AAR）实现文档（伪代码）

## 桥接口（window.NativeDisplay）

APK 通过 `addJavascriptInterface` 注入，display.html 探测到 `window.NativeDisplay` 后新增 ASR 能力（与 compute 桥共用同一对象）。

```
asrStatus() -> String JSON            # {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
asrEnsureModel() -> String            # "ready" | "downloading" | {"error":"..."}；异步下载经 onNativeAsrModel 回调
asrRecognize(pcmBase64) -> String JSON # 输入裸 PCM(16k mono s16le) base64；返回 {"text":""} 或 {"error":""}；同步阻塞≤20s
window.onNativeAsrModel({state,progress,error})  # 原生→JS：downloading(进度)/ready/error
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
load(context, model, tokens) -> Boolean  # 真实 AAR 构造需 AssetManager → load 带 Context（applicationContext 不持引用）
  # 配置同服务器 asr-service.js：SenseVoice auto + useInverseTextNormalization(true) + numThreads=1 + cpu + sampleRate 16000
  # 重载时先 release() 旧引擎；synchronized(this) 防与 recognize 并发 use-after-free
recognize(samples: FloatArray) -> String  # synchronized(this)；createStream → acceptWaveform(samples,16000) → decode(stream)
  # → getResult(stream).text.trim()（decode 返回 void）→ finally stream.release()；空输入/未加载抛异常
```

## NativeBridge（新增 3 方法）

```
asrStatus()             → asrModelManager.statusJson()
asrEnsureModel()        → serverBaseUrl=主线程缓存的 origin；asrModelManager.ensureModel{ 事件→主线程 evaluateJavascript onNativeAsrModel }
asrRecognize(pcmBase64) → 未 ready 回 error；Base64.decode→AsrPcm.decodeS16→asrExecutor 串行 AsrEngine.recognize→future.get(20s) 超时回 error
updateServerOrigin(url) → ServerOrigin.fromUrl(url) 写入 @Volatile serverOrigin
serverBaseUrl()         → 只读 serverOrigin，不访问 WebView
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
checkAsrStatus/initLocalAsr/forceInitLocalAsr: nativeAsrAvailable → 早期 return（不加载 WASM）
startVoiceRecording: 不变（localAsrAvailable=false → MediaRecorder → POST /api/asr/recognize）
handleAsrAudio:
  nativeAsrAvailable:
    未 ready → 触发 ensureModel → 回 asrResult{error:'模型下载中'}
    ready → decodeAudioToPcmBase64(webm→16k mono s16le base64) → asrRecognize → asrResult{text}
  非 APK → SherpaASR.recognizeBuffer WASM（不变）
decodeAudioToPcmBase64: atob → OfflineAudioContext.decodeAudioData → OfflineAudioContext(1,len,16000) 重采样 → Float32→s16le → btoa
asrConfig:
  nativeAsrAvailable → localAsrEnabled=false 时 nativeAsrReady=false + 能力上报 false
  否则 → 原有 WASM 启停逻辑
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
```

## 录音（不变）

Manifest 加 RECORD_AUDIO；MainActivity 运行时权限；DisplayWebView.onPermissionRequest 授予 RESOURCE_AUDIO_CAPTURE。
