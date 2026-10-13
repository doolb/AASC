# Offline APK WebView 文件选择器

## 任务描述

修复 Android APK 内 WebView 对网页 `<input type="file">` 请求没有响应的问题，使 Chat2API 控制页可以从系统文件选择器选择账号凭证 JSON 并继续既有导入流程。显示页和控制页 WebView 均接入原生文件选择流程。

## 需求等级分析

- 主等级：L6 功能模块；子流程属于 L5。
- 证据：页面文件输入已存在并负责读取 JSON；Android `DisplayWebView` 已接管 `WebChromeClient`，但当前未实现 `onShowFileChooser`；两个 WebView 均由 `MainActivity` 创建。
- 评审结论：可开发，直接开发风险低；主要风险是取消、重复请求和 Activity 结束时网页回调未完成。
- L4 声明：`DisplayWebView` 文件选择请求 → `MainActivity` 系统选择器 → URI 结果 → WebView 页面回调。
- L4 操作流程：保存当前网页 callback；创建系统选择 Intent 并启动；解析选中 URI；将 URI 或取消结果交还 callback；结束时清理等待状态。

## 设计需求

- 复用 WebChromeClient 的 `FileChooserParams.createIntent()` 和 `parseResult()`，尊重页面的 MIME 类型、多选等参数。
- 使用 Activity Result API；新请求、用户取消、启动失败和 Activity 销毁均结束当前/旧 callback。
- 显示 WebView 和控制 WebView 共用处理逻辑。
- 不申请广泛存储权限，只使用系统选择器返回的 URI。

## Spec 伪代码

见 `docs/spec/android-display-offline-apk.md` 中 `MainActivity.registerWebViewFileChooser` 和 `DisplayWebView.onShowFileChooser`。

## 受影响模块与文件

- `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- `tests/android-offline-apk.test.js`
- `release/offline-release-status.json`：设置 `minApk=true`，其余状态沿用原值。
- Android Offline APK 设计、实现文档、任务列表和变更日志。

## 自测用例

1. 显示页和控制页 WebView 都将网页文件选择请求转交给 Activity。
2. 选择 JSON 文件后网页收到一个 URI；取消选择后网页收到空结果。
3. 连续发出选择请求时旧请求先收到取消结果，最新请求仍可正常完成。
4. 系统没有可处理的选择器或启动异常时 callback 被清理，不残留等待状态。
5. Activity 销毁时取消未完成请求；不新增存储权限声明。
6. 执行 Offline APK Node 静态回归和 Android JVM 单元测试；尝试 Debug APK 编译验证原生代码。

## 兼容性测试

- Android 6.0+ Offline APK 使用系统文档/文件选择器；选择器返回的 content URI 交由 WebView 处理。
- 普通 APK 的网络、页面加载和现有运行流程不变；WebView 文件输入获得与 Offline APK 相同的系统选择能力。
- 旧 Android 系统选择器不可用时以取消结果结束网页请求，不影响 Activity 启动。

## 性能测试

- 文件选择器仅在用户触发网页文件输入时启动，不增加启动耗时、后台线程或持续资源占用。

## 风险评估

- 系统选择器返回的 URI 可能由外部文档提供方托管；由 WebView chooser 合约处理，不自行读取文件内容或长期持久化授权。
- Activity 同时只支持一个待处理 chooser；新请求取消旧请求，避免网页 callback 被覆盖后悬挂。
- 真机选择器交互需在构建安装后验收；自动化构建与静态回归只能验证原生桥接和结果清理逻辑。

## 预计工时

约 1 小时，含实现、定向回归、Android 编译和文档归档；不含签名发布与真机现场验收。

## 实施结果（2026-10-13）

- `DisplayWebView` 将 `onShowFileChooser` 转交 `MainActivity`；显示页和控制页均已绑定同一 Activity Result 系统选择器，使用 `createIntent()` / `parseResult()` 保留网页筛选参数。
- 新请求会取消旧 callback；结果解析异常、选择器启动异常、用户取消和 Activity 销毁均结束并清理 callback。未新增存储权限。
- `node --test --test-name-pattern='APK WebView 文件输入|Offline 仅控制端禁用' tests/android-offline-apk.test.js`：2/2 通过。
- `./gradlew :app:testDebugUnitTest`：BUILD SUCCESSFUL，包含 `compileDebugKotlin`。
- 完整 `tests/android-offline-apk.test.js`：24/27 通过；剩余 3 项为无关既有失败（更新面板边距断言与当前 `-dp(21)` 不一致、render-display 用户结果索引中的 ID 与固定值断言不一致、NativeBridge 构造断言仍要求旧单行格式）。
- 未构建或发布 APK；`release/offline-release-status.json` 将 `minApk` 标为 `true`。待签名构建安装后完成系统文件选择器真机验收。
