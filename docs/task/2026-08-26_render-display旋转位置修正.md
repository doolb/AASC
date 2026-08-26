# render-display 旋转位置修正

## 任务描述

修正 `render-display` 在 90°/270° 时覆盖层使用旧尺寸定位的问题，避免覆盖层上下位置偏低并与媒体名重叠。

## design 需求

- 监控来源条目完成重建后，必须使用覆盖层最新宽高重新执行旋转定位。
- 保持 0°时覆盖层位于媒体名上侧的相对层级；旋转后根据屏幕方向避让媒体名，90°放在其右侧，270°放在其左侧。
- 覆盖层旋转后的实际包围盒上下边缘不得超出视口边距。

## spec 设计

- `render.js` 的 `update()` 在来源行渲染完成后再次调用 `applyRotationStyle()`。
- `applyRotationStyle()` 读取 `#monitorOverlay` 和 `#fileNameDisplay` 的 `getBoundingClientRect()`，按 24px 间距和旋转方向计算横向避让位置。
- 根据实际包围盒限制上下位置，保留多来源和动态数据更新行为。

## 受影响的功能模块和代码

- `res/tasks/render-display/render.js`
- `tests/render-display-rotation.test.js`
- `docs/design/android-display-stats.md`
- `docs/spec/monitor-system.md`

## 自测用例

- 先运行 Chromium 回归，确认旧尺寸定位会导致 90°/270°覆盖层与媒体名相交。
- 验证 90°覆盖层位于媒体名右侧，270°覆盖层位于媒体名左侧，且保留 24px 间距。
- 验证覆盖层上下边缘位于视口内，并运行 `render.smoke.js` 和显示端相关回归。

## 兼容性、性能与风险

- 不改变任务数据字段、WebSocket 协议和来源采集逻辑。
- 每次来源更新增加一次包围盒读取和少量 CSS 定位计算，无轮询新增。
- 极窄视口无法同时容纳超宽监控条和媒体名时，以视口边界为最高约束，避免继续扩大越界范围。

## 预计工时

- 约 0.5 小时。

## 当前状态

- ✅已完成 [2026-08-26][2026-08-26]：来源条目重建后按最新尺寸重新定位覆盖层，90°放在媒体名右侧、270°放在媒体名左侧，并限制旋转包围盒不越界。
  - 验证：render-display 旋转位置回归 1/1、显示端相关回归 41/41、显示端集成回归 9/9、`render.smoke.js` 和 `node --check` 通过。
  - 改动文件：`res/tasks/render-display/render.js`、`tests/render-display-rotation.test.js`、`docs/design/android-display-stats.md`、`docs/spec/monitor-system.md`。
