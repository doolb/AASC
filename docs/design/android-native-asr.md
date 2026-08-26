# Android 显示端原生语音识别（SenseVoice / sherpa-onnx）设计文档

## 概述

在现有 `android-display` APK 中集成 **sherpa-onnx 官方 Android AAR**，原生加载 SenseVoice Small int8 模型（与服务器端同一份模型文件），替代 display.html 里的浏览器 WASM ASR（`sherpa-asr.js`），解决 WASM 推理慢、占内存高的体验问题。

核心价值：APK 作为"原生识别引擎"接入**现有服务器中转流程**（`asr.device='display'` 时的 `asrAudio`/`asrResult` 协议），服务器代码与调度逻辑基本不变，浏览器环境行为完全不受影响。

## 需求背景

### 现状问题

| 问题 | 根因 |
|------|------|
| APK 内 WASM 识别慢、内存占用高 | 234MB 模型在 WebView WASM 环境推理性能差 |
| APK 内语音功能实际不可用 | Manifest 无 `RECORD_AUDIO`，WebView 未覆写 `onPermissionRequest`，`getUserMedia` 永久挂起 |
| 模型不适合浏览器分发 | 234MB 模型让浏览器加载不现实，APK 本地加载才可行 |

### 目标

1. APK 原生运行 SenseVoice int8（`model.int8.onnx`，约 234MB），识别性能显著优于 WASM
2. 模型**需要识别时自动下载**：首次需要时从 AASC 服务器拉取，APK 安装包保持小体积
3. 识别路径**统一服务器中转**：音频先上传服务器，服务器按 `asr.device` 设置分发（`display` 时经 WS 回本机原生识别）
4. 录音方式不变：沿用现有 `getUserMedia` + `MediaRecorder`（APK 补权限即可），PCM 解码在 JS 侧用 WebAudio 完成

### 约束

- 显示端设备：Android 7+（minSdk=24 已满足，sherpa-onnx AAR 兼容）
- 服务器中转协议（`asrAudio`/`asrResult`/`voiceInput`）零改动；仅新增模型下载接口
- display.html 渐进改造：检测到原生桥才走原生路径，浏览器访问行为完全不变
- 原生桥接口契约：**只收解码后的裸 PCM**（16kHz mono s16le base64），容器解码放 JS 侧 WebAudio
- 不做本地流式识别上屏（统一服务器中转，不做"本机直识别"双路径）

## 核心架构

```
【APK 侧 Kotlin】                              【服务器】(协议不变)             【display.html JS】
┌──────────────────────────┐                                                 ┌────────────────────────┐
│ AsrModelManager          │  ① 首次需要时 GET /api/asr/model/<file> 下载    │ NativeDisplay.asrStatus()│
│  (下载/校验/加载/自检)    │ ◄─────────────────────────────────────────── │ asrEnsureModel()       │
│                          │                                                 └────────────────────────┘
│ NativeAsrEngine          │  ② 录音上传 POST /api/asr/recognize (现有接口)  ┌────────────────────────┐
│  (sherpa-onnx AAR        │ ◄────────────────────────────────────────── │ getUserMedia+          │
│   OfflineRecognizer)     │  ③ asr.device='display' 时 WS asrAudio 回本机  │ MediaRecorder（不变）   │
│  recognize(pcm)→text     │ ◄──────────────────────────────┐             │ handleAsrAudio()       │
│                          │  ④ JS 解码 webm→PCM 后调桥      │             │  改调原生桥            │
│  asrRecognizeAsync() ◄───┼───────────────────────────────│─────────────│                        │
│  异步回调 text            │  ⑤ WS asrResult 回传服务器 ────►│────────────►│ voiceCommand（不变）   │
└──────────────────────────┘                                 └─────────────┴────────────────────────┘
```

## 组件设计

### 1. AsrModelManager（新增 Kotlin 单例）

模型文件的下载、校验、加载与状态管理。

- **存储**：`filesDir/models/sensevoice/{model.int8.onnx, tokens.txt}`
- **下载**：先读取服务器同名 `.sha256` 文件；模型拉取到 `.tmp` 后计算 SHA-256，与服务器 hash 一致才原子改名，并把已验证 hash 保存到 APK 本地
- **校验**：文件大小检查 + 加载自检（sherpa-onnx 初始化成功即认为完整）；损坏则删除本地文件回 `not_ready`
- **状态机**：`not_ready → downloading → ready / error`；`error` 或损坏后下次需要时重新触发
- **OOM 防护**：加载前 `ActivityManager.getMemoryInfo` 检查可用内存，不足直接报 `error` 不硬加载
- **线程**：下载在 IO 线程；引擎加载在工作线程；状态用 `@Volatile` + 单例锁

### 2. NativeAsrEngine（新增 Kotlin 单例）

sherpa-onnx `OfflineRecognizer` 的封装。

- 依赖：官方 AAR `com.k2fsa.sherpa.onnx`（与服务器端 sherpa-onnx-node 同源，识别行为一致）
- 模型配置：SenseVoice int8 ONNX + tokens.txt，与 `asr-service.js` 的 modelConfig 对齐
- 识别 API 同步语义：输入 16kHz mono Float32 样本，输出文本；单例加锁串行处理并发请求
- 内存：模型 mmap，APK 内存占用增加约 300-400MB

### 3. NativeBridge 增量方法（异步识别，兼容旧同步桥）

服务器 origin 由 `MainActivity` 在主线程的 `onPageStarted`/`onPageFinished` 回调中缓存到 `NativeBridge`；JavaScript bridge 线程只读取缓存，不直接访问 `WebView.url`，避免 WebView 跨线程访问导致模型下载入口提前返回。

```kotlin
// 查询引擎状态
// 返回 {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
fun asrStatus(): String

// 触发模型下载+加载（幂等）。就绪返回 ready；下载中返回 downloading
fun asrEnsureModel(): String

// 一次性异步识别。输入：requestId、裸 PCM（16kHz mono s16le）的 base64、声纹模式
// 立即返回 accepted；完成后由主线程回调 window.onNativeAsrResult
fun asrRecognizeAsync(requestId: String, pcmBase64: String, useVoiceprint: Boolean, multiSpeaker: Boolean): String

// 旧 APK 兼容入口：同步返回 {"text":"..."} 或 {"error":"..."}
fun asrRecognize(pcmBase64: String): String
```

原生 → JS 回调（1 个）：

```javascript
// 模型下载/加载进度与结果
window.onNativeAsrModel({state:'downloading', progress:42})
window.onNativeAsrModel({state:'ready'})
window.onNativeAsrModel({state:'error', error:'...'})
window.onNativeAsrResult({requestId, text, error, speaker, segments})
```

### 3.1 CPU 集群识别与 affinity 原语（Task 2）

APK 新增共享的 `CpuCluster` / `CpuTopology` / `CpuAffinity` 原语，供 ASR/TTS 并发池绑定工作槽使用；ASR pool 已接入同步与异步识别路径。

- `CpuCluster.detect(reader)` 读取 `/sys/devices/system/cpu/possible`、`online` 和每个在线 CPU 的 `cpufreq/cpuinfo_max_freq`，按最大频率确定 big/little 集群；`reader` 可注入，JVM 单测不访问 Android sysfs。
- `CpuTopology.policy(bigCoreCount, littleCoreCount)` 对请求数量做非负裁剪，按 CPU 编号稳定选择大核/小核，输出实际 CPU 列表、bit mask、有效数量和 fallback 原因；Kotlin/JNI 统一只支持 CPU ID `0..62`，CPU 63 和更高 ID 不进入 policy/mask。合法配置请求至少一个槽位且存在受支持 CPU 时返回确定性回退 CPU；如果设备只暴露不受支持的 CPU ID，则返回空 fallback policy 和 `cpuMask=0`，避免产生无法应用的非空策略。
- `CpuAffinity.applyCurrentThread(cpuMask)` 通过 JNI 对当前 native 线程调用 `sched_setaffinity`；`cpuMask` 必须是 `0..62` 生成的正 Long mask。native 库加载失败、权限拒绝、系统调用失败或空 mask 都只记录日志并返回 `false`，不得让 ASR 请求失败。

### 3.2 ASR 并发引擎池（Task 3）

ASR 从单个全局 `OfflineRecognizer` 改为 `AsrEnginePool`。池大小等于服务器下发 ASR 大核数与小核数在 APK 拓扑中得到的 `policy.totalCoreCount`，但至少为 1；当 topology 或 mask 不可用时仍保留 1 个自动调度槽位。

- 每个池槽拥有独立 sherpa-onnx `OfflineRecognizer` 和单线程 worker，`OfflineRecognizerConfig.modelConfig.numThreads=1`，避免“请求并发数 × 推理线程数”过量占核。
- 每次识别先从池里获取空闲槽；超过槽位数量的请求在池内排队，不创建额外 recognizer。槽 worker 在线程内调用 `CpuAffinity.applyCurrentThread(slot.cpuMask)` 后再识别；affinity 返回 `false` 时只回退 Android 默认调度，不让请求失败。
- 模型重载或 ASR CPU 配置变更时先构造新池，构造成功后原子替换当前池；旧池进入 retired 状态后仍继续服务已经 retain 的旧请求，包括已经阻塞等待空闲槽的请求。最后一个 retained 调用结束后再释放所有空闲槽，避免 in-flight/queued 识别读到已释放的 native recognizer 或永久等待。
- Task 3 已接入 ASR pool；TTS pool、控制端大小核 UI 和 display.html 的 `cpuConfig` 消费分别在后续 Task 4/5 完成。

### 4. 录音权限补全（APK）

- Manifest 增加 `RECORD_AUDIO`
- `MainActivity` 启动时请求运行时权限
- `DisplayWebView` 的 `WebChromeClient` 覆写 `onPermissionRequest`：对 `RESOURCE_AUDIO_CAPTURE` 直接 `grant()`
- 效果：现有 `getUserMedia`/`MediaRecorder` 录音代码在 APK 内原样可用，JS 录音逻辑零改动

### 5. display.html 接入点（5 处改造）

**5.1 能力探测 `detectCapabilities`**
- `voiceRecording`：现有 getUserMedia 探测不变（APK 补权限后自然通过）
- `voiceRecognition`：APK 下由 `NativeDisplay.asrStatus()` 决定
  - `ready` → true
  - `not_ready` → 触发 `asrEnsureModel()`，先报 false；`onNativeAsrModel({state:'ready'})` 后重新探测并上报 true（服务器 `findDisplayWithAsr` 随即选中它）

**5.2 跳过 WASM 加载（性能核心）**
- `checkAsrStatus`/`initLocalAsr`/`forceInitLocalAsr` 开头判断：原生 ASR 可用直接返回
- 不再加载 234MB WASM，不走 `startStreaming` 本地流式
- `startVoiceRecording` 因 `localAsrAvailable=false` 自动落到现有 `MediaRecorder → POST /api/asr/recognize` 路径，录音代码零改动

**5.3 `handleAsrAudio` 改调原生识别**
```
收到 asrAudio(data.audioData = base64 webm/wav)
  ├─ 原生 ASR 可用 → base64 解码 → AudioContext.decodeAudioData
  │    → OfflineAudioContext 重采样 16kHz mono → s16le base64
  │    → 新 APK 调 NativeDisplay.asrRecognizeAsync(requestId, pcm, voiceprint)
  │    → ASR pool 按槽位并发识别 → window.onNativeAsrResult → 回 asrResult{text}
  │    → 旧 APK 无异步入口时回退 NativeDisplay.asrRecognize(pcm)
  │    （模型未就绪：先 asrEnsureModel()，回 asrResult{error:'模型下载中'}，
  │      服务器 60s 超时按失败处理，下次请求时模型可能已就绪）
  └─ 非 APK → 现有 SherpaASR.recognizeBuffer WASM 路径（不动）
```

异步桥只在 JS bridge 线程提交任务并立即返回，识别最长 60 秒；超时或异常均通过
`window.onNativeAsrResult` 回传；这样原生推理不会阻塞 WebView 的 WebSocket、媒体和页面事件循环。

**5.4 下载进度上屏**：`onNativeAsrModel` 回调复用 `updateVoiceTextDisplay`：`downloading` 显示"语音模型下载中 N%"，`ready` 显示"语音识别已就绪"，`error` 显示失败原因。`AsrModelManager` 将状态切换为 `downloading` 后立即回调 0%，避免 tokens 下载、网络建立或首个模型数据块到达前界面没有提示；`detectCapabilities` 读到已有 `downloading` 状态时也立即恢复当前进度提示，覆盖 WebView 回调时序不确定的情况。

**5.5 `asrConfig` 开关映射**：服务器推送 `localAsrEnabled` 时，APK 下映射为原生引擎启用/停用（停用时 `voiceRecognition` 报 false）；浏览器仍控制 WASM。

**5.6 模型 hash 校验与缓存**：服务器在 `res/models/sensevoice/` 为每个模型保存同名 `.sha256` 文件。APK 首次下载时将模型写入 `.tmp`，下载完成后计算 SHA-256，与服务器 hash 文件比较；比较成功后才改名，并保存本地 `.sha256` 文件。后续启动不重新计算模型 hash，只读取本地保存的 hash 和服务器 hash 比较；模型文件、本地 hash 均存在且与服务器一致时直接加载。服务器 hash 暂时不可访问时，已有模型与本地 hash 均存在则沿用上次已验证结果；没有本地已验证文件时不启动无 hash 校验的下载。

### 5.5.1 自动下载触发修复

- detectCapabilities 的 WebGPU 异步诊断使用独立变量缓存，待 capabilities 对象初始化完成后再写入诊断字段，避免 JavaScript 暂时性死区异常中断能力检测。
- 收到 localAsrEnabled=true 时，如果原生模型状态为 not_ready 或 error，主动调用幂等的 asrEnsureModel()；状态为 ready 时直接恢复 voiceRecognition 能力。
- 以上修复保证首次连接和服务器动态切换两条路径都能触发模型下载。

### 5.5.2 真机压测发现的后续问题

- SM-N9500 真机已验证模型自动下载、hash 校验、加载和 `voiceRecognition=true` 能力上报。
- 通过服务器路由的 5 次串行 `zh.wav` 请求均到达 APK，但 `NativeDisplay.asrRecognize()` 返回空 JSON `{}`，正式速度压测需待原生桥结果链路修复。
- 声纹匹配 native 路径出现 `VoiceprintEngine.match` 崩溃，需与 ASR 识别链路分开定位。

### 6. 服务器改动（server-app.js，仅 1 个新接口）

```
GET /api/asr/model/<filename>   // filename 白名单：model.int8.onnx / tokens.txt / 对应 .sha256
  - 从 res/models/sensevoice/ 读取，fs.createReadStream 流式返回（不读进内存）
  - 模型文件带 Content-Length 便于 APK 计算下载进度；.sha256 文件返回纯文本
  - 路径穿越防护：filename 严格白名单匹配，不拼接任意路径
```

## 数据流（完整识别链路）

1. APK 端按住说话（或持续监听）：`getUserMedia` 录音 → `MediaRecorder` 产出 webm
2. `sendAudioForRecognition` → `POST /api/asr/recognize`（现有）
3. 服务器 `asr.device='display'` → `findDisplayWithAsr()` 选中本 APK → WS `asrAudio` 下发 base64
4. display.html `handleAsrAudio` → WebAudio 解码 webm 重采样 16kHz mono PCM → `NativeDisplay.asrRecognize(pcmBase64)`
5. 原生 sherpa-onnx 识别 → 同步返回 text → WS `asrResult` 回传
6. 服务器收到 text → `POST /api/asr/recognize` 响应给上传端 → 上传端发 `voiceInput` → `voiceCommand` 流程（现有）

跨端场景：控制端 chat.js 上传音频同样走 2-6，APK 作为纯识别引擎被调用。

## 错误处理

| 场景 | 行为 |
|------|------|
| 模型下载中收到 `asrAudio` | 回 `asrResult{error:'模型下载中'}`；服务器按失败响应调用方，用户重试即可 |
| 下载失败（断网/服务器不可达） | 已有本地 hash 与模型时沿用已验证模型；没有本地已验证文件或 hash 校验失败时回 `onNativeAsrModel{error}`，下次需要时重新触发下载 |
| 模型 hash 不匹配 | 删除 `.tmp`、模型和本地 hash 文件，回 `onNativeAsrModel{error}`，下次重新下载 |
| 模型文件损坏 | 加载自检失败 → 删除本地文件 → `not_ready` → 下次自动重下 |
| 识别中收到新 `asrAudio` | 进入 ASR pool；每个 slot 独立 recognizer，单槽 worker 使用 `numThreads=1`，并发上限由配置核心总数决定 |
| 用户拒绝 RECORD_AUDIO 权限 | `voiceRecording=false` 上报，语音 UI 沿用现有"能力关闭"路径 |
| `asr.device=server` | APK 收不到 `asrAudio`，原生引擎闲置不耗资源 |
| 低端机内存不足 | 加载前内存检查失败 → 报 `error`，不硬加载防 OOM |
| WebView `decodeAudioData` 失败 | catch 后回 `asrResult{error}`，不崩溃 |

## 兼容性

- **浏览器访问 display.html**：`NativeDisplay` 不存在，走原有 WASM/服务器路径，完全不受影响
- **旧版 APK + 新服务器**：无 ASR 桥方法，`voiceRecognition` 依旧报 false，退化到 `asr.device=server`
- **新版 APK + 旧服务器**：无 `/api/asr/model` 接口，模型下载 404 → 报 `error`；功能不可用但不影响其他能力

## 性能预期

- SenseVoice int8 移动端原生 ARM 推理：约 10s 音频 1-2s 出结果，显著优于 WASM
- APK 内存占用增加约 300-400MB（模型 mmap）
- APK 安装包体积不变（模型运行时下载）

## 自测方案

1. **Kotlin 单测**：`AsrModelManager` 状态机（下载→就绪→损坏重下）、PCM base64 边界（空输入/奇数长度）
2. **接口自测**：`curl /api/asr/model/model.int8.onnx` 校验 Content-Length 与文件一致；读取对应 `.sha256` 并与本地 `sha256sum` 比较；非法文件名返回 400
3. **真机链路自测**：
   - 装 APK → 开启语音能力 → 观察模型下载进度上屏 → 就绪后 `voiceRecognition=true` 上报
   - 服务器 `asr.device=display`，APK 端按住说话 → "录音→上传→中转回本机→原生识别"全链路，结果与服务器端 SenseVoice 比对一致性
   - 浏览器控制端 chat.js 说话 → 音频中转 APK 识别 → 验证跨端中转
   - 下载中断网→恢复后重下成功
   - 识别耗时对比（原生 vs WASM）
   - 首次下载模型时，在开始下载到首个进度回调前仍显示"语音模型下载中 0%"，随后进度持续更新
   - 下载完成后篡改临时文件内容，验证 hash 不匹配时不会改名加载
   - 重启 APK，验证只比较本地 hash 与服务器 hash，不重新读取模型计算 hash

### 端到端测试记录（2026-08-19）

- 使用 `3rd/ttslive/models/sensevoice/{zh,en,ja,ko,yue}.wav` 通过 `/api/asr/recognize` 调用 APK 显示端。
- 服务器 hash 接口正常返回，APK 设备 `192.168.1.6:5555` 已连接；但 APK 持续返回“模型下载中”，未上报 `ready`，5 个 WAV 均未获得识别文本。
- 设备日志显示 `asrEnsureModel()` 反复触发，并伴随 `serverBaseUrl()` 在 JavaBridge 线程读取 WebView URL 的线程告警；该问题需修复后重新进行真机识别验证。
- 进一步复现：连续 3 次请求均重复进入 `asrEnsureModel()`，`files/models/sensevoice` 仍未创建，且无 `ModelDownloader` 日志；设备侧 `curl` 可正常访问 hash 接口。因此问题位于 APK 下载入口/服务器地址解析，不是服务器模型文件或设备网络不可达。
- 修复：新增 `ServerOrigin` 纯逻辑解析器；`MainActivity` 主线程缓存页面 origin；`NativeBridge.serverBaseUrl()` 改为只读缓存。
- 修复后真机验证：`.tmp` 模型文件从约 56MB 增长到 228MB，完成原子改名，并保存两个本地 hash 文件，确认下载与校验流程已恢复。
- 修复：`AsrEngine.load()` 加载 APK 私有目录中的绝对路径模型时向 sherpa-onnx 传入空 `AssetManager`，避免 AAR 将外部文件误当作 Asset 读取。
- 真机复测：保留已通过 hash 校验的模型缓存后，APK 已直接进入 `ready`，没有重复下载。
- 最终验证：`zh.wav` 返回“开饭时间早上9点至下午5点。”；串接 `zh.wav + en.wav` 返回一段完整 zh 文本“开放时间早上9点至下午5点。”，未注册的 en 片段被过滤。

## 2026-08-26 集成验证记录（Task 6）

- Node 集成回归 22/22 通过；Android JVM 单测与 `assembleDebug` 通过。
- `npm run upload:apk` 和 `npm run start:apk:display -- 2` 成功；设备 `192.168.1.6:5555` 的 APK 进程存活，WindowManager 可见 display2 窗口。
- 服务器默认 ASR 配置为 `1 大核 + 1 小核`，设备 CPU 0--3 为 little、CPU 4--7 为 big；进程允许 CPU 0--7。
- 本轮未重新测量 ASR PSS/native heap，也未把 affinity syscall 成功率作为已验证结论；失败时仍按设计回退系统默认调度。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/apps/android-display/app/build.gradle.kts` | 新增 sherpa-onnx AAR 依赖 |
| `src/apps/android-display/app/src/main/AndroidManifest.xml` | 新增 `RECORD_AUDIO` 权限 |
| `.../MainActivity.kt` | 运行时权限请求；`onPermissionRequest` 授予音频采集 |
| `.../NativeBridge.kt` | 新增 `asrStatus`/`asrEnsureModel`/`asrRecognize` 3 个桥方法 |
| `.../ServerOrigin.kt` | 解析页面 URL 的 HTTP/HTTPS origin，供主线程缓存服务器地址 |
| `.../MainActivity.kt` | 在 WebView 页面回调中更新 NativeBridge 的服务器 origin 缓存 |
| `.../AsrModelManager.kt`（新增） | 模型下载/校验/加载/状态机 |
| `.../NativeAsrEngine.kt`（新增） | sherpa-onnx OfflineRecognizer 封装 |
| `src/apps/web-mediacenter/ui/public/display.html` | 能力探测/跳过 WASM/handleAsrAudio 原生路径/进度上屏 |
| `src/apps/server/boot/server-app.js` | 新增 `GET /api/asr/model/<file>` 接口 |
| `docs/spec/android-native-asr.md`（新增） | 实现伪代码文档 |
| `docs/design.md` / `docs/spec.md` | 索引更新 |
