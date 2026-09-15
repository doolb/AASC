# Android 高 DPI 显示端 WebView 缩放修复

## 任务描述

修复高 DPI 手机启动显示端 APK 时网页 UI 整体偏大的问题。问题同时影响显示端页面、`render-display` 任务覆盖层和 APK 内控制端，因此需要在 Android WebView 公共入口统一处理。

## Design 需求

- 以 mdpi（160 dpi）作为固定 CSS 像素 UI 的基准。
- 显示端 WebView 与控制端 WebView 使用相同初始页面缩放策略。
- display 2 等外部屏幕使用当前 WebView 所属显示屏 density，不使用主屏 density。
- 不改变媒体内容尺寸、Native 截图输出、输入坐标协议和浏览器端布局。

## Spec 设计

- 新增纯函数 `WebViewScalePolicy.initialScalePercent(densityDpi)`。
- 有效 density 按 `round(160 * 100 / densityDpi)` 计算，并限制在 25% 至 100%。
- 无效 density 回退 100%。
- `DisplayWebView` 初始化时调用 `setInitialScale()`，保留既有文字和 viewport 设置。

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/WebViewScalePolicy.kt`：初始缩放策略。
- `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`：将策略应用到所有 APK WebView。
- `src/apps/android-display/app/src/test/java/com/aasc/display/WebViewScalePolicyTest.kt`：density 边界和典型值测试。
- `docs/design/android-display.md`、`docs/spec/android-display.md`：设计与伪代码。
- `changelog.md`：完成记录。

## 自测用例

1. mdpi（160 dpi）返回 100%。
2. 320 dpi 返回 50%。
3. 560 dpi 返回 29%。
4. 非法 density 返回 100%，且结果不低于 25%。
5. 两个 `DisplayWebView` 均调用统一初始缩放策略。
6. 群聊清空定向回归测试继续通过。

## 兼容性测试

- Android 9/API 28 SM-N9500 内置屏幕和 display 2 外部屏幕。
- 高 DPI 手机屏幕。
- 普通浏览器控制端和浏览器显示端不受影响。
- 现有 ASR、TTS、MNN LLM、截图和输入桥不改变协议。

## 性能测试

- 缩放比例只在 WebView 构造时计算一次。
- 不新增页面循环、模型加载或媒体解码开销。

## 风险评估

- 页面初始缩放会改变 CSS 视口和响应式断点，需要确认手机屏幕不再误切换为过大的移动布局。
- 25% 下限用于避免极高 density 导致页面不可读；若现场仍偏大，只调整策略常量，不修改任务渲染代码。
- `setInitialScale` 对特定 WebView 版本的 viewport 行为可能不同，需通过 Android 单元测试和真机截图/页面信息双重验证。

## 预计工时

1 小时（含测试、APK 构建和真机启动检查）。

## 执行记录

- 根因确认：`display.html`、`render-display` 与 `/control` 共用 `DisplayWebView`，而 `textZoom=100` 无法缩放固定 CSS 布局。
- 已更新 design/spec，并新增 `WebViewScalePolicy`：以 160 dpi 为基准按当前 WebView 所属显示屏计算 `setInitialScale`，覆盖显示端、`render-display` 和控制端两个 WebView。
- TDD 红灯：新增单测在生产类尚未实现时按预期编译失败（`Unresolved reference: WebViewScalePolicy`）；补充实现后 Android JVM 单测 `25` 项通过。
- Node 回归：聊天/LLM、群聊清空和 think 过滤定向测试 `38/38` 通过；`render.smoke.js` 通过。
- Offline APK：首次使用 server release tar 打包时真机暴露 `express` 缺失；改用带生产 `node_modules` 的完整 Android Node 运行包重新打包，Gradle `BUILD SUCCESSFUL`。最终 APK `1,071,951,932` bytes，`zipinfo -t` 通过，包内包含 `express/index.js`、群聊清空修复源码和 `WebViewScalePolicy` DEX。
- 真机验证：`192.168.1.6:5555`（SM-N9500，Android 9）安装成功并在 display 2 启动；新版 Runtime 完整安装后 Node HTTPS 服务启动，`/display`、`/control` 均 HTTP 200，`/v1/models` HTTP 200，Qwen3.5 `/v1/chat/completions` HTTP 200 并返回非空正文，显示端 WebSocket 已连接。
- 现场限制：本次真机 display 2 当前报告为 160 dpi，未强制修改设备 density 生成 560 dpi 画面；高 DPI 比例由 `160/320/560` 和非法 density 边界单测覆盖，媒体尺寸、截图和输入协议未改动。
