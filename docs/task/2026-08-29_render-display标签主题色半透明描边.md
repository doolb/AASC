# 任务：显示端文字增加半透明主题色斜向投影

## 任务描述

`render-display` 进度条外的设备名、`M`、`GPU` 和 `VRAM` 标签，以及显示端时间、媒体名在复杂媒体背景上对比度不足，需要保持固定文字效果，并增加右下方 2px、无模糊的主题色斜向投影。

## Design 需求

- 进度条外标签、时间文本和媒体名使用固定白色文字和固定黑色阴影。
- 增加右下方 2px、无模糊的当前主题强调色斜向投影。
- 主题色投影使用约 65% 不透明度，避免主题色过亮；保留纯色回退。
- 不使用 `-webkit-text-stroke` 或元素盒子的 `inset box-shadow`，避免出现文字轮廓、外部矩形框和额外底部投影。
- 进度条、填充色和条内数值文字保持不变。

## Spec 设计

- `res/tasks/render-display/render.js` 的 `makeBar()` 为 `lbl` 写入固定白字、黑色阴影和主题色斜向投影。
- `src/apps/web-mediacenter/ui/public/css/display.css` 的 `#timeDisplay`、`#fileNameDisplay` 使用相同的文字效果和主题色斜向投影。
- 先写 1px 纯色 `--accent-color` 无模糊投影，再写 `color-mix(in srgb, ... 65%, transparent)` 半透明投影；不支持 `color-mix()` 时使用纯色回退。
- 标签、时间和媒体名样式继承显示端根节点主题变量，旋转和设备名避让逻辑不变。

## 受影响的功能模块和代码

- `res/tasks/render-display/render.js`
- `src/apps/web-mediacenter/ui/public/css/display.css`
- `tests/render-display-theme-label.test.js`
- `tests/display-theme-sync.test.js`
- `docs/design/render-display-inline-text.md`
- `docs/spec/monitor-system.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. 检查进度条外标签、时间文本和媒体名为固定白色文字。
2. 检查三类文字保留固定黑色阴影。
3. 检查三类文字具有右下方 2px 主题色无模糊斜向投影和半透明 `color-mix()` 实现。
4. 检查三类文字不使用 `-webkit-text-stroke` 或 `inset box-shadow`。
5. 检查条内数值、进度条颜色、旋转和设备名避让逻辑不变。

## 兼容性测试

- 支持 `color-mix()` 的 Chromium/WebView 使用 65% 半透明主题色斜向投影。
- 不支持 `color-mix()` 时退回纯色主题斜向投影。
- 90/180/270 度旋转、多来源和 GPU/VRAM 数据场景保持原布局。

## 性能测试

- 仅修改动态标签和显示端文字的 CSS，不增加定时器、网络请求或数据处理。

## 风险评估

- 半透明斜向投影在极亮或同色媒体背景上可能不够明显，但固定白字和黑色阴影仍保留基础可读性。
- `color-mix()` 为 CSS 绘制增强，不支持的运行环境会自动使用纯色回退。

## 未明确需求

- 已确认：进度条外文字、时间和媒体名统一保留固定黑色阴影，并增加右下方 2px、无模糊的半透明主题色斜向投影。

## 预计工时

约 15 分钟，包含样式、契约测试和文档同步。
