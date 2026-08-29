# 正式 APK 接入测试 APK 的 ASR 增强功能

## 任务描述

将独立测试 APK 已验证的普通非流式 ASR、Sherpa GTCRN 降噪开关、快速多段声纹识别、语言选择和中英双语结果过滤接入正式 Display APK及其网页配置链路。不接入流式 ASR。

## design 需求

- 普通 ASR 作为无声纹基础路径。
- 降噪只执行一次，结果复用于声纹和 ASR。
- 快速多段支持 AUTO 或 1～5 人，默认 AUTO。
- 语言支持 auto、zh、en、zh-en-filter；中英双语过滤其他脚本文字。
- 新配置兼容旧 APK，降噪/快速多段以 display 原生路径为主。

## spec 设计

- `AsrEnginePool` 按语言构造单一当前 recognizer pool。
- `NativeBridge` 扩展异步识别请求，统一准备音频、执行 ASR/声纹流程和过滤。
- `VoiceprintEngine` 支持快速多段 cluster 数量及最长代表片段 embedding。
- 服务端保存并广播 ASR/声纹扩展配置，display 页透传配置和请求参数。

## 受影响功能模块和代码

- Android：`src/apps/android-display/app/src/main/java/com/aasc/display/`、APK Gradle assets、Android JVM tests。
- 服务端：`src/apps/server/boot/server-app.js`、`src/apps/server/modules/config/config-app-service.js`。
- 网页：`src/apps/web-mediacenter/ui/public/display.html`、`upload.html`、`js/tts.js`、`js/voiceprint-panel.js`。
- 文档：对应 design/spec、`docs/todo.md`、`changelog.md`。

## 自测用例

- 普通 ASR 在无声纹时只调用一次 ASR，返回单一 text。
- 语言值非法时回退 auto；zh/en 使用指定 SenseVoice language。
- `zh-en-filter` 保留 Han、英文、数字和标点，删除假名/韩文。
- 降噪开启时普通 ASR、单段声纹和快速多段各只调用一次降噪。
- 快速多段接受 AUTO、1～5，拒绝 6、负数和非法字符串。
- 快速多段每个 cluster 只提取最长代表片段 embedding。
- 旧四参数 ASR 桥、旧 voiceprint 配置仍可工作。

## 兼容性测试

- 浏览器无 NativeDisplay 时保持现有服务端/WASM 路径。
- 旧 APK 收到新服务端未知字段不崩溃。
- 新 APK 收到旧服务端缺失字段时使用 auto、关闭降噪、快速多段 AUTO 默认值。

## 性能测试

- 对 `zh.wav`、`en.wav`、`zh-en.wav`、`zh-en-mix.wav` 比较降噪开关和快速多段耗时。
- 检查快速多段最多 5 人时 native 内存和请求超时行为。

## 风险评估

- GTCRN 会增加约 1.5 秒级处理耗时，并可能改变中文识别音色；关闭开关可回退。
- 中英过滤按 Unicode 脚本实现，无法区分中日共享汉字。
- 服务端 ASR 路径不实现 GTCRN/快速多段，配置需明确提示其仅作用于 Display 本地路径。

## 预计工时

- Android 引擎及桥接：4 小时。
- 服务端与网页配置：2 小时。
- 单测、构建和回归：2 小时。
