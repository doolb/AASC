# ASR 测试 APK 原生页面接入 Sherpa 声纹 UI

## 任务描述

将独立 ASR 测试 APK 网页 `AsrWebPage` 中已有的 Sherpa 声纹测试相关 UI，接入 APK 原生 `MainActivity` 页面，使用户不打开浏览器也能使用同一份已选/已录音音频完成声纹注册、单段、多段和快速多段测试。

## Design 需求

- 原生页面增加 Sherpa 声纹状态、注册名称、注册按钮、声纹降噪开关、三种测试按钮、人数选择和结果展示。
- 保留 ASR 文字降噪与声纹降噪两个独立开关，并与已有协调器参数一一对应。
- 复用当前 `selectedSamples`、`selectedCpuMode`、`background` 和 `VoiceprintTestCoordinator`。
- 不更换模型、不新增 HTTP 接口、不改变阈值算法和进程内存声纹库。

## Spec 设计

- `activity_main.xml` 通过原生控件提供完整 Sherpa 操作区。
- `MainActivity.kt` 负责绑定控件、输入校验、后台调用、按钮互斥、结果刷新和声纹状态刷新。
- `UiStatus.kt` 提供可测试的声纹注册/测试结果文案格式化，统一显示总结果和分段诊断字段。

## 受影响的功能模块和代码

- `3rd/tts-server/android-asr/app/src/main/res/layout/activity_main.xml`
- `3rd/tts-server/android-asr/app/src/main/res/values/strings.xml`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/UiStatus.kt`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/VoiceprintUiRequest.kt`
- `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/UiStatusTest.kt`
- `tests/android-asr-apk.test.js`
- `docs/design/android-voiceprint-test-apk.md`
- `docs/spec/android-voiceprint-test-apk.md`
- `docs/usage.md`
- `docs/task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`

## 自测用例

1. 原生 APK 页面包含 Sherpa 状态、注册名称、两个降噪开关、注册按钮、三种测试按钮、人数选择和结果区域。
2. 未选音频时点击注册或测试，显示明确提示且不提交推理任务。
3. 未填写名称时点击注册，显示明确提示且不改变声纹库。
4. 注册成功后显示名称、embedding 维度和降噪耗时，已注册名称列表更新。
5. 单段测试显示匹配名称、相似度、阈值、ASR 文本和阶段耗时。
6. 多段与快速多段测试显示每段文字、cluster、speaker、相似度、阈值和错误信息。
7. 任一任务执行期间重复点击不会并发执行，任务结束后按钮恢复。
8. Android JVM 单元测试、独立 ASR APK 构建和既有 HTTP/声纹测试通过。

## 兼容性测试

- Android 9/API 28、arm64-v8a 真机页面可滚动显示新增控件。
- `selectedSamples` 来源同时覆盖文件选择和原生录音。
- Sherpa 单段、普通多段、快速多段保持现有模型和结果结构。
- HTTPS 服务开关、普通 ASR、音频播放、保存 WAV 和流式 ASR 不受影响。
- 现有浏览器 `AsrWebPage` 和 HTTP 接口保持不变。

## 性能测试

- UI 操作只复用已有单线程声纹协调器，不增加并发 native 推理。
- 原生页面不重复解码已选音频，不新增模型加载。
- 结果格式化仅遍历已有结果分段，主线程不执行推理。

## 风险评估

- 原生页面控件增多可能增加小屏滚动距离；使用现有 `ScrollView`，不改变横向布局。
- 声纹库仍只存在 APK 进程内，重启后的清空行为保持不变。
- 详细结果文本可能较长，使用可选择文本和分段换行，避免截断关键分数。
- 原生页面与网页各自维护操作入口，均调用同一协调器和模型，不能保证两种入口同时运行；协调器忙时显示明确错误。

## 预计工时

- 文档和伪代码：0.5 小时
- 原生布局与交互接入：1.5 小时
- 结果格式化与测试：1 小时
- Android 构建与真机回归：1 小时

## 当前状态

- ✅ 已完成实现、定向测试、Debug 构建和 APK 启动验收。
- ⏳ 待现场手工验证：在设备上用同一段 WAV 完成注册后，依次点击单段、多段、快速多段并检查页面结果。

## 实际实现与验证结果

- 原生 `activity_main.xml` 已增加普通 ASR 降噪、Sherpa 声纹状态、名称输入、声纹降噪、注册、人数选择、单段/多段/快速多段测试和详细结果区域。
- `MainActivity.kt` 已复用 `selectedSamples`、`selectedCpuMode`、`background` 和 `VoiceprintTestCoordinator`；注册和测试均使用后台线程，完成/异常路径恢复按钮状态。
- `UiStatus.kt` 已格式化整体匹配信息和逐段 `speaker`、`similarityScore`、`threshold`、文字、错误及阶段耗时；未识别声纹显示为“未识别”。
- `VoiceprintUiRequest.kt` 已集中校验单段 AUTO、多段人数及两个降噪参数；注册结果同时显示声纹降噪耗时和注册总耗时。
- `node --test tests/android-asr-apk.test.js`：3/3 通过。
- `VoiceprintUiRequestTest`、`UiStatusTest`：通过。
- `cd 3rd/tts-server && ../../src/apps/android-display/gradlew -p android-asr :app:testDebugUnitTest`：通过。
- `npm --prefix 3rd/tts-server run build:android-asr`：Debug APK 构建通过。
- 相关 Node 回归测试：10/10 通过；APK 已覆盖安装到 `192.168.1.6:5555` 并启动，窗口焦点和进程正常，无崩溃日志。
- 设备 UI 自动化桥未返回 root 节点，因此未将自动控件树读取计入手工交互验收；布局资源、静态契约和编译均已验证。
- 全量 `npm test`：580/581 通过；唯一失败为既有 `tests/display-native-bridge.test.js` 的旧 `injectTouch` 契约，与本次独立 ASR APK 改动无关。
