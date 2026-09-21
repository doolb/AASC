# 2026-09-20 ASR 测试 APK 仅保留 base FP32

## 任务描述

测试 APK 暂时不打包全部声纹 embedding 模型，只保留 `ERes2Net-base FP32`；多人分段仍保留共用的 Pyannote segmentation 模型，以便优先进行蓝牙录音链路验证并减少安装包体积。

## design 需求

- Gradle 声纹资源白名单只包含 base FP32 和 Pyannote segmentation。
- 原生页面、内置网页和 HTTP 状态/切换接口只暴露 base + FP32。
- large、V2 和 INT8 请求明确返回 400，不从 APK 外部寻找缺失文件。
- 不改变正式 APK 和服务器侧模型资源。

## spec 设计

- `VoiceprintModel.values() = [ERES2NET_BASE]`。
- `VoiceprintPrecision.values() = [FP32]`。
- `VoiceprintModelFiles.ALL_FILE_NAMES` 只包含两个 ONNX 文件。
- 页面选择器和 HTTP `models` 状态跟随枚举自动收敛。

## 受影响的功能模块和代码

- `3rd/tts-server/android-asr/app/build.gradle.kts`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintModel.kt`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrWebPage.kt`
- `3rd/tts-server/android-asr/app/src/main/res/values/strings.xml`
- Android 单测、Node 静态契约测试及 ASR design/spec/usage 文档

## 自测用例

- `npm --prefix 3rd/tts-server run build:android-asr`
- `./gradlew -p 3rd/tts-server/android-asr :app:testDebugUnitTest`
- `node --test tests/android-asr-apk.test.js`
- 检查 APK `assets/voiceprint/` 只含 base FP32 和 Pyannote 文件。
- 安装到 SM-N9500，确认页面只显示 base/FP32，保留蓝牙输入选择和录音测试。

## 兼容性测试

- Android 9/API 28、arm64-v8a、SM-N9500。
- 既有 base FP32 声纹注册、单段和多人分段流程。
- 旧客户端缺省 precision 仍解析为 FP32；移除的模型/精度返回 400。

## 性能测试

- 对比 APK 安装包大小和 `assets/voiceprint` 资源大小。
- 启动加载 base FP32，确认不因缺少 large/V2/INT8 资源崩溃或误报模型未就绪。

## 风险评估

- 历史模型对比页面不再适用于当前测试 APK，但历史 design/spec 验收记录保留。
- 若后续恢复 A/B 对比，必须同时恢复资源白名单、枚举、页面选项、HTTP 校验和测试。
- Pyannote 文件继续保留，删除它会破坏多人分段测试。

## 预计工时

- 0.5 小时，包含构建、资源清单检查和真机安装。

## 执行结果

- 已完成 base FP32 + Pyannote 资源收敛，旧构建遗留模型不会继续进入 APK。
- `npm --prefix 3rd/tts-server run build:android-asr`、Android JVM 单测 `29/29`、Node 契约测试 `3/3` 均通过。
- APK 大小为 `503,520,540 bytes`，SHA-256 为 `3320ac65eb5df2e264211260ef828ddae21471d42da4face2365c5cff9e1a727`，已覆盖安装到 `SM-N9500 / 192.168.1.6:5555`。
- 蓝牙设备 ID 922 和内置主麦克风 ID 10 已完成现场录音验证；本任务完成。
