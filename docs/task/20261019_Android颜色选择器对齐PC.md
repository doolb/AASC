# Android 颜色选择器对齐 PC

## 任务描述

按用户确认的范围，使 Android 控制端和显示端全部颜色入口使用参照现有 PC 的选色面板；PC 保留原生选色器。

## Design 需求与 Spec 设计

- 设计见 `docs/design/android-color-picker.md`。
- 伪代码见 `docs/spec/android-color-picker.md`；保留 `input` 预览、`change` 保存与取消回退契约。

## 受影响模块与代码

- `src/apps/web-mediacenter/ui/public/display.html`、`upload.html`：加载共享选色资源。
- `src/apps/web-mediacenter/ui/public/js/android-color-picker.js`、`css/android-color-picker.css`：Android 增强与交互。
- `tests/android-color-picker.test.js`：双端与 PC 定向测试。
- 文档索引、待办、变更日志和 `release/offline-release-status.json`。

## 自测、兼容与性能

- Android UA 下测试全部 9 个入口、触摸/鼠标、HEX、预览、确认和取消；PC UA 下验证原生控件不变。
- 用现有浏览器测试工具验证窄屏弹层位置；运行相关背景光晕和主题回归。
- 仅打开弹层时计算颜色；色域拖动使用轻量 HSV/RGB 换算，不新增依赖或网络请求。

## 风险与预计工时

- Android WebView 键盘可能压缩可视区域；面板限制高度并允许内部滚动。
- 预计 2–4 小时；本任务完成后记录实际测试和出包状态。

## 未明确项

无。用户已确认以现有 PC 交互为参照、覆盖全部颜色入口，并保留 PC 原生控件。

## 完成记录

- 已接入显示端 8 个、控制端 1 个颜色入口；PC 保留原生控件。
- Android UA 浏览器测试覆盖色域触摸、色相、HEX、即时预览、确认、取消、非法输入、控制端 WebSocket 保存、窄屏可见性及 PC 兼容。
- 相关浏览器和背景光晕/主题定向测试 13/13 通过；JavaScript 语法和差异检查通过。
- `servicePackage=true` 待出包；Note8 实际 WebView 触摸与软键盘观感列为独立设备验收。
