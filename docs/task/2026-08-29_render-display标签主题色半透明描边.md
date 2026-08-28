# 任务：render-display 标签增加半透明主题色描边

## 任务描述

`render-display` 进度条外的设备名、`M`、`GPU` 和 `VRAM` 标签在复杂媒体背景上对比度不足，需要与显示端时间、媒体名保持一致的固定文字效果，并增加主题色外描边。

## Design 需求

- 进度条外标签使用固定白色文字和固定黑色阴影。
- 增加 1px 当前主题强调色外描边。
- 描边使用约 65% 不透明度，避免主题色过亮；保留纯色回退。
- 进度条、填充色和条内数值文字保持不变。

## Spec 设计

- `res/tasks/render-display/render.js` 的 `makeBar()` 为 `lbl` 写入固定白字、黑色阴影和主题描边。
- 先写纯色 `--accent-color` 描边，再写 `color-mix(in srgb, ... 65%, transparent)` 半透明描边；不支持 `color-mix()` 时使用纯色回退。
- 标签样式继承显示端根节点主题变量，旋转和设备名避让逻辑不变。

## 受影响的功能模块和代码

- `res/tasks/render-display/render.js`
- `tests/render-display-theme-label.test.js`
- `docs/design/render-display-inline-text.md`
- `docs/spec/monitor-system.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. 检查进度条外标签为固定白色文字。
2. 检查标签保留固定黑色阴影。
3. 检查标签具有 1px 主题色描边和半透明 `color-mix()` 实现。
4. 检查条内数值、进度条颜色、旋转和设备名避让逻辑不变。

## 兼容性测试

- 支持 `color-mix()` 的 Chromium/WebView 使用 65% 半透明主题色。
- 不支持 `color-mix()` 时退回纯色主题描边。
- 90/180/270 度旋转、多来源和 GPU/VRAM 数据场景保持原布局。

## 性能测试

- 仅修改动态标签的 CSS 字符串，不增加定时器、网络请求或数据处理。

## 风险评估

- 半透明描边在极亮或同色媒体背景上可能不够明显，但固定白字和黑色阴影仍保留基础可读性。
- `color-mix()` 为 CSS 绘制增强，不支持的运行环境会自动使用纯色回退。

## 未明确需求

- 已确认：进度条外文字按时间和媒体名相同方式处理，主题色描边使用半透明效果。

## 预计工时

约 15 分钟，包含样式、契约测试和文档同步。
