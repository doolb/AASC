# Android 高 DPI WebView 感知尺寸校准

## 任务描述

修复 Android APK 在高 DPI 手机上显示页和控制页整体偏小的问题。保持设备现有分辨率不变，使 CSS/dp UI 元素在不同密度屏幕上维持 Android mdpi（160 dpi）的感知尺寸；避免在 WebView 原生密度映射之上再按 density 反向缩小。

## Design 需求

- 160 dpi mdpi 作为 UI 感知尺寸参照，不作为设备输出分辨率。
- 不按屏幕物理像素分辨率比例缩放整页；不同 viewport 可重新排布布局。
- 显示端、`render-display` 覆盖层与 APK 内控制页通过统一 WebView 策略维持一致的 CSS/dp 尺寸。
- 保留 viewport、自适应布局、`textZoom=100` 和禁止手势缩放。
- 不修改设备分辨率、媒体源尺寸、Native 截图尺寸、输入坐标协议和模型推理行为。

## Spec 设计

```text
WebViewScalePolicy.initialScalePercent():
    返回 100

DisplayWebView.init:
    初始化现有 WebSettings
    初始页面比例 = WebViewScalePolicy.initialScalePercent()
    由 Android WebView 执行 CSS 像素到密度无关尺寸的映射

显示页与控制页:
    使用当前 WebView viewport 和页面响应式布局
    不根据 densityDpi 再次反向缩小整个页面
    保持设备分辨率、媒体尺寸、截图和坐标协议不变
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/WebViewScalePolicy.kt`：改为固定中性初始比例。
- `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`：显示端与控制端共用该策略。
- `src/apps/android-display/app/src/test/java/com/aasc/display/WebViewScalePolicyTest.kt`：验证初始比例固定为 100%。
- `docs/design/android-display.md`、`docs/spec/android-display.md`、`docs/todo.md`、`changelog.md`：同步行为设计、伪代码和完成记录。

## 自测用例

1. 初始 WebView 比例恒为 100%，不依赖 densityDpi。
2. 缩放策略不接收 densityDpi，不能因 160、280、320、560 dpi 产生不同页面比例。
3. 显示 WebView 与控制 WebView 继续通过公共 `DisplayWebView` 初始化。
4. offline APK 构建完成并通过 ZIP 完整性检查。
5. SM-N9500 真机 display 0 启动服务后检查显示页和控制端截图；核对 `wm size` 与 `wm density`，确认应用未更改系统分辨率或 density。
6. 保持 `render-display` 渲染、Native 截图和输入坐标协议无回归。

## 兼容性测试

- Android 9/API 28 SM-N9500 内置屏幕（当前系统覆盖 density 280）。
- 当前可用的 display 2 外接屏（density 160）；不为测试临时更改系统屏幕参数。
- 160/280/320/560 dpi 的策略边界由 Android JVM 单元测试覆盖。
- 浏览器显示端与浏览器控制端不经过 Android WebView，本次不改变其行为。

## 性能测试

- 初始比例为常量，不增加运行期测量或布局循环。
- 不增加资产、模型解包、媒体解码或推理成本。

## 风险评估

- 100% 初始比例会扩大目前 57% 下的可见 UI；若页面 viewport 或断点配置不一致，控件位置可能重排，需要真机同时检查显示页和控制页。
- UI 元素的感知尺寸保持一致不等于不同分辨率下屏占比相同；较大的 viewport 可显示更多布局空间。
- 系统屏幕设置属于设备状态；测试只读取并比对，不调用 `wm size` 或 `wm density` 修改命令。

## 预计工时

约 1 小时，包含单测、offline APK 构建、安装和真机界面复测。

## 执行记录（2026-09-16）

- 已实现固定 100% 中性缩放；定向测试先按旧行为复现失败，再通过；完整 Android `:app:testDebugUnitTest` 共 141 项通过，0 failures/errors。`node res/tasks/render-display/render.smoke.js` 通过。
- `allserver` Offline APK 构建成功（Gradle 39 actionable tasks，5m35s）；产物 `release/apkbuild/allserver/output/aasc-display-offline.apk` 为 958958786 bytes，SHA-256 `de8b946e0dcdce859a8f7803eb5566ce3259d9b19494112511154cbd3c397eb9`；`unzip -tq` 无压缩错误。
- SM-N9500 / Android 9 覆盖安装成功，设备 `/data/app/.../base.apk` SHA-256 与构建产物完全一致；应用数据保留，未卸载或清除数据。启动后 offline HTTPS/8081 服务和 WebSocket 正常，显示页加载完成。
- 高 DPI 内置屏幕（display 0）显示页和控制页截图已核对：控制按钮、媒体管理控件、等待媒体提示清晰可读。设备 `wm size` 前后均为物理 `1440x2960`、覆盖 `720x1480`，`wm density` 前后均为物理 `420`、覆盖 `280`，未更改系统屏幕参数。
- 按既有要求启动到 display 2；Activity 在 `1920x1080 / 160 dpi` 虚拟显示上处于 resumed 状态。Android 9 的 `screencap -d 2` 返回 `Unable to get handle for display 2`，因此无法截图该虚拟屏；render-display 结构冒烟通过且与显示页共用同一 WebView 策略，未单独启动覆盖层任务。
