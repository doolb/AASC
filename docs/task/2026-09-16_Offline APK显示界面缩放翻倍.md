# Offline APK 显示界面缩放翻倍

## 任务描述

将 Offline APK 的显示页和控制页初始界面比例从 100% 调整到 200%，构建并检查真机效果。普通 APK 保持 100%。

## Design 需求

- Offline APK 的显示 WebView 与控制 WebView 使用同一 200% 初始比例。
- 普通 APK 的两个 WebView 保持现有 100% 初始比例。
- 复用 `MainActivity.offlineMode` 和 `WebViewScalePolicy` 区分构建模式，不更改系统分辨率、density、网页代码、媒体尺寸或输入坐标协议。
- 保留现有 viewport、`textZoom=100` 和禁用手势缩放设置。

## Spec 设计

```text
connect:
    baseUrl = ServerConfig.baseUrl(input)
    显示 WebView = DisplayWebView(context, offlineMode)
    控制 WebView = DisplayWebView(context, offlineMode)

WebViewScalePolicy.initialScalePercent(offlineMode):
    如果 offlineMode：返回 200
    否则：返回 100

DisplayWebView.init(context, offlineMode):
    初始比例 = WebViewScalePolicy.initialScalePercent(offlineMode)
    setInitialScale(初始比例)
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/WebViewScalePolicy.kt`：按离线模式返回初始比例。
- `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`：接受离线模式并应用对应比例。
- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`：将当前离线模式传给显示页和控制页 WebView。
- `src/apps/android-display/app/src/test/java/com/aasc/display/WebViewScalePolicyTest.kt`：覆盖 offline 200% 与普通 APK 100%。
- `docs/design/android-display-offline-apk.md`、`docs/spec/android-display-offline-apk.md`、`docs/todo.md`、`changelog.md`。

## 自测用例

1. 单元测试确认 Offline APK 初始比例为 200%。
2. 单元测试确认普通 APK 初始比例仍为 100%。
3. 离线 APK 成功构建且 APK ZIP 完整性检查通过。
4. 真机检查显示页和控制页缩放效果，并确认应用不修改设备分辨率和 density。

## 兼容性测试

- Android 9/API 28 SM-N9500：确认 200% 下显示页与控制页可读、可操作。
- 普通 APK 保持 100% 初始比例，由策略单元测试覆盖。
- 浏览器端不经过此 APK WebView 策略，不受本次修改影响。

## 性能测试

- 只改变 WebView 初始比例，不增加模型加载、解码、服务通信或推理流程。
- 构建产物体积不应因 Kotlin 策略变化而产生可观变化。

## 风险评估

- 200% 页面比例会减少有效 CSS viewport 宽高，响应式布局可能换行或重排；需真机复核显示页与控制页。
- 此比例只应用于 offline 构建，避免改变普通 APK 的现有体验。

## 预计工时

约 30 分钟，包含定向单测、Offline APK 构建和真机页面检查。

## 执行记录（2026-09-16）

- 新增 Offline 200% 和普通 APK 100% 的比例单测；首次测试因当前策略尚无 `offlineMode` 参数而失败，加入模式策略后 `:app:testDebugUnitTest` 通过。
- `tests/android-offline-apk.test.js` 定向回归 17/17 通过。
- `npm run build:apk:offline` 构建成功；产物 `release/apkbuild/allserver/output/aasc-display-offline.apk`，大小 958958786 bytes，SHA-256 `a9119006236f279d5790aaa34499e443a24a13f1450fd7291c9a4e0a5cbac2f2`；ZIP 完整性检查通过。
- SM-N9500 Android 9 使用 `adb install -r` 覆盖安装成功并启动。截图复核显示页与控制页均明显放大；显示页状态条和控制页设备状态行右侧内容较挤，部分横向信息被裁切，记录为 200% 布局限制。
- 设备参数前后未变：物理分辨率 `1440x2960`、覆盖 `720x1480`，物理 density `420`、覆盖 `280`。
