# Android 显示端原生语音识别（SenseVoice / sherpa-onnx）设计文档

## 概述

在现有 `android-display` APK 中集成 **sherpa-onnx 官方 Android AAR**，作为服务器选择“显示端”时的 ASR 提供端。录音显示端仍只提交服务端公共 `/api/asr/recognize`，不会直接调用自己的 ASR。

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
3. 识别路径**统一服务器入口**：音频先上传公共 `/api/asr/recognize`；服务端模式由服务器识别，显示端模式按连接顺序转发给第一个可用 Android ASR 提供端
4. 录音端使用 `getUserMedia` + `PcmAudioCapture` 封装原始 WAV；仅被服务器选中的 APK 提供端调用原生 ASR

### 约束

- 显示端设备：Android 7+（minSdk=24 已满足，sherpa-onnx AAR 兼容）
- 服务器中转协议（`asrAudio`/`asrResult`/`voiceInput`）零改动；仅新增模型下载接口
- 录音显示端不直接调用原生 ASR；被服务端选中的 Android ASR 提供端处理 `asrAudio` 并回传 `asrResult`
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
- `voiceRecognition`：表示显示端可作为服务器 ASR 提供端；Android 由原生模型状态决定，普通浏览器显示端为 false
- 录音显示端的公共 ASR 可用性由 `/api/asr/status` 单独决定，不与 `voiceRecognition` 混用

**5.2 统一服务端入口与显示端提供者**
- `checkAsrStatus` 请求 `/api/asr/status`，决定录音显示端是否可以启动公共 ASR 监听
- `startVoiceRecording` 使用 `PcmAudioCapture` 采集原始 PCM/WAV，每段 POST `/api/asr/recognize`
- `asr.device=server` 时服务器直接执行 ASR；`asr.device=display` 时服务器按 `displayClients` 连接顺序选择 `voiceRecognition=true` 的显示端
- 录音显示端不调用本地 Sherpa 或自身 Android ASR；被选中的 Android 提供端才处理 `asrAudio`

**5.3 `asrConfig`**：服务端推送公共 ASR 设备和中文/降噪参数；选择显示端且模型未就绪时，提供端按原生模型状态下载和回报能力。

**5.4 原生模型接口**：Kotlin 原生 ASR 模型、异步桥和并发池仅在该 APK 被服务器选为 ASR 提供端时使用。

**5.6 模型 hash 校验与缓存**：服务器在 `res/models/sensevoice/` 为每个模型保存同名 `.sha256` 文件。APK 首次下载时将模型写入 `.tmp`，下载完成后计算 SHA-256，与服务器 hash 文件比较；比较成功后才改名，并保存本地 `.sha256` 文件。后续启动不重新计算模型 hash，只读取本地保存的 hash 和服务器 hash 比较；模型文件、本地 hash 均存在且与服务器一致时直接加载。服务器 hash 暂时不可访问时，已有模型与本地 hash 均存在则沿用上次已验证结果；没有本地已验证文件时不启动无 hash 校验的下载。

### 5.5 原生模型验证记录

- 原生模型下载、hash 校验、加载和 APK 桥接口用于显示端提供端识别，不作为录音显示端的本地识别依赖。
- 声纹匹配 native 路径出现 `VoiceprintEngine.match` 崩溃，需与 ASR 识别链路分开定位。

### 6. 服务器改动（server-app.js，仅 1 个新接口）

```
GET /api/asr/model/<filename>   // filename 白名单：model.int8.onnx / tokens.txt / 对应 .sha256
  - 从 res/models/sensevoice/ 读取，fs.createReadStream 流式返回（不读进内存）
  - 模型文件带 Content-Length 便于 APK 计算下载进度；.sha256 文件返回纯文本
  - 路径穿越防护：filename 严格白名单匹配，不拼接任意路径
```

## 数据流（完整识别链路）

1. 录音显示端：`getUserMedia` 录音 → `PcmAudioCapture` 产出 WAV
2. `sendAudioForRecognition` → `POST /api/asr/recognize`（现有）
3. 服务器 `asr.device='display'` → 按连接顺序 `findDisplayWithAsr()` 选择本 APK → WS `asrAudio` 下发 WAV base64
4. 被选 APK 的 display.html `handleAsrAudio` → WAV/PCM 转换 → `NativeDisplay.asrRecognize(pcmBase64)`
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

- **浏览器访问 display.html**：`NativeDisplay` 不存在，只作为录音端提交公共 ASR，不作为显示端 ASR 提供端
- **旧版 APK + 新服务器**：无 ASR 桥方法，`voiceRecognition` 报 false；显示端模式跳过该设备，服务端模式仍可用
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

## 2026-08-28 测试 APK 能力接入正式 Display APK

本次正式接入只保留普通非流式 ASR、全局降噪开关和快速多段声纹识别；不接入测试 APK 的流式 ASR，正式显示端固定使用中文。

## 2026-08-29 固定中文与全局降噪入口

正式显示端不再提供语言选择，原生 ASR 请求统一使用 `zh`。降噪配置虽然由控制端声纹面板维护，但它是 ASR 全局配置，普通非流式 ASR、单段声纹和快速多段声纹都使用同一状态；关闭声纹识别不会关闭降噪。

### 功能边界

- 普通 ASR：完整音频一次送入 SenseVoice，返回一次文本，不做流式 partial、不做分段和说话人识别。
- 降噪：开启后每个请求只执行一次 Sherpa GTCRN，降噪后的同一份 PCM 同时用于普通 ASR、声纹分段、embedding 和分段 ASR。
- 快速多段：使用 Sherpa diarization 的 `numClusters`；人数为 `AUTO` 时由模型估计，或显式限制为 1～5 人。每个 cluster 只提取最长代表片段的 embedding，再对原始时间段做 ASR。
- 语言：正式显示端固定使用 `zh`。识别结果只做首尾空白清理，不按 Unicode 脚本删除文字。
- 生效范围：降噪和快速多段在 `asr.device=display` 的原生 APK 路径统一生效；控制端的降噪入口位于声纹面板，普通 ASR 和声纹流程共享状态。

### 配置协议

服务端保存并广播：

```json
{
  "type": "asrConfig",
  "device": "display",
  "localAsrEnabled": true,
  "languageMode": "auto",
  "denoise": false
}
```

```json
{
  "type": "voiceprintConfig",
  "enabled": true,
  "threshold": 0.5,
  "multiSpeaker": true,
  "multiMode": "fast",
  "speakerCount": "AUTO"
}
```

旧字段继续保留；缺失 `multiMode` 时按 `fast` 处理，缺失人数时按 `AUTO` 处理。

### 2026-08-28 内存不足重连与正式 APK 准确度修复

- 正常情况下仍按服务器下发的 ASR 核心数创建 recognizer 池，保留多请求并发能力；只有内存预算不足时才回退为 1 个 recognizer。
- 加载前按“每个 recognizer 的内存预算 × 请求 slot 数”判断是否可承载完整池。单 slot 仍不足，或 native 构造过程中抛出 `OutOfMemoryError` 时，释放已经创建的 slot，进入不可自动重试的内存错误状态。
- 内存错误只撤销 `voiceRecognition` 能力并停止录音，不关闭 WebSocket；内存恢复后的显式重试可以再次按核心数尝试。
- 测试 APK 与正式 APK 的 SenseVoice 模型 SHA-256、16kHz 特征、CPU provider 和 ITN 配置一致；正式 APK 的准确度差异来自 WebM/Opus 录音和浏览器隐式音频处理。
- 显示端改用 WebAudio 原始 PCM 采集并封装 WAV，关闭浏览器层 `echoCancellation`/`noiseSuppression` 请求参数；不再创建 MediaRecorder/WebM 录音上传路径。

### 2026-08-28 全端录音格式统一

- 控制端语音输入、控制端声纹注册、正式显示端和网页录音统一使用 WebAudio 原始 Float32 采集，重采样为 16 kHz mono 后封装 WAV。
- Node 子显示端继续使用现有 16 kHz PCM/WAV 录音器；Go/C# 子显示端继续以 `audio.wav` 上传，增加契约校验。
- 独立 `3rd/ttslive` 测试网页的录音入口同样改用原始 PCM/WAV，避免仓库内仍残留把 WebM 数据伪装成 WAV 的路径。
- 正式链路不再以 MediaRecorder/WebM 作为录音回退，避免不同端因浏览器编码器差异产生识别准确度差异；仅保留已有 WAV 接口协议。

## 2026-08-29 移除 ASR 其他文字过滤

正式显示端和独立测试 APK 不再提供“过滤其他文字”开关，也不再支持 `zh-en-filter` 语言模式。正式显示端固定使用 `zh` 语言提示，识别结果仅做原有首尾空白清理，不按 Unicode 脚本删除文字。这样可以避免把模型误识别出的日文字符直接删除，便于继续观察真实识别结果；流式 ASR 的固定中英双语模型不受影响。

配置广播只保留 `languageMode` 和 `denoise`，Android 原生桥只接收语言与降噪参数；旧请求中的 `filterOtherText` 或 `zh-en-filter` 不再被处理。
