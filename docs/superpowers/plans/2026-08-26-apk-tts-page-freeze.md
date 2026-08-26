# APK TTS 页面卡顿修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 消除 APK 在 TTS 生成期间因同步 CPU 配置和重复引擎重建造成的 WebView 页面卡顿、线程累积与内存上涨。

**Architecture:** `display.html` 只调用立即返回的 `cpuConfigureAsync`，并在页面侧去重配置；`NativeBridge` 使用单线程后台队列合并最新 CPU 配置；ASR/TTS policy 未变化时不重建 native pool；所有 WebView JavaScript 回调统一切回主线程。

**Tech Stack:** Android Kotlin/WebView/JavascriptInterface、Microsoft Embedded Speech SDK、sherpa-onnx、Node `node:test`、Gradle JVM tests。

**Spec:** `docs/design/android-native-tts.md`、`docs/design/android-display.md`、`docs/spec/android-native-tts.md`、`docs/spec/android-display.md`

## Global Constraints

- 直接在当前 `master` 工作区修改，保留已有用户改动和无关未跟踪文件。
- 先更新设计/spec/task 文档，再写生产代码。
- 先添加能复现同步 CPU 配置和重复 pool 重建问题的失败回归测试，再实现修复。
- 保持现有 TTS `ttsGenerating` / `ttsResult` 协议和旧 APK 的安全行为。
- 不在 WebView WebSocket 消息处理函数中等待原生 CPU 配置执行完成。

## Task 1: 文档与 RED 回归测试

**Files:** `docs/design/android-native-tts.md`, `docs/design/android-display.md`, `docs/spec/android-native-tts.md`, `docs/spec/android-display.md`, `docs/task/2026-08-26_APK生成TTS页面卡顿修复.md`, `tests/apk-tts-page-freeze.test.js`

- [x] 记录 ADB 证据、根因和修复边界。
- [x] 在 spec 中补充异步 CPU 配置、最新值合并、policy 相等短路和主线程回调伪代码。
- [x] 添加静态/集成契约测试，约束页面不再调用同步 `cpuConfigure`，桥存在异步入口，ASR/TTS policy 相等时不创建新 pool，声纹回调使用 `mainHandler.post`。
- [x] 运行新测试确认当前实现失败，并保存失败原因用于 GREEN 验证。

## Task 2: WebView CPU 配置非阻塞化

**Files:** `src/apps/web-mediacenter/ui/public/display.html`

- [x] 将 `cpuConfig` 消费改为调用 `cpuConfigureAsync`。
- [x] 按 `{asr, tts}` 规范化 JSON key 去重，重复广播不重复进入原生桥。
- [x] 对不支持异步桥的旧 APK/浏览器安全忽略，不能回退到同步 CPU 配置调用。

## Task 3: 原生 CPU 配置后台合并与引擎去重

**Files:** `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`, `TtsEngine.kt`, `AsrEngine.kt`

- [x] 保留同步 `cpuConfigure` API 兼容性，但将新页面入口实现为立即返回的 `cpuConfigureAsync`。
- [x] 使用单线程后台执行器串行应用 CPU 配置，仅保留待处理的最新请求，并记录已应用 key。
- [x] ASR/TTS policy 相等时直接复用现有 pool，避免重复创建 `SpeechSynthesizer`/recognizer slot。
- [x] 将 `voiceprintConfigure` 的异步 `evaluateJavascript` 调用全部切回 WebView 主线程。

## Task 4: 验证与文档收尾

**Files:** `docs/todo.md`, `changelog.md`, all affected docs

- [x] 运行新增 Node 回归和已有 CPU/TTS/WebSocket 回归。
- [x] 运行 Android focused JVM tests 与 `npm run build:apk`。
- [x] 根据实际结果更新 task、todo、design、spec、changelog。
- [x] 复核 diff，确认没有覆盖无关工作区改动。
