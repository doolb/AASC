# Android 独立离线 TTS APK 设计

## 需求

在 `3rd/tts-server` 下新增一个独立 Android APK。APK 打开后提供多行文本框和生成按钮，用户输入文本后由 APK 本地内置的 Microsoft Embedded Speech SDK 和 Xiaoxiao 中文模型生成语音并自动播放。

## 范围

- APK 不连接 `tts-server`，不调用 HTTP 接口，不依赖网络。
- 模型固定为现有 `zh-CN-XiaoxiaoNeural`，不提供声线、服务器地址和语速设置。
- 生成成功后直接播放 WAV；音频只写入应用缓存目录，不保存为用户文件。
- 仅支持 `arm64-v8a`，最低 Android 版本为 8.0（API 26）。
- 模型唯一源目录为 `3rd/tts-server/models/extracted`，Gradle 构建时只选择 SDK 所需的 14 个文件复制到 APK assets，避免维护第二份模型。

## 架构

```text
┌──────────────────────── APK ────────────────────────┐
│ MainActivity                                          │
│   ├─ 文本输入 / 生成按钮 / 状态反馈                   │
│   ├─ TtsModelFiles：assets → filesDir 原子复制         │
│   ├─ TtsEngine：Embedded Speech SDK 离线合成          │
│   └─ AudioPlayer：缓存 WAV 并使用 MediaPlayer 播放     │
└───────────────────────────────────────────────────────┘
                         │
                         ▼
             本地内置 14 个 Xiaoxiao 模型文件
```

应用启动后在单线程执行器中检查并复制模型文件，复制完成后初始化 `EmbeddedSpeechConfig` 和无音频输出的 `SpeechSynthesizer(config, null)`。生成按钮触发文本校验，并在进入 `TtsEngine.synthesize` 前记录单调时钟；后台 `SpeakText` 完成后计算生成耗时，回到主线程更新“生成完成，用时 X.XX 秒”并交给 `AudioPlayer` 播放。不能使用单参数 `SpeechSynthesizer(config)`，因为 SDK 会隐式创建默认扬声器输出。

## 关键约束

1. Embedded Speech SDK 的 AAR 从现有 `src/apps/android-display/app/libs/client-sdk-embedded-1.51.2.aar` 复用，避免将 57MB 二进制再次提交；APK 工程自身不依赖 `android-display` 的 Kotlin 代码或服务器协议。
2. 模型复制按单文件临时文件 + 原子改名处理，异常退出不会把半文件当作可用模型。
3. 生成期间按钮禁用，避免多个 `SpeakText` 并发使用同一个 native synthesizer。
4. `onDestroy` 释放 MediaPlayer、SpeechSynthesizer 和后台执行器。
5. 合成器和声线探测器都显式使用 `SpeechSynthesizer(config, null)`；实际音频输出只能由 `AudioPlayer` 负责。
6. SDK 授权串与当前 Android 原生 TTS 实现保持一致；该串和模型随 APK 分发，属于可被提取的本地资源，不新增远程密钥配置。

## 错误处理

- 空白文本：不启动 SDK，提示“请输入要生成的文本”。
- 超过 2000 个 Kotlin 字符：拒绝提交，提示长度限制。
- 模型复制或初始化失败：按钮保持禁用，显示具体阶段错误。
- 合成失败或取消：恢复按钮，显示 SDK 错误信息，不播放残留音频。
- 播放失败：恢复按钮并提示 WAV 播放错误。
- 生成耗时只覆盖 SDK 合成阶段，模型加载、文件写入和音频播放不计入成功耗时。

## 验收标准

- `npm run build:android-tts` 能生成 `app-debug.apk`。
- Android JVM 单元测试覆盖空文本、首尾空白、最大长度和超长文本。
- APK 无 `INTERNET` 权限，安装后断开网络仍能完成模型加载和生成。
- 真机（arm64、Android 8.0+）打开后能看到文本框和生成按钮，输入中文点击后能自动播放 Xiaoxiao 语音。
