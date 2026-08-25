# 独立 Android 离线 TTS APK

## 任务描述

在 `3rd/tts-server` 目录下新增独立 Android TTS APK。APK 打开后提供文本框和生成按钮，使用 APK 内置的 Xiaoxiao 模型离线生成并播放语音。

## Design 需求

- 复用 Microsoft Embedded Speech SDK 1.51.2。
- 内置 `3rd/tts-server/models/extracted` 中的 14 个模型文件。
- 固定 Xiaoxiao 中文声线，生成 WAV 后自动播放。
- 不访问服务器，不需要网络权限。
- 支持 Android 8.0+、`arm64-v8a`。

## Spec 设计

- `TtsTextPolicy` 负责去除首尾空白、拒绝空文本、限制 2000 字符。
- `TtsModelFiles` 负责将 APK assets 中的模型安全复制到应用私有目录。
- `TtsEngine` 负责 Embedded Speech SDK 初始化、声线选择、同步合成和释放。
- `TtsEngine` 的合成器和声线探测器必须使用 `SpeechSynthesizer(config, null)`，禁止隐式默认扬声器输出。
- 生成完成后显示 SDK 合成阶段耗时，格式为“生成完成，用时 X.XX 秒”，不包含模型加载、文件写入和播放时间。
- `AudioPlayer` 负责缓存 WAV、异步准备、播放和释放。
- `MainActivity` 负责 UI 状态、后台任务和错误回显。

## 受影响模块和代码

- 新增 `3rd/tts-server/android-tts/` 独立 Gradle 工程。
- 新增 `3rd/tts-server/docs/design/android-offline-tts-apk.md`。
- 新增 `3rd/tts-server/docs/spec/android-offline-tts-apk.md`。
- 更新 `3rd/tts-server/package.json`、设计/spec 索引、todo、changelog。
- 不修改现有 `android-display` 业务代码和 `tts-server` HTTP 接口。

## 自测用例

1. 空文本点击生成，显示输入提示且不调用引擎。
2. 首尾空白文本被规范化后生成。
3. 2000 字文本允许提交，2001 字文本拒绝提交。
4. 模型目录缺文件时重新复制，复制中断不留下可用假模型。
5. 无网络状态下 APK 构建并在 arm64 真机生成和播放中文语音。
6. 连续点击时按钮只允许一个合成任务运行。
7. 生成完成状态显示非负、两位小数秒数，且耗时不包含播放等待。

## 兼容性测试

- Android 8.0+ arm64 设备。
- Android 9 Samsung 设备作为已有 Embedded Speech SDK 兼容性基线。
- 非 arm64 设备应在安装/构建说明中明确不支持。

## 性能测试

- 启动阶段记录模型复制和引擎加载耗时。
- 100 字中文短文本连续生成 10 次，确认无崩溃、无并发 native 调用。
- 生成后确认音频播放完成并释放播放器。

## 风险评估

- APK 体积增加约 75MB 模型 + 57MB SDK AAR 压缩后的实际增量。
- Embedded Speech SDK 和授权串属于可提取的 APK 资源。
- 低内存设备加载模型可能失败，需要明确提示。
- 当前仅验证 Xiaoxiao 和 arm64，其他声线/ABI 不在本任务范围。

## 预计工时

约 4 小时：工程配置 1 小时、引擎和播放 1.5 小时、界面 0.5 小时、测试与文档 1 小时。

## 执行记录

- ✅已完成 [2026-08-25][2026-08-25] 独立 Android 离线 TTS APK
  - 新增 `android-tts/` Kotlin/Gradle 工程，内置模型由 `models/extracted` 的 14 个文件构建复制。
  - `TtsEngine` 使用 `SpeechSynthesizer(config, null)`，避免 SDK 默认扬声器重复输出；`AudioPlayer` 统一播放 WAV。
  - 文本框、生成按钮、模型状态、错误提示和生成耗时显示已完成；耗时仅统计 SDK 合成阶段。
  - 验证：`npm --prefix 3rd/tts-server run build:android-tts`、`testDebugUnitTest` 通过；APK 资源和无网络权限静态检查通过。
