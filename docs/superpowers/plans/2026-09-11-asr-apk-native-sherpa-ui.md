# ASR 测试 APK 原生页面接入 Sherpa 声纹测试 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将 ASR 测试 APK 网页中已有的 Sherpa 声纹测试能力接入 APK 原生页面，让用户可以使用当前选中或录制的音频完成声纹注册、单段/多段/快速多段测试，并在原生页面查看完整识别与相似度结果。

**Architecture:** 复用 `MainActivity` 已有的音频选择、录音、CPU 模式和后台线程；原生页面直接调用现有 `VoiceprintTestCoordinator`，不新增 HTTP 接口、不更换模型、不复制音频解码流程。将展示格式集中到可单元测试的 `UiStatus`，将模型状态和操作状态由 `MainActivity` 统一刷新。

**Tech Stack:** Android Kotlin, Android XML layout, JUnit 4, Node.js `node:test`, Gradle Android plugin, 现有 Sherpa/ASR coordinator。

**Spec:** `docs/design/android-voiceprint-test-apk.md`、`docs/spec/android-voiceprint-test-apk.md`、`docs/task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`

## Global Constraints

- 工作目录固定为 `/mnt/AASC` 的 `master`，保留现有日志、模型和其他无关用户改动。
- 先完成测试再实现对应生产代码；每一步都运行该步骤指定的红/绿验证。
- 不修改 Sherpa 模型文件、模型加载协议或 HTTP 网页接口；不引入新的声纹模型。
- 原生页面使用中文现有 UI 风格，新增控件放在现有音频操作和普通 ASR 结果区域之后，不放入树形视图。
- 普通 ASR 降噪与声纹测试降噪分别由两个开关控制；两个开关的状态不能互相覆盖。
- 声纹测试使用 `AsrLanguageMode.ZH`，多段人数使用 `VoiceprintSpeakerCount` 的 `AUTO`/1~5 值。
- 任何异步操作都必须在后台执行，并在主线程刷新控件；异常必须显示在结果区域，同时恢复按钮状态。
- 不使用 `var`；新增注释使用中文并说明关键行为。

---

## Task 1: 为原生声纹结果和 UI 接线增加失败测试

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/UiStatusTest.kt`
- Modify: `tests/android-asr-apk.test.js`

- [x] 在 `UiStatusTest.kt` 增加一个注册结果测试：构造 `VoiceprintRegistrationResult`，断言格式化结果包含注册名称、embedding 维度、声纹降噪状态和耗时。
- [x] 在 `UiStatusTest.kt` 增加一个测试结果测试：构造包含匹配声纹、相似度、阈值和未识别分段的 `VoiceprintTestResult`，断言结果包含模式、ASR 文本、speaker、相似度、阈值、分段 cluster/speaker/text/error 以及阶段耗时。
- [x] 在 `VoiceprintUiRequestTest.kt` 增加单段 AUTO、多段人数和双降噪参数独立性的行为测试，并先运行确认缺少实现时失败。
- [x] 在 `tests/android-asr-apk.test.js` 增加原生布局契约：断言存在 `voiceprintStatus`、`speakerName`、`asrDenoise`、`voiceprintDenoise`、`registerSpeaker`、`testSingle`、`testMulti`、`testMultiFast`、`speakerCount` 和 `voiceprintResult`。
- [x] 在同一个 Node 契约测试中增加 `MainActivity.kt` 接线契约：断言存在两个降噪控件绑定、`voiceprintCoordinator.register`、`voiceprintCoordinator.test`、`VoiceprintSpeakerCount.parse` 和 `UiStatus.voiceprintResult` 调用。
- [x] 运行 `node --test tests/android-asr-apk.test.js`，确认新增原生控件/接线断言因实现尚不存在而失败。
- [x] 运行 `cd 3rd/tts-server && ../../src/apps/android-display/gradlew -p android-asr :app:testDebugUnitTest --tests com.aasc.asr.UiStatusTest`，确认新增 `UiStatus` API 测试因实现尚不存在而失败。

## Task 2: 实现可测试的声纹注册和测试结果格式化

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/UiStatus.kt`
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintTestCoordinator.kt`

- [x] 增加 `UiStatus.voiceprintRegistration(result)`，以多行中文文本展示注册名称、embedding 维度、声纹降噪开关状态、降噪耗时和总耗时。
- [x] 增加 `UiStatus.voiceprintResult(result)`，稳定展示模式、ASR 文本、匹配 speaker、`similarityScore`、`threshold`、ASR/声纹降噪状态与耗时、总耗时、diarization/embedding/ASR 阶段耗时。
- [x] 在结果格式化中逐条展示 `segments` 的开始/结束时间、clusterId、speaker（为空时显示未识别）、相似度、文本和错误；空文本、空 speaker、空 score 使用明确的中文/`null` 表示，避免页面看不到未识别声纹。
- [x] 保持现有 `UiStatus.result` 和 `UiStatus.validate` 的输出与行为不变，避免影响普通 ASR 页面。
- [x] 运行 Task 1 的 Gradle 单元测试，确认 `UiStatusTest` 全部通过；若失败，只修正格式化实现或测试期望，不扩大功能范围。

## Task 3: 增加原生页面控件和资源

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/main/res/layout/activity_main.xml`
- Modify: `3rd/tts-server/android-asr/app/src/main/res/values/strings.xml`

- [x] 在普通 ASR 操作区域增加 `asrDenoise` 开关，并使其紧邻普通 ASR 识别按钮，明确它只影响文字识别。
- [x] 在普通结果区域后增加 Sherpa 声纹卡片，包含 `voiceprintStatus`、`speakerName`、`voiceprintDenoise`、`registerSpeaker`、`speakerCount`、`testSingle`、`testMulti`、`testMultiFast` 和可滚动/可选择的 `voiceprintResult`。
- [x] 为控件增加中文 `strings.xml` 文案，明确声纹降噪只影响声纹、人数选择只对多段测试生效，并保留现有录音/选择/播放/保存/HTTP 控件的 id 和布局行为。
- [x] 为长 JSON/分段结果预留足够的垂直空间和文本选择能力，确保相似度与未识别分段可复制查看；不新增第三方 UI 依赖。
- [x] 运行 `node --test tests/android-asr-apk.test.js`，确认布局相关断言通过；接线相关断言仍应在 MainActivity 完成前失败。

## Task 4: 将声纹注册、三种测试模式和状态刷新接入 MainActivity

**Files:**
- Modify: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt`
- Add: `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintUiRequest.kt`
- Add: `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/VoiceprintUiRequestTest.kt`

- [x] 增加原生控件字段绑定和人数 Spinner 初始化：展示“自动”和 1~5 人，内部值严格使用 `VoiceprintSpeakerCount.AUTO` 与 `VoiceprintSpeakerCount.parse`，不自行复制人数校验逻辑。
- [x] 增加 `refreshVoiceprintStatus()`：根据 `voiceprintCoordinator.isReady()`、`embeddingDim()`、`matchThreshold()` 和 `registeredSpeakers()` 展示模型状态、维度、阈值和已注册名称；模型加载完成后和注册成功后刷新。
- [x] 修改普通 ASR 识别调用，将 `asrDenoiseCheck.isChecked` 传入现有 `AsrCoordinator.submit(..., AsrLanguageMode.ZH, denoise)`；不改变普通 ASR 的其他流程。
- [x] 增加注册处理：校验 `speakerName`、当前音频和模型状态，复制 `selectedSamples` 后调用 `voiceprintCoordinator.register(name, samples, selectedCpuMode, voiceprintDenoiseCheck.isChecked)`，完成后使用 `UiStatus.voiceprintRegistration` 展示结果并刷新状态。
- [x] 增加统一测试处理：根据按钮分别传入 `VoiceprintMode.SHERPA_SINGLE`、`SHERPA_MULTI`、`SHERPA_MULTI_FAST`，多段模式读取人数 Spinner，单段模式传 `AUTO`；调用 `voiceprintCoordinator.test(mode, samples, selectedCpuMode, speakerCount, asrDenoiseCheck.isChecked, voiceprintDenoiseCheck.isChecked, AsrLanguageMode.ZH)`。
- [x] 对注册和测试按钮实施忙碌状态：操作期间禁用相关控件，显示处理中提示；成功、失败和异常路径都在主线程恢复控件，避免重复提交。
- [x] 将异常转换为可读错误显示到 `voiceprintResult`，不要吞掉 `similarityScore`、阈值或分段错误；保留现有普通 ASR、播放、保存、HTTP 服务和生命周期释放逻辑。
- [x] 在 `onDestroy` 中确认新增控件没有启动独立线程或资源；继续复用现有 coordinator 的 `shutdown()`，不重复关闭共享引擎。
- [x] 运行 `node --test tests/android-asr-apk.test.js`，确认布局与 MainActivity 接线契约全部通过。
- [x] 运行 `cd 3rd/tts-server && ../../src/apps/android-display/gradlew -p android-asr :app:testDebugUnitTest`，确认 Kotlin 单元测试通过。

## Task 5: 构建 APK 并完成端到端回归

**Files:**
- Modify: `docs/design/android-voiceprint-test-apk.md`
- Modify: `docs/spec/android-voiceprint-test-apk.md`
- Modify: `docs/usage.md`
- Modify: `docs/task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] 运行现有完整 Android APK 构建脚本：`npm --prefix 3rd/tts-server run build:android-asr`。
- [x] 运行目标 Node 契约测试：`node --test tests/android-asr-apk.test.js tests/android-asr-options-integration.test.js tests/android-asr-save-wav.test.js`。
- [x] 检查 `git diff --check`，确认没有空白错误或误改生成文件；检查 `git status --short`，确认日志、模型和 `.cxx` 等无关改动未被加入。
- [x] 若设备可用，执行 `adb devices`，安装 `3rd/tts-server/android-asr/app/build/outputs/apk/debug/app-debug.apk`，启动 `com.aasc.asr`，并核对 `MainActivity` 进程和窗口焦点；设备 UI 自动化桥返回空 root，未将无法自动执行的手工控件操作冒充为已验收。
- [ ] 使用同一段测试 WAV 注册一个 speaker 后重复三种模式，确认原生页面能显示匹配 speaker、`similarityScore`、`threshold`，以及未匹配分段的文本和相似度；当前设备 UI 自动化桥不可用，保留为现场手工验收项。
- [x] 更新 design 文档的完成说明，更新 spec 的伪代码与实际接线说明，给 task 文档补充完成状态、实际改动、验证结果、兼容性/性能/风险结论。
- [x] 从 `docs/todo.md` 删除已完成的进行中条目，并在 `changelog.md` 按项目格式记录本次功能、文件和验证结果。
- [ ] 提交代码，提交信息使用 `feat(android-asr): 将 Sherpa 声纹测试接入原生页面`，提交前再次确认不包含现有日志、模型和构建缓存。

## Expected Verification Summary

- `UiStatusTest` 覆盖注册结果和完整声纹测试结果格式化。
- `tests/android-asr-apk.test.js` 覆盖原生控件与 MainActivity 关键接线。
- Android Debug APK 能通过现有 `npm run build:android-asr` 构建。
- 普通 ASR 的原有选择/录音/播放/保存/HTTP 行为保持不变；新增声纹功能只复用现有 coordinator 和模型资源。
