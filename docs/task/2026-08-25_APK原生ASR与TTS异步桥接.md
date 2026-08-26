# APK 原生 ASR 与 TTS 异步桥接

## 任务描述

修复 APK 原生语音识别和语音生成通过 `@JavascriptInterface` 同步等待推理结果，可能阻塞 WebView JavaScript、WebSocket 心跳和页面事件的问题。新版 APK 使用异步任务与 JS 回调，旧 APK 继续使用同步接口兼容运行。

## design 需求

- 原生 ASR/TTS 桥调用只负责校验模型状态和提交任务，立即返回 `accepted`。
- ASR 结果通过 `window.onNativeAsrResult` 回传，TTS WAV 结果通过 `window.onNativeTtsResult` 回传。
- 原生工作线程分别复用 ASR/TTS 单线程执行器，超时由独立调度器取消任务并回传错误。
- TTS 生成回包只返回音频数据，不在生成回调中直接播放；播放仍由现有 TTS 播放链路负责。
- 页面检测不到异步桥方法时回退旧同步接口，兼容已安装的旧 APK。

## spec 设计

### ASR

```text
handleAsrAudio:
  解码 webm/wav → 重采样为 16kHz mono s16le
  新 APK → asrRecognizeAsync(requestId, pcm, voiceprintConfig)
           → onNativeAsrResult → WS asrResult
  旧 APK → asrRecognize/voiceprint* 同步兼容路径 → WS asrResult
```

### TTS

```text
handleTtsGenerate:
  新 APK → ttsSynthesizeAsync(requestId, text)
           → onNativeTtsResult → WS ttsResult{audioData}
  旧 APK → ttsSynthesize(text) 同步兼容路径 → WS ttsResult
```

## 受影响功能与代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
  - 新增异步 ASR/TTS 桥、超时监控和主线程 JS 回调。
- `src/apps/web-mediacenter/ui/public/display.html`
  - 新增异步回调和结果发送函数；新 APK 优先走异步，旧 APK 保留同步回退。
- `docs/design/android-native-asr.md`、`docs/spec/android-native-asr.md`
- `docs/design/android-native-tts.md`、`docs/spec/android-native-tts.md`
- `docs/design/display.md`
- `tests/android-native-async-bridge.test.js`

## 自测用例

- 静态确认 Kotlin 暴露 `asrRecognizeAsync`、`ttsSynthesizeAsync`，并通过主线程回调 JS。
- 静态确认 display.html 注册两个异步回调、优先调用异步方法，并保留同步回退。
- JavaScript 语法检查。
- Android `assembleDebug` 与 `testDebugUnitTest`。
- `git diff --check`。

## 兼容性测试

- 新 APK：异步任务完成、异常和超时均返回对应 requestId。
- 旧 APK：页面检测不到异步方法时仍调用原同步 ASR/TTS 接口。
- 非 APK 浏览器：继续使用原有 WASM ASR 与服务器 TTS 路径。
- TTS 生成：生成回包不直接调用 `ttsAudio.play()`，不改变现有播放策略。

## 性能测试

- 异步桥调用线程不等待 `Future.get`；推理仍保持单线程串行，避免底层引擎并发。
- ASR 和 TTS 原生桥超时统一为 60 秒；服务端等待显示端 ASR/TTS 回包也统一为 60 秒。
- 真机长稳、P95 和音频播放行为需在新 APK 安装后补测。

## 风险评估

- WebView 页面重载或 WebSocket 重连时，已完成的原生回调可能找不到当前请求；服务端仍按 requestId 和超时处理。
- TTS base64 WAV 仍需经 `evaluateJavascript` 回传，超长文本可能增加 JS 回调负载；后续可改为文件 URL 或本地缓存协议。
- 声纹多人分段逻辑从同步桥集中到异步 ASR 工作线程，需用真机继续验证 native 稳定性。

## 预计工时

约 2 小时（桥接改造、兼容回退、测试与文档同步）。
