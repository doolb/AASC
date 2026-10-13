# Offline APK TTS 位置匹配当前 Android

日期：2026-10-12。状态：代码与浏览器 DPI 模拟已完成；待 min APK 出包安装后的真机验收。

## 任务描述与需求等级

Offline APK 在高 DPI 屏幕上的 TTS 字幕位置与当前 Android 显示页不同。用户允许直接用浏览器模拟，并指出 Offline APK 会按屏幕 DPI 缩放。

需求等级：主等级 L6（显示 WebView 与字幕布局模块），次等级 L5（跨 APK 模式保持相同 TTS 物理位置）、L4（缩放比例到 CSS 偏移的数据流）。浏览器模拟确认 0°/180°固定 CSS 偏移受初始 WebView 缩放放大；90°/270°已有中心包围盒锚点。风险为错用控制页比例或移除整页缩放会改变 Offline 其他界面，因此只处理 TTS 固定偏移。

## Design 需求

- 保留 Offline 显示 WebView 的现有 DPI 缩放策略及 Offline 控制页的缩放。
- TTS/ASR 共用语音文本节点在 0°/180°的基准偏移为 160 CSS px；使用当前显示 WebView 的实际初始缩放百分比反向换算，使物理偏移与 100% Android 显示页一致。
- 90°/270°保留现有旋转包围盒中心锚点和自适应边距。
- 普通 APK、浏览器和旧版原生桥缺少缩放 getter 时使用 100%。

## Spec 设计

```text
DisplayWebView 创建时计算并保存 initialScalePercent
setInitialScale(initialScalePercent)
NativeBridge.getDisplayWebViewInitialScalePercent 返回同一个百分比

display.html 首次布局读取该值，失败或不存在时使用100
scaleFactor = max(scalePercent, 1) / 100
0°/180° TTS边距 = 160 / scaleFactor CSS px
90°/270°使用现有中心包围盒锚点
```

## 受影响的功能模块与代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- `src/apps/web-mediacenter/ui/public/display.html`
- `tests/display-broadcast-text-rotation.test.js`
- `docs/design/android-display-offline-apk.md`、`docs/design/display.md`
- `docs/spec/android-display-offline-apk.md`、`docs/spec/display-ui-rotation.md`
- `docs/todo.md`、`changelog.md`

## 自测用例

- 使用同一物理视口、同一 TTS 文本，以 Chromium 模拟 100%、112%、150%、300%初始缩放。
- 覆盖 0°/90°/180°/270°；0°/180°固定边距换算到物理像素后保持 160 px，90°/270°边缘锚点保持原有自适应行为。
- 校验普通浏览器、普通 APK、旧版原生桥以及读取缩放失败时回退 100%。
- 运行 TTS 旋转浏览器测试、Android `:app:testDebugUnitTest`、相关文件语法与 diff 检查。

## 兼容性、性能与风险

- getter 使用 `DisplayWebView.setInitialScale` 的同一计算结果，避免网页端重新推导 DPI 或误用控制 WebView。
- 原生桥比例只读取并缓存一次，不增加每帧调用；不修改媒体、语音状态行、控制页和其他 UI 缩放。
- 如果后续支持运行时动态改变 WebView 初始缩放，需要同步刷新缓存并重新排版；当前缩放在 WebView 创建时固定。
- 浏览器模拟验证布局数据流，不能替代 APK 安装后的 Android WebView 视觉验收。

预计工时：约 1–2 小时（含浏览器和 Android JVM 回归）；另计 min APK 构建/安装与真机验收。

## 实施结果

- 依照模拟结果仅归一化 TTS 固定偏移，Offline 整页和控制页缩放策略保持。
- Chromium 按当前 ADB 设备的 112%手机/150% HDMI DPI 策略模拟；固定偏移补偿后 100%/112%/150%/300%均回到 160 物理像素，90°/270°保持约24物理像素边距。无 getter 和 getter 抛错时均回退到100%。
- Offline 状态文件原有 `minApk=true`、`servicePackage=true`、`dependenciesPackage=true`，本任务不改变这些已有值。
- 2026-10-13 验证：`node --test --test-name-pattern='TTS|旋转|媒体名|天气' tests/display-broadcast-text-rotation.test.js` 12项通过；`./gradlew :app:testDebugUnitTest` 构建成功。`git diff --check` 通过。
- 完整浏览器文件还包含一个未改动的大视口弹窗测试，在1200×800、DPR 3时等待 `handleVoiceCommand` 超时；该用例单独复现，旋转锚点用例单独通过。相关失败不影响新增 DPI 用例及12项定向回归。
- 真实 APK 尚未构建或安装，min APK 出包后的四向真机验收仍待完成。
