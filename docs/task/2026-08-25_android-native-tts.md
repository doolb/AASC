# 任务：Android 原生语音生成（TTS）

## 任务描述

给当前 APK 添加 Android 原生语音生成功能，并记录到显示端能力。控制端加入“语音生成设备”选项，可选服务器或显示端；显示端离线时临时回退服务器。模型从服务器下载，暂时只支持一个内置声线 xiaoxiao。

## Design 需求

见 `docs/design/android-native-tts.md`。

## Spec 设计

见 `docs/spec/android-native-tts.md`。

## 受影响功能模块与代码

- Android APK：`NativeBridge.kt`、`TtsEngine.kt`、`TtsModelFiles.kt`、`TtsModelManager.kt`、`build.gradle.kts`。
- 服务器：`server-app.js`、`config-app-service.js`、模型资源 `res/models/tts/`。
- 显示端：`display.html`。
- 控制端：`tts.js`、`upload.html`、`websocket.js`、`main.js`。
- 能力展示：`display-list.js`、`device-list.js`、`device-tree.js`。

## 自测用例

1. APK 检测到 `NativeDisplay.ttsStatus`，display.html 声明 `ttsGeneration` 能力。
2. 服务端选“显示端”且模型未就绪时自动触发模型下载，进度经 `onNativeTtsModel` 上屏。
3. 模型就绪后经 `ttsSynthesize` 合成 base64 WAV，服务器写 `res/uploads/tts/` 并返回音频 URL。
4. 显示端离线 / 模型下载中 / 合成失败时服务器回退 `tts.generateTTS()`。
5. 控制端切换设备后，按钮高亮、状态文案与可用显示端数量正确更新，其他控制端收到 `ttsDeviceChanged`。
6. `tts.device=server` 时显示端不上报语音生成能力，合成全走服务端。

## 兼容性测试

- 浏览器访问 display.html：无原生桥，行为不变，`ttsGeneration=false`。
- 旧版 APK + 新服务器：无 TTS 桥，回退服务端。
- 新版 APK + 旧服务器：无模型接口，显示端生成不可用但服务端 TTS 不受影响。
- Embedded SDK 仅支持 `arm64-v8a`，新 APK 只打包该 ABI。
- Embedded SDK 依赖 `azure-core 1.58.1`（使用 `MethodHandle`），APK `minSdk` 调整为 26（Android 8.0+）。

## 性能测试

- 首次模型下载约 75MB，下载完成后本地缓存复用，重启不重复下载。
- 模型就绪后短句本地合成亚秒级返回，不依赖外网 TTS。
- 显示端生成串行执行，避免 SDK 并发问题；服务器 60s 超时防挂起。

## 风险评估

- SDK 仅支持 arm64-v8a，需确认目标设备架构。
- 模型下载依赖服务器可用；失败时按需重下，已有缓存通过本地 hash 复用。
- 显示端生成超时会阻塞播报，服务器已设置超时并回退服务端。
- 首次下载期间播报回退服务端，保证功能不中断。

## 预计工时

约 1 个工作日，包含 SDK 集成、模型下载、服务器回退、能力展示与文档。

## 执行记录

- 2026-08-25 已完成主体实现：
  - Android：新增 Embedded Speech SDK 依赖与 `TtsEngine`、`TtsModelFiles`、`TtsModelManager`，`NativeBridge` 增加 `ttsStatus`/`ttsEnsureModel`/`ttsSynthesize`。
  - 服务器：新增模型清单与文件下载接口、`ttsDevice` 配置、`findDisplayWithTts`/`sendTtsGenerateToDisplay`/`generateTtsWithFallback`、`voice-generation` 能力。
  - 显示端：`display.html` 增加 `ttsConfig`/`ttsGenerate` 处理、能力上报与模型下载。
  - 控制端：`tts.js` 新增 `TtsDevice`，`upload.html` 新增按钮组，`websocket.js`/`main.js` 接入，三个列表组件增加 `ttsGeneration` 展示。
  - 模型资源：`res/models/tts/` 放置 Xiaoxiao 嵌入式模型 14 个文件及 `manifest.json`。
- 验证：相关 JS 文件 `node --check` 通过，模型文件 `sha256sum` 与 `manifest.json` 一致；Android 构建与真机链路按环境情况补充。
- 2026-08-25 真机验证完成（SM-N9500 / Android 9 / arm64-v8a）：
  - `app-debug.apk` 重新构建成功，包含 `TtsEngine`/`TtsModelManager`、Embedded Speech SDK arm64 库；`minSdk` 调整到 26，使用原 debug keystore 重签名后覆盖安装。
  - 显示端连接新版服务器后下载完整 TTS 模型（`files/models/tts`，含 `hashes.json`）；`TtsEngine` 日志显示 Xiaoxiao 声线加载成功。
  - `/api/actors` 中真机显示端上报 `voice-generation`，对应 `ttsGeneration=true`。
  - `POST /api/tts/generate` 在 `ttsDevice=display` 下路由到真机，服务器日志 `显示端生成成功 (displayId=display-ec4p3r2z bytes=170446)`；生成 WAV 为 24kHz/16bit/单声道 PCM。

## 2026-08-25 复核执行记录：APK TTS、真机与内存稳定性

### 任务描述

- 检查当前 APK 是否可构建、是否能在真机完成原生 TTS 生成，并观察连续合成后的进程内存稳定性。
- 检查显示端离线时服务端回退，保留设备与服务器状态。

### 受影响模块与代码

- 只读验证：Android APK、`TtsEngine`/`TtsModelManager`、服务器 TTS 路由、显示端 WebSocket 协议。
- 本次未修改功能代码；仅补充本文档、设计文档、spec 文档、`docs/todo.md` 和 `changelog.md` 的验证记录。

### 自测用例

- APK：`assembleDebug` 成功；Android unit tests 使用工作区临时目录后 36/36 通过。
- 模型：服务器 manifest 与设备 `hashes.json` 一致；重启后 Xiaoxiao 声线加载并恢复 `voice-generation`。
- 生成：8/8 次真机合成成功；WAV 为 24kHz/16bit/单声道 PCM。
- 回退：停止支持生成的显示端后，服务端 TTS 请求成功，日志确认回退服务端；随后恢复 APK。
- 内存：压测 PSS 约 396.9MB → 404.2MB，Native Heap 约 156.2MB → 157.6MB；静置 30 秒后 Native Heap 约 156.6MB。重启并完成声纹/TTS 模型加载后，追加 30 秒静置采样为 PSS 约 355--360MB、Native Heap 约 149.7MB，未见 OOM/崩溃。

### 兼容性测试

- SM-N9500 / Android 9 / API 28 / arm64-v8a：通过。
- 浏览器原生桥测试需设置 `TMPDIR=/mnt/AASC/tmp`；无桥回归通过，桥截图通过，但已有 `injectTouch` 断言失败，未归因于 TTS。

### 性能测试

- 真机短句合成单次约 3--4 秒；连续 8 次均成功。
- 重启后进程 PSS 约 303--311MB，Native Heap 约 118--123MB。

### 风险评估

- 当前结果支持短时稳定性，不等价于数小时或数百次长文本 soak test；建议后续按固定文本和阈值补充长压测。
- `/tmp` 仅剩约 783MB，历史进程仍持有大型已删除日志；不清理它们会继续影响构建/浏览器测试，清理需单独授权。
- 工作区源码 `app-debug.apk` 与已签名上传/设备 APK 的 SHA-256 不同；本次真机结果对应设备实际安装包（`0b50a35a...`），交付前应统一构建、签名和发布产物链路。
