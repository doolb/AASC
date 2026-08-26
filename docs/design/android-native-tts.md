# Android 显示端原生语音生成（Microsoft Embedded Speech SDK）设计文档

## 概述

在现有 `android-display` APK 中集成 **Microsoft Cognitive Services Speech SDK（Embedded）** 的离线语音合成能力，让 APK 可以在不依赖外网 TTS 服务的情况下本地合成语音。

本次只支持一个内置声线：`zh-CN-XiaoxiaoNeural`（xiaoxiao）。模型从服务器按需下载，APK 安装包保持小体积。控制端新增“语音生成设备”选项，可选服务端或显示端；当选择显示端但显示端离线、能力未就绪或合成出错时，服务器临时回退到服务端 TTS，保证语音播报不中断。

核心价值：把离线语音合成从服务器 / 浏览器端移到 APK 原生引擎，降低对 TTS 服务的依赖，同时保持现有控制端播报协议大部分不变。

## 需求背景

### 现状问题

| 问题 | 根因 |
|------|------|
| 语音合成依赖外部 TTS 服务 | 服务器 `tts.generateTTS()` 走远端 API，网络或服务故障时播报失败 |
| 显示端只负责播放，不具备生成能力 | APK 内没有嵌入式 TTS 引擎，能力列表无 `ttsGeneration` |
| 控制端无可选合成设备 | 缺少“服务端 / 显示端”切换配置与回退逻辑 |

### 目标

1. APK 原生使用 Embedded Speech SDK 离线合成 `zh-CN-XiaoxiaoNeural` 声线
2. 模型需要时从 AASC 服务器下载并校验，首次下载后本地缓存复用
3. 显示端能力记录到 `ttsGeneration`（语音生成）
4. 控制端新增“语音生成设备”选项，可选服务端或显示端
5. 显示端离线 / 模型未就绪 / 合成失败时临时回退服务端 TTS
6. 所有服务端 TTS 生成入口统一经过 `generateTtsWithFallback()`，包括 API、聊天、Agent、文本媒体、语音指令、提醒和整点报时

### 约束

- 显示端设备：Android 8+（minSdk=26，Embedded SDK 的 azure-core 1.58.1 依赖 `MethodHandle`，D8 强制要求 API 26）
- 嵌入式 Speech SDK 仅提供 `arm64-v8a` 原生库
- 暂时只支持一个内置声线 xiaoxiao，不做多声线切换
- 模型从服务器下载，不打包进 APK
- 不引入大段 `if-else` 链，路由与回退用状态判断 + 提前返回

## 核心架构

```
【服务器 res/models/tts】                【APK（TtsModelManager + TtsEngine）】
  manifest.json (sha256 清单)  ──下载──►  filesDir/models/tts（校验后缓存）
  14 个模型文件                 ──下载──►  加载 EmbeddedSpeechConfig
                                          SpeechSynthesizer（Xiaoxiao）

【控制端】                  【服务器】                【显示端 display.html】
  语音生成设备(server/display) → ttsConfig → 检测/下载模型 → ttsGeneration 能力
                                    │  ttsGenerate（base64 WAV）
                                    ├─ ttsGenerating（3s 内确认）
                                    └─ ttsResult ─► 写临时 wav → 播放
                                    回退：显示端失败 → 服务端 generateTTS
```

## 组件设计

### 1. TtsEngine / TtsEnginePool（Kotlin 单例 + 并发池）

Embedded Speech SDK 的 `SpeechSynthesizer` 封装。

- 加载：`EmbeddedSpeechConfig.fromPath(modelDir)`，输出格式 `Riff24Khz16BitMonoPcm`
- 声线：`probeVoice()` 从模型声线列表中优先选择包含 `Xiaoxiao` 的声线，找不到则取第一个
- 授权：嵌入式语音密钥与参考 POC 一致，模型内置授权
- 并发：`TtsEnginePool` 按 `max(1, CpuPolicy.totalCoreCount)` 创建槽位；每个槽拥有独立 `SpeechSynthesizer` 和单线程 worker，并额外使用公平 `Semaphore(slotCount * 2)` 做显式有限准入（`slotCount` 活跃 + `slotCount` 排队），超限请求立即抛出明确的 `RejectedExecutionException`，而不是无限阻塞线程
- 绑定：每个槽在自己的 worker 线程调用 `CpuAffinity.applyCurrentThread(cpuMask)`；失败只降级为 Android 默认调度，不让合成失败
- 合成：`SpeakText(text)` 返回 WAV 字节；构造主合成器和声线探测器时均显式传入空 `AudioConfig`，禁止 Embedded Speech SDK 自动连接默认扬声器；`probeVoice()` 同时关闭 `SynthesisVoicesResult` 和探测 synthesizer，避免 SDK 结果对象泄漏
- 重配：模型加载或 TTS CPU policy 变更时先构造新 pool，替换成功后旧 pool 进入 retire；已经 retain、in-flight 或等待旧 slot 的请求继续完成，最后一个旧 caller 退出后再释放 slot
- 播放职责：APK 原生层只负责生成并回传 WAV，服务器收到后统一通过现有 `playAudio` 流程播放，避免生成阶段和服务器播放阶段各播一次
- 释放：`release()` 置 `ready=false` 并 retire 当前 pool；不直接释放正在执行的合成器

### 2. TtsModelFiles（新增纯逻辑）

- 定义 14 个模型文件名
- `needsDownload()`：缺任一文件或主模型 `MSTTSLocZhCN.dat` 小于 40MB 视为损坏
- `purge()`：删除模型文件及 `.tmp` 残件

### 3. TtsModelManager（新增 Kotlin 单例）

模型下载、校验、加载与状态管理。

- 存储：`filesDir/models/tts`
- 状态机：`not_ready → downloading → ready | error`
- 获取清单：`GET /api/tts/model-manifest`（数组 `[{name, sha256}]`）
- 下载校验：逐文件下载到 `.tmp`，SHA-256 与清单一致才原子改名
- 缓存：本地 `hashes.json` 与服务器清单完全一致时跳过下载，直接加载
- OOM 防护：加载前检查可用内存 > 200MB
- 事件：`downloading(progress)` / `ready` / `error` 经主线程回调 `window.onNativeTtsModel`

### 4. NativeBridge 增量方法

```kotlin
ttsStatus(): String JSON   # {"state":"ready|downloading|not_ready|error","progress":0-100,"error":"..."}
ttsEnsureModel(): String   # 触发下载/加载（幂等）；异步经 onNativeTtsModel 回调
ttsSynthesizeAsync(requestId, text): String # 成功提交返回 accepted:true；桥侧满载返回 accepted:false；完成后仅对已提交任务回调
ttsSynthesize(text): String # 旧 APK 兼容同步入口，返回 {"audio":"<base64 wav>"} 或 {"error":"..."}
window.onNativeTtsResult({requestId,audio,error}) # 原生异步 WAV 结果
```

`serverBaseUrl()` 复用主线程缓存的服务器 origin，避免 JavaBridge 线程跨线程访问 `WebView.url`。

TTS 合成任务由 `NativeBridge.ttsExecutor` 的 `TtsBridgeDispatcher` 提交到 `TtsEnginePool`；桥侧 worker 数为当前 `slotCount = max(1, policy.totalCoreCount)`，有界队列容量同为 `slotCount`。提交时即完成有限准入，队列满时同步入口返回普通错误 JSON，异步入口返回 `accepted:false`，不会先提交再通过回调报告拒绝。桥侧与 pool 内公平 Semaphore 形成双层保护，JavaScript bridge 线程只提交任务（异步入口）或等待兼容入口结果，不负责音频播放。

`cpuConfigure()` 在 TTS policy 成功应用且 slot 数变化后与提交共用锁换代 dispatcher；旧 executor 使用 `shutdown()` 排空已提交任务，不打断 active TTS 工作，也不接受换代后的新任务。异步页面入口使用 `cpuConfigureAsync()`，相同配置不重复应用。

### 4.0 TtsBridgeDispatcher（桥侧有界调度）

- `workerCount = max(1, currentTtsPolicy.totalCoreCount)`，固定 worker 数；`queueCapacity = workerCount`，使用 `ArrayBlockingQueue`。
- `submit()`、`reconfigure()` 与 NativeBridge 的 TTS 提交流程共用锁，避免 policy 换代期间出现提交到错误 executor 或非确定性接受结果。
- `RejectedExecutionException` 在 API 边界映射为同步 `{error:'TTS 请求过多，请稍后重试'}` 或异步 `{accepted:false,error:'TTS 请求过多，请稍后重试'}`，被拒绝异步请求不注册超时任务、不发送 `onNativeTtsResult`。
- `reconfigure()` 先切换新 executor，再对旧 executor 调用 `shutdown()`；已提交任务允许完成，旧队列排空后线程退出。

### 4.1 CPU 集群识别、affinity 原语与 TTS pool（Task 2 / Task 4）

APK 共享 `CpuCluster` / `CpuTopology` / `CpuAffinity` 原语，ASR/TTS 各自根据服务器下发的配置构造独立 pool。ASR/TTS 的 `preferBigCores` 分别控制对应 policy 的集群选择顺序，不改变 pool 总槽位数；控制端 UI 已接入两个独立开关。

- `CpuCluster.detect(reader)` 读取 `/sys/devices/system/cpu/possible`、`online` 和每个在线 CPU 的 `cpufreq/cpuinfo_max_freq`，按最大频率确定 big/little 集群；`reader` 可注入，JVM 单测不访问 Android sysfs。
- `CpuTopology.policy(bigCoreCount, littleCoreCount, preferBigCores)` 对请求数量做非负裁剪，按 CPU 编号稳定选择大核/小核，输出实际 CPU 列表、bit mask、有效数量和 fallback 原因；开启 `preferBigCores` 时以大核数与小核数之和作为总槽位，优先填充大核，再用小核补齐；关闭时按两类数量精确分配。Kotlin/JNI 统一只支持 CPU ID `0..62`，CPU 63 和更高 ID 不进入 policy/mask。合法配置请求至少一个槽位且存在受支持 CPU 时返回确定性回退 CPU；如果设备只暴露不受支持的 CPU ID，则返回空 fallback policy 和 `cpuMask=0`，避免产生无法应用的非空策略。
- `CpuAffinity.applyCurrentThread(cpuMask)` 通过 JNI 对当前 native 线程调用 `sched_setaffinity`；`cpuMask` 必须是 `0..62` 生成的正 Long mask。native 库加载失败、权限拒绝、系统调用失败或空 mask 都只记录日志并返回 `false`，不得让 TTS 请求失败。
- `NativeBridge.cpuConfigure()` 同时应用 ASR/TTS policy，分别读取 `asr.preferBigCores` 与 `tts.preferBigCores`，返回 `{ok, asr, tts, topology}`；`cpuConfigureAsync()` 在后台合并最新请求并立即返回；TTS 模型未加载时只缓存 policy，模型加载后按最新 policy 创建 pool。

### 5. display.html 接入点

**5.1 能力检测**
- `nativeTtsAvailable = !!(window.NativeDisplay?.ttsStatus)`
- `detectCapabilities` 中按 `ttsStatus()` 初始化 `ttsGeneration`
- 服务端开启显示端生成且模型未就绪时触发 `ttsEnsureModel()` 下载

**5.2 ttsConfig 协议**
- `localTtsEnabled=false`：清空 `nativeTtsReady`，能力上报 `ttsGeneration=false`
- `localTtsEnabled=true`：就绪则上报 `true`，否则触发下载

**5.3 ttsGenerate 处理**
- 原生桥不可用或模型未就绪 → 回 `ttsResult{error}`（服务器据此回退）
- 新 APK 就绪 → `ttsSynthesizeAsync(requestId,text)` → `onNativeTtsResult` → 回 `ttsResult{audioData:base64}`
- 旧 APK 没有异步方法 → 回退 `ttsSynthesize(text)`

**5.4 onNativeTtsModel 回调**
- `downloading` 记录进度；`ready` 置 `nativeTtsReady=true` 并上报能力；
- `error` 置 `false` 并上报能力，等待下次下载

### 6. 服务器改动

- 配置：`tts.device`（`server` / `display`），默认 `server`
- API：`GET/POST /api/config/ttsDevice`
- 配置：`cpuAffinity`（`asr/tts` 各自的 `bigCoreCount/littleCoreCount/preferBigCores`），默认数量均为 `1/1`、开关均为 `false`
- API：`GET/POST /api/config/cpuAffinity`
- 模型下载：`GET /api/tts/model-manifest`、`GET /api/tts/model/:filename`（白名单防路径穿越）
- 路由：`findDisplayWithTts()` 找到在线且有 `ttsGeneration` 的显示端
- 生成：`sendTtsGenerateToDisplay()` 等待 `ttsResult`，60s 超时
- 开始确认：显示端接受任务后先回 `ttsGenerating`；服务端 3s 未收到则判定失败并回退
- 路由：所有服务端 TTS 入口统一调用 `generateTtsWithFallback()`；仅该函数的最终回退分支允许调用 `tts.generateTTS()`
- 回退：`generateTtsWithFallback()` 显示端失败 / 离线 / 错误时回退 `tts.generateTTS()`
- 注入：TaskManager 将统一生成函数注入内置任务，整点报时不再直接依赖底层 TTS 服务
- 能力：显示端 actor 与地图 actor 新增 `voice-generation`（语音生成）
- CPU 契约：`GET /api/config/cpuAffinity` 返回规范化配置；`POST /api/config/cpuAffinity` 只接受非负整数，且 `asr/tts` 每个引擎自身都至少保留 1 个槽位；缺失字段回填默认值，保存后广播 `cpuAffinityChanged` 给控制端、广播 `cpuConfig` 给显示端
- 初始化：显示端首次连接时同步收到 `cpuConfig`；旧版 APK/浏览器忽略未知消息，不影响现有 TTS/ASR 流程

### 7. 控制端改动

- `tts.js` 新增 `TtsDevice`（仿照 `AsrDevice`）：`init/setDevice/updateUI/handleDeviceChanged`
- `upload.html` 新增“语音生成设备”按钮组与状态文案
- `websocket.js` 处理 `ttsDeviceChanged`；显示端列表刷新时更新 `TtsDevice`
- `main.js` 初始化 `TtsDevice`
- `display-list.js` / `device-list.js` / `device-tree.js` 增加 `ttsGeneration` 能力图标与编辑器

## 数据流（显示端生成）

1. 控制端选择“显示端” → `POST /api/config/ttsDevice{device:'display'}`
2. 服务器广播 `ttsDeviceChanged` 给控制端，下发 `ttsConfig{localTtsEnabled:true}` 给显示端
3. 显示端检测 / 下载模型，就绪后上报 `ttsGeneration=true`
4. 任一服务端 TTS 入口发起生成，服务器 `generateTtsWithFallback()` 选中有 `ttsGeneration` 的显示端
5. 服务器发 `ttsGenerate{text, requestId}` → 显示端 3s 内回 `ttsGenerating`
6. 显示端异步合成 base64 WAV → 回 `ttsResult`
7. 服务器把 WAV 写入 `res/uploads/tts/*.wav`，返回音频 URL 播放

## 错误处理

| 场景 | 行为 |
|------|------|
| 无在线且启用语音生成的显示端 | 回退服务端 `tts.generateTTS()` |
| 显示端模型下载中 / 合成失败 | 回 `ttsResult{error}`，服务器回退服务端 |
| 显示端离线或 60s 超时 | 回退服务端 |
| 3s 内未收到 `ttsGenerating` | 判定显示端未接受任务，回退服务端 |
| 模型 hash 不匹配 / 文件损坏 | 删除损坏文件，重新下载 |
| 低端机内存不足 | 返回 `error`，不硬加载防 OOM |
| `tts.device=server` | 直接走服务端 TTS，显示端合成引擎闲置 |
| `cpuAffinity` 含负数、小数、非法类型或任一引擎为 `0/0` | 服务器 `POST /api/config/cpuAffinity` 返回 400，不保存旧配置 |
| `cpuAffinity` 缺失字段、旧配置残缺或任一引擎存量为 `0/0` | 服务器按该引擎默认 `1 大核 + 1 小核` 规范化后返回/广播 |

## 兼容性

- 浏览器访问 display.html：无 `NativeDisplay`，`ttsGeneration=false`，行为不变
- 旧版 APK + 新服务器：无 TTS 桥，能力 `false`，回退 `tts.device=server`
- 新版 APK + 旧服务器：无模型接口，下载失败报 `error`，显示端生成不可用但服务端 TTS 不受影响
- 嵌入式 SDK 仅支持 `arm64-v8a`，新 APK 只打包该 ABI

## 性能预期

- 首次使用需下载约 75MB 模型（Xiaoxiao 嵌入式模型）
- 模型就绪后本地合成：普通短句亚秒级返回，无需外网
- WAV 输出 `Riff24Khz16BitMonoPcm`（24kHz 16bit 单声道）
- APK 安装包不含模型，体积增量主要来自嵌入式 SDK AAR

## 自测方案

1. `node --check` 检查服务器与全部控制端 JS
2. `sha256sum` 与 `manifest.json` 比对模型文件
3. `curl /api/tts/model-manifest` 与 `/api/tts/model/:filename` 校验 Content-Length
4. `curl -X POST /api/config/ttsDevice{device:'display'}` 校验配置与广播
5. 真机：装 APK → 开启显示端语音生成 → 观察模型下载进度上屏 → 就绪后上报 `ttsGeneration=true`
6. 真机：控制端选“显示端”播报 → 显示端离线时确认自动回退服务端
7. 控制端选“服务端” → 显示端不参与合成，能力不上报

## 真机验证记录

- 设备：SM-N9500（Android 9 / API 28 / arm64-v8a）
- APK：使用 `/home/as/.config/.android/debug.keystore` 重签名后覆盖安装，`lastUpdateTime=2026-08-25 13:49:19`
- 模型：真机下载完整 TTS 模型到 `files/models/tts`，`hashes.json` 与服务器 manifest 一致
- 引擎：`TtsEngine` 加载 `Microsoft Xiaoxiao (Natural) - Chinese (Simplified, China)`
- 能力：`/api/actors` 中显示端 `display-ec4p3r2z` 上报 `voice-generation`
- 生成：`POST /api/tts/generate` 路由到显示端，服务器日志 `显示端生成成功 (displayId=display-ec4p3r2z bytes=170446)`；WAV 为 24kHz/16bit/单声道 PCM

## 2026-08-25 重复播放修复验证

- 根因确认：SDK 单参数 `SpeechSynthesizer(config)` 会调用默认扬声器输出，`getAudioData()` 又把同一段 WAV 回传服务器，形成两次播放。
- 修复：主合成器和声线探测器均使用 `SpeechSynthesizer(config, null)`，原生生成阶段不播放，只返回音频数据。
- 线程确认：Task 4 final fix 后 `NativeBridge.ttsExecutor` 为按当前 TTS policy 派生的 `TtsBridgeDispatcher`，固定 `slotCount` worker 和同等容量队列；TtsEnginePool 公平 Semaphore 作为额外保护，异步入口仅对成功提交任务立即返回，60 秒监控由独立调度器处理。
- 验证：Android unit tests、`assembleDebug`、`npm run upload:apk` 均成功；APK 已安装并运行在 `192.168.1.6:5555` 的 display2；端到端 TTS 成功返回 24kHz/16bit/mono WAV。
- 100 字串行压测：当前 APK 连续生成 10 次，成功 10/10；平均单次 3562.5ms，最大 4620ms，总耗时 35687ms；10 个返回音频 URL 均唯一，未发生超时。

## 2026-08-26 TTS 并发池验证

- `TtsEnginePool` 按 TTS `CpuPolicy.totalCoreCount` 建立 `max(1, totalCoreCount)` 个独立 silent synthesizer slot，并用公平 `Semaphore(slotCount * 2)` 显式限制 `slotCount` 个活跃 + `slotCount` 个排队请求；超额请求抛出 `RejectedExecutionException("TTS 请求过多，请稍后重试")`，准入 permit 在 `finally` 中释放。
- `NativeBridge` 增加 `TtsBridgeDispatcher`，固定 `max(1, policy.totalCoreCount)` 个桥 worker 和同等容量有界队列；同步/异步入口在提交时确定溢出结果，TTS policy 成功配置后在锁内换代，旧 executor `shutdown()` 排空而不打断已提交任务。
- `TtsEngine` 保持 `load/synthesize/release/ready` 公开接口，内部用 pool 安全替换；旧 pool retire 后继续服务已 retain 的 in-flight/queued 请求。
- `NativeBridge.cpuConfigure()` 同时返回并应用 `asr` 与 `tts` policy；同步和异步 TTS 桥路径都通过 pool，60 秒超时和旧 APK 同步 fallback 保持不变。
- focused JVM 测试覆盖两槽并发上限、显式 overflow 拒绝、WAV 返回、静音构造契约、`probeVoice()` 资源关闭约束、affinity false 非致命、retired 旧池继续服务已排队请求；`npm run build:apk` 完成。

## 2026-08-26 APK TTS 生成页面卡顿修复

### ADB 证据与根因

- `logcat` 未发现 `ANR` 或显示进程崩溃，但显示 WebView 持续收到 `ttsGenerate` 和重复 `cpuConfig`，说明问题是主线程长时间阻塞与请求堆积，而不是立即崩溃。
- 显示端原先在 WebSocket 消息处理函数中同步调用 `NativeDisplay.cpuConfigure()`；原生桥随后同步探测拓扑、应用 ASR/TTS policy 并重建 pool。
- 日志采样期间 APK 出现多个 `aasc-tts-slot-*` 线程且进程 RSS 明显上涨。重复相同 policy 也会重新创建 `SpeechSynthesizer`/recognizer pool，放大 TTS 生成期间的资源压力。
- `voiceprintConfigure()` 的模型回调从后台线程直接调用 `WebView.evaluateJavascript()`，同时存在 WebView thread warning，需要一并修正。

### 修复目标与边界

1. `display.html` 的 `cpuConfig` 消费只调用立即返回的 `cpuConfigureAsync()`，不再在 WebSocket 主线程中等待 CPU 配置。
2. 页面按规范化 `{asr, tts}` 配置去重；原生侧串行应用并只保留最新待处理配置，避免广播风暴形成配置任务队列。
3. ASR/TTS policy 与当前 policy 相等时直接复用现有 pool，不重新创建 native slot。
4. 所有声纹模型完成回调统一通过 `mainHandler.post` 调用 WebView；不改变 TTS `ttsGenerating`/`ttsResult` 协议。
5. 浏览器显示端和不具备新异步桥的旧 APK 安全忽略 CPU 配置，不回退到同步 CPU 配置调用。

### 部署验证

- APK 使用 `/home/as/.config/.android/debug.keystore` 重新签名后，通过 `adb push` + `pm install -r` 覆盖安装，保留应用数据。
- 设备 `192.168.1.6:5555` 的 `com.aasc.display` 进程 PID `18703` 存活，`MainActivity` 已在 display 2 前台运行；启动日志持续收到 `task:renderUpdate`，未出现启动崩溃。
- 当前运行配置已调整为 ASR `2 大核 + 0 小核`、TTS `2 大核 + 0 小核`；服务器 API 返回该配置，显示端通过 `cpuConfig` 后台应用。

## 2026-08-25 TTS 生成与内存稳定性复核

- 真机端到端：SM-N9500（Android 9 / API 28 / arm64-v8a）连续 8 次 `POST /api/tts/generate` 全部成功，单次耗时约 3--4 秒；每次均收到 `ttsGenerate` 并生成 WAV。
- 音频产物：抽样 WAV 经 `file`/`ffprobe` 核验为 RIFF PCM、24kHz、16bit、单声道，服务器日志记录 `ttsResult` 与 `显示端生成成功`。
- 缓存复用：设备 `files/models/tts/hashes.json` 与服务器 manifest 一致；APK 重启后仍加载 Xiaoxiao 声线并重新上报 `voice-generation`，未观察到模型损坏或重复下载失败。
- 回退：停止支持语音生成的显示端后，服务器仍成功返回 TTS 音频，日志记录“无在线支持 TTS 的显示端，回退服务端”；测试结束后已重新启动 APK。
- 内存：压测期间应用 PSS 约从 396.9MB 上升到 404.2MB，Native Heap 约从 156.2MB 上升到 157.6MB；静置 30 秒后稳定在 PSS 约 402--403MB、Native Heap 约 156.6MB。重启后的完整加载阶段稳定在 PSS 约 355--360MB、Native Heap 约 149.7MB，未见 OOM 或进程重启。
- 环境限制：Android 单元测试首次执行因 `/tmp` 临时目录配额失败，切换 `JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=/mnt/AASC/tmp` 后 36 项全部通过；APK `assembleDebug` 单独执行成功。浏览器原生桥回归需同样切换临时目录，桥截图与无桥回归通过，但既有 `injectTouch` 断言仍失败，与 TTS 无关。

## 2026-08-26 集成验证记录（Task 6）

- Node 集成回归 22/22 通过；Android JVM 单测、`assembleDebug`、`npm run upload:apk` 均通过。
- APK 已安装并运行在 `192.168.1.6:5555` 的 display2；进程 PID 9959 存活，设备拓扑为 CPU 0--3 little、CPU 4--7 big。
- 默认 TTS `1 大核 + 1 小核` 下，3 个同时提交的真机请求均收到 `ttsGenerating` 和 `ttsResult`，未出现失败、超时或重复播放错误；两个请求可并行，额外请求由有界队列承接。
- 本轮未重新采集 PSS/native heap；此前 100 字压测的内存结果继续作为基线。logcat 未输出显式 `cpuConfig` 应用日志，不能据此宣称 affinity syscall 已成功。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/apps/android-display/app/build.gradle.kts` | 新增 Embedded Speech SDK AAR、`azure-core`、`arm64-v8a`、`minSdk=26` |
| `.../TtsEngine.kt`（新增） | Embedded Speech SDK 合成封装（Xiaoxiao），当前通过 TTS pool 管理加载、合成和释放 |
| `.../TtsEnginePool.kt`（新增） | TTS 大小核并发池，单槽独立 silent synthesizer + 单线程 worker |
| `.../TtsModelFiles.kt`（新增） | 模型文件清单与完整性校验 |
| `.../TtsModelManager.kt`（新增） | 模型下载/校验/加载/状态机 |
| `.../NativeBridge.kt` | 新增 `ttsStatus`/`ttsEnsureModel`/`ttsSynthesize` |
| `src/apps/server/boot/server-app.js` | 模型下载接口、ttsDevice 配置、显示端生成与回退、能力 |
| `src/apps/server/modules/config/config-app-service.js` | 默认 `tts.device='server'`，并提供 CPU affinity 默认值、规范化、校验和广播消息构造 |
| `src/apps/web-mediacenter/ui/public/display.html` | ttsConfig/ttsGenerate 处理、能力上报、模型下载 |
| `.../js/tts.js` | 新增 `TtsDevice` |
| `.../upload.html` | 语音生成设备按钮组 |
| `.../js/websocket.js` / `main.js` | `ttsDeviceChanged` 处理与初始化 |
| `.../js/display-list.js` / `device-list.js` / `device-tree.js` | `ttsGeneration` 能力展示 |
| `res/models/tts/`（新增） | Xiaoxiao 嵌入式模型 14 个文件 + `manifest.json` |
