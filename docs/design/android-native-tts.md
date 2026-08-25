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
                                    └─ ttsResult ─► 写临时 wav → 播放
                                    回退：显示端失败 → 服务端 generateTTS
```

## 组件设计

### 1. TtsEngine（新增 Kotlin 单例）

Embedded Speech SDK 的 `SpeechSynthesizer` 封装。

- 加载：`EmbeddedSpeechConfig.fromPath(modelDir)`，输出格式 `Riff24Khz16BitMonoPcm`
- 声线：`probeVoice()` 从模型声线列表中优先选择包含 `Xiaoxiao` 的声线，找不到则取第一个
- 授权：嵌入式语音密钥与参考 POC 一致，模型内置授权
- 合成：`SpeakText(text)` 返回 WAV 字节；`synchronized(this)` 串行，防止与重载并发
- 释放：`release()` 关闭合成器并置 `ready=false`

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
ttsSynthesize(text): String # 同步合成，返回 {"audio":"<base64 wav>"} 或 {"error":"..."}，阻塞最多 30s
```

`serverBaseUrl()` 复用主线程缓存的服务器 origin，避免 JavaBridge 线程跨线程访问 `WebView.url`。

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
- 就绪 → `ttsSynthesize(text)` → 回 `ttsResult{audioData:base64}`

**5.4 onNativeTtsModel 回调**
- `downloading` 记录进度；`ready` 置 `nativeTtsReady=true` 并上报能力；
- `error` 置 `false` 并上报能力，等待下次下载

### 6. 服务器改动

- 配置：`tts.device`（`server` / `display`），默认 `server`
- API：`GET/POST /api/config/ttsDevice`
- 模型下载：`GET /api/tts/model-manifest`、`GET /api/tts/model/:filename`（白名单防路径穿越）
- 路由：`findDisplayWithTts()` 找到在线且有 `ttsGeneration` 的显示端
- 生成：`sendTtsGenerateToDisplay()` 等待 `ttsResult`，60s 超时
- 回退：`generateTtsWithFallback()` 显示端失败 / 离线 / 错误时回退 `tts.generateTTS()`
- 能力：显示端 actor 与地图 actor 新增 `voice-generation`（语音生成）

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
4. 控制端发起播报，服务器 `generateTtsWithFallback()` 选中有 `ttsGeneration` 的显示端
5. 服务器发 `ttsGenerate{text, requestId}` → 显示端合成 base64 WAV → 回 `ttsResult`
6. 服务器把 WAV 写入 `res/uploads/tts/*.wav`，返回音频 URL 播放

## 错误处理

| 场景 | 行为 |
|------|------|
| 无在线且启用语音生成的显示端 | 回退服务端 `tts.generateTTS()` |
| 显示端模型下载中 / 合成失败 | 回 `ttsResult{error}`，服务器回退服务端 |
| 显示端离线或 60s 超时 | 回退服务端 |
| 模型 hash 不匹配 / 文件损坏 | 删除损坏文件，重新下载 |
| 低端机内存不足 | 返回 `error`，不硬加载防 OOM |
| `tts.device=server` | 直接走服务端 TTS，显示端合成引擎闲置 |

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

## 2026-08-25 TTS 生成与内存稳定性复核

- 真机端到端：SM-N9500（Android 9 / API 28 / arm64-v8a）连续 8 次 `POST /api/tts/generate` 全部成功，单次耗时约 3--4 秒；每次均收到 `ttsGenerate` 并生成 WAV。
- 音频产物：抽样 WAV 经 `file`/`ffprobe` 核验为 RIFF PCM、24kHz、16bit、单声道，服务器日志记录 `ttsResult` 与 `显示端生成成功`。
- 缓存复用：设备 `files/models/tts/hashes.json` 与服务器 manifest 一致；APK 重启后仍加载 Xiaoxiao 声线并重新上报 `voice-generation`，未观察到模型损坏或重复下载失败。
- 回退：停止支持语音生成的显示端后，服务器仍成功返回 TTS 音频，日志记录“无在线支持 TTS 的显示端，回退服务端”；测试结束后已重新启动 APK。
- 内存：压测期间应用 PSS 约从 396.9MB 上升到 404.2MB，Native Heap 约从 156.2MB 上升到 157.6MB；静置 30 秒后稳定在 PSS 约 402--403MB、Native Heap 约 156.6MB。重启后的完整加载阶段稳定在 PSS 约 355--360MB、Native Heap 约 149.7MB，未见 OOM 或进程重启。
- 环境限制：Android 单元测试首次执行因 `/tmp` 临时目录配额失败，切换 `JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=/mnt/AASC/tmp` 后 36 项全部通过；APK `assembleDebug` 单独执行成功。浏览器原生桥回归需同样切换临时目录，桥截图与无桥回归通过，但既有 `injectTouch` 断言仍失败，与 TTS 无关。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/apps/android-display/app/build.gradle.kts` | 新增 Embedded Speech SDK AAR、`azure-core`、`arm64-v8a`、`minSdk=26` |
| `.../TtsEngine.kt`（新增） | Embedded Speech SDK 合成封装（Xiaoxiao） |
| `.../TtsModelFiles.kt`（新增） | 模型文件清单与完整性校验 |
| `.../TtsModelManager.kt`（新增） | 模型下载/校验/加载/状态机 |
| `.../NativeBridge.kt` | 新增 `ttsStatus`/`ttsEnsureModel`/`ttsSynthesize` |
| `src/apps/server/boot/server-app.js` | 模型下载接口、ttsDevice 配置、显示端生成与回退、能力 |
| `src/apps/server/modules/config/config-app-service.js` | 默认 `tts.device='server'` |
| `src/apps/web-mediacenter/ui/public/display.html` | ttsConfig/ttsGenerate 处理、能力上报、模型下载 |
| `.../js/tts.js` | 新增 `TtsDevice` |
| `.../upload.html` | 语音生成设备按钮组 |
| `.../js/websocket.js` / `main.js` | `ttsDeviceChanged` 处理与初始化 |
| `.../js/display-list.js` / `device-list.js` / `device-tree.js` | `ttsGeneration` 能力展示 |
| `res/models/tts/`（新增） | Xiaoxiao 嵌入式模型 14 个文件 + `manifest.json` |
