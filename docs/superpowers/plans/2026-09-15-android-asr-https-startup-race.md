# Android ASR 测试 APK 强制 HTTPS 启动修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复独立 Android ASR 测试 APK 在模型/证书后台加载完成前启动服务时静默降级为 HTTP 的问题，确保用户可启动的服务始终使用 HTTPS。

**Architecture:** `MainActivity` 将 HTTPS 证书就绪状态作为服务按钮的启动前置条件，并在点击路径再次校验。`AsrHttpServer` 默认拒绝空 TLS 上下文；仅 JVM 明文回归测试通过显式测试开关保留旧 HTTP 测试能力，生产 APK 不提供该开关。

**Tech Stack:** Kotlin Android App、`SSLContext`、`SSLServerSocket`、JUnit 4、Gradle。

**Spec:** `docs/spec/android-voiceprint-test-apk.md`

## Global Constraints

- 保留现有 `arm64-v8a`、`minSdk=26` 和独立 APK 的模型/接口行为。
- 生产 APK 的网页服务必须使用内置测试 TLS 证书，不得静默回退为明文 HTTP。
- JVM 单元测试可通过显式测试参数使用明文 HTTP，不能把该参数接入 `MainActivity`。
- 伪代码文档必须与 Kotlin 实际启动条件和错误分支同步。
- 保留工作区已有用户改动，不重置、清理或覆盖无关文件。

### Task 1: 同步 HTTPS 启动契约文档

**Files:**
- Modify: `docs/design/android-voiceprint-test-apk.md`
- Modify: `docs/spec/android-voiceprint-test-apk.md`
- Create: `docs/task/20260915_android-asr测试APK强制HTTPS启动修复.md`
- Modify: `docs/todo.md`

- [x] 记录证书加载完成前禁止启动、TLS 为空时拒绝启动、重启后必须重新启动 HTTPS 服务的行为。
- [x] 记录兼容范围、验收用例、风险和预计工时。

### Task 2: 添加 HTTPS 缺失时的失败回归测试

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AsrHttpServerTest.kt`

- [x] 增加测试：默认没有 TLS 上下文时 `start(0)` 返回失败，错误包含 HTTPS/证书提示。
- [x] 将既有明文 JVM HTTP 测试改为显式传入 `allowInsecureHttp = true`，保持测试协议与生产协议边界清晰。
- [x] 运行独立测试并确认新增测试在当前实现上先失败。

### Task 3: 实现生产服务的 HTTPS 启动保护

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/res/values/strings.xml`

- [x] 为 `AsrHttpServer` 增加仅测试使用的明文开关，默认值为禁止；TLS 缺失且未显式允许时返回失败，不创建 `ServerSocket`。
- [x] 将 `MainActivity` 的 TLS 状态设为可见的并发安全状态，证书加载完成前禁用按钮，点击时再次拒绝未就绪状态。
- [x] 统一状态提示为 HTTPS，避免按钮显示 HTTPS 但地址实际为 HTTP。

### Task 4: 验证代码、APK 和真机协议

**Files:**
- Review only: `3rd/tts-server/android-asr/app/build.gradle.kts`
- Review only: `3rd/tts-server/android-asr/app/src/main/AndroidManifest.xml`

- [x] 运行 `:app:testDebugUnitTest`，确认新增 HTTPS 保护和既有 HTTP 测试均通过。
- [x] 构建独立 ASR Debug APK，检查 TLS 证书仍在 APK `assets/tls/`。
- [x] 安装并启动 APK，验证证书加载前按钮不可用；等待模型/证书就绪后地址为 `https://...`，HTTP 请求被重置、HTTPS `/health` 返回 200。
- [x] 运行 `git diff --check` 和相关 Node 契约测试。

### Task 5: 关闭任务并记录结果

**Files:**
- Modify: `docs/design/android-voiceprint-test-apk.md`
- Modify: `docs/spec/android-voiceprint-test-apk.md`
- Modify: `docs/task/20260915_android-asr测试APK强制HTTPS启动修复.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] 删除 `todo.md` 中已完成的 HTTPS 启动修复条目。
- [x] 在 task、design、spec 和 changelog 中记录实际改动文件与验证结果。
