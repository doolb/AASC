# render-display 180°位置修正

## 任务描述

修正 `render-display` 在 180°时覆盖层固定到右上角、与右上角媒体名重叠的问题。

## design 需求

- 180°旋转时保持 0°“覆盖层位于媒体名上侧”的旋转相对关系，即覆盖层位于媒体名下侧。
- 使用旋转后的实际包围盒定位，覆盖层与媒体名保持 24px 间距，并限制在视口内。

## spec 设计

- `avoidFileNameOverlap(180)` 读取 `#monitorOverlay` 和 `#fileNameDisplay` 的实际包围盒。
- 以媒体名底部加 24px 为覆盖层目标顶部；当视口空间不足时以视口边界为最高约束。
- `update()` 在来源条目重建后重新调用 `applyRotationStyle()`，覆盖来源增减和动态刷新。

## 受影响的功能模块和代码

- `res/tasks/render-display/render.js`
- `tests/render-display-rotation.test.js`
- `docs/design/android-display-stats.md`
- `docs/spec/monitor-system.md`

## 自测用例

- 180°时覆盖层顶部不小于媒体名底部加 24px。
- 90°、180°、270°旋转后的覆盖层均不越出 1920×1080 视口。
- 运行 render-display smoke、语法检查、显示端相关回归和集成回归。

## 兼容性、性能与风险

- 不改变任务数据字段、WebSocket 协议和来源采集逻辑。
- 仅在已有旋转定位时增加一次包围盒读取和少量 CSS 定位计算。
- 极窄视口无法容纳完整间距时，以视口边界为约束，避免覆盖层越界。

## 预计工时

- 约 0.25 小时。

## 当前状态

- ✅已完成 [2026-08-26][2026-08-26]：180°覆盖层按媒体名实际底部重新定位，避免媒体名重叠。
  - 验证：旋转位置回归 1/1、显示端相关回归 41/41、显示端集成回归 9/9、`render.smoke.js` 和 `node --check` 通过。
