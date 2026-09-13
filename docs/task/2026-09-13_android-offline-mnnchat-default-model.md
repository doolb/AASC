# Android offline APK 内置并默认加载 MNNChat 模型

## 任务描述

当前 APK 已具备 MNNChat 模型能力。本任务为 offline APK 重新打包并内置
`qwen3.5-0.8b-claude-opus-distilled-mnn`，在没有历史模型选择时将其设为默认模型。
模型随 offline 构建进入 APK assets，由 `NodeRuntimeInstaller` 安装到应用私有目录后直接加载；
不再把 bundled 模型复制到在线下载使用的 `filesDir/models/llm/active`。

## Design 需求

- 在线 APK 保持“没有默认模型，用户选择后下载”的行为。
- offline APK 内置固定模型及其清单、校验信息，默认模型 ID 为
  `qwen3.5-0.8b-claude-opus-distilled-mnn`。
- 仅允许 APK assets 到 `filesDir/aasc-server/res/models/llm` 的一次安装解压；
  MNN native 使用该真实可写目录和其 `.mmap` 子目录。
- 已有用户选择优先，不因新增默认逻辑覆盖已保存的其他模型选择。
- bundled 模型校验失败时走既有错误状态，不加载半成品；在线模型仍使用原有服务器下载、校验和原子切换流程。

## Spec 设计

1. 扩展 offline 模型白名单，加入顶层 `manifest.json`、Qwen 模型 marker 和 9 个运行文件；marker 以 `bundled-manifest.json` 进入 APK，安装后恢复为 `.manifest.json`。
2. `NativeBridge` 根据 offline 构建标记注入 bundled 模型配置，并在状态查询时触发默认模型排队。
3. `MnnLlmModelManager` 校验安装后的 bundled 目录，直接把该目录传给 `MnnLlmEngine.load`；仅在线模型调用 `RemoteModelManager`。
4. 默认模型加载完成后持久化模型 ID、revision 和 ready 状态，后续重启沿用已有状态。
5. 使用 Node 定向测试、Android 静态契约测试、offline 构建和 APK 内容检查验证。

## 受影响的功能模块和代码

- `scripts/ops/prepare-android-node-runtime.js`：offline 模型文件白名单。
- `src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt`：bundled 模型校验、默认选择和直接加载。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`：offline 配置和默认模型触发。
- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`：向 bridge 传递 offline 模式。
- `tests/android-node-runtime-package.test.js`、`tests/android-offline-apk.test.js`：打包及运行契约。
- `docs/design/android-mnnchat-llm.md`、`docs/spec/android-mnnchat-llm.md`、`docs/todo.md`、`changelog.md`：项目文档同步。

## 自测用例

- offline runtime manifest 包含 Qwen 模型所有文件，且输出路径位于 `server/res/models/llm`。
- offline APK 的模型状态逻辑包含固定默认模型 ID，并直接加载 `aasc-server/res/models/llm`。
- 已保存其他模型选择时不自动覆盖。
- bundled 文件缺失、大小或 SHA-256 不匹配时拒绝加载并保留错误状态。
- 在线模型选择仍调用远端缓存下载流程。
- offline Gradle 构建完成，APK 中可列出 manifest、marker 和全部模型文件。

## 兼容性测试

- 在线 debug APK：保持既有模型选择和下载行为。
- offline debug APK：保持 Android 8/API 26、`arm64-v8a` 和 16 KB page-size 约束。
- 已有 state.json：不覆盖用户已选择的非默认模型。
- 首次安装或无模型状态：自动加载固定 Qwen 模型。

## 性能测试

- 对比 bundled 模型首次加载不产生 `filesDir/models/llm/active` 第二份模型副本。
- 记录 APK 体积及 offline runtime 模型字节数，确认只发生一次 assets 安装解压。
- 保持在线模型原有 staging 下载和校验性能。

## 风险评估

- 模型约 519 MiB，offline APK 体积显著增加，构建和安装耗时上升。
- Android assets 若被压缩，仍需由安装器解压为真实文件；当前 MNN JNI 不能直接接收 APK asset 描述符。
- bundled 模型目录校验失败时不能误报 ready；必须允许用户看到结构化错误并保留在线模型路径。

## 预计工时

约 2 小时，包含代码、文档、定向测试、offline APK 构建和 APK 内容核验。

## 执行结果

- 已完成 offline 模型白名单、默认模型配置、bundled marker 安装恢复和直接加载路径实现。
- 已生成服务器发布包：`res/temp/aasc-server-release/aasc-server-1.0.0.tar.gz`。
- 已生成 APK：`src/apps/android-display/app/build/outputs/apk/offline/aasc-display-offline.apk`，包名为 `com.aasc.display.offline`，版本为 `0.1.0-offline`。
- APK 内模型记录 43 个、共 `995405414` bytes；Qwen 9 个运行文件逐项 SHA-256 与 `res/models/llm` 源文件一致，顶层清单和 `bundled-manifest.json` 均已打包。
- 验证结果：offline APK 契约 6/6、Runtime 打包 15/15、Node 全量回归 695/695、Gradle `assembleDebug` 成功。

## 真机安装与语音验收

- 最终 APK：`src/apps/android-display/app/build/outputs/apk/offline/aasc-display-offline.apk`。
- 最终 APK SHA-256：`0fab668905863d5c58a0ddf7f841adad31c79ba4283cfd71814b969c84752e83`；大小 `1059391417` bytes。
- 已安装到 `192.168.1.6:5555`（Samsung SM-N9500，Android 9/API 28），并用 `--display 2 --windowingMode 1` 启动；窗口实际为 `1920x1080` 全屏，display 2 保持在线。
- offline runtime 首次安装包含生产依赖 `express`、`ws`、`multer`；Node 子服务器启动、HTTPS `/display` 和 `/control` 均返回 HTTP 200。
- MNNChat 状态为 `ready`，默认模型为 `qwen3.5-0.8b-claude-opus-distilled-mnn`，revision 为 `c1bc31b15286afa708f37f690099d10f21d1cc74`；已完成一次真实 MNN 推理并收到 `llm.completed`。
- ASR 真机复测：上传 `res/models/sensevoice/test_wavs/你好，小爱.wav`，服务端路由到 display 2 的原生 ASR，HTTP 200，识别为“你好，小爱。”，返回 `asrElapsedMs` 和 `voiceprintElapsedMs`。
- TTS 真机复测：`/api/tts/generate` 走 display 2 原生 TTS，HTTP 200，生成可读取的 `audio/wav`（最近一次 `141046` bytes）；另发送 `tts play`，日志收到“播放TTS”和 `TTS 当前句完成: ended`。
- 相关定向测试 30/30 通过；完整 `npm test` 为 716 项通过 715 项、1 项失败，失败为既有 `node-display-voice-text-input.test.js` 本地策略契约，与本任务无关。
