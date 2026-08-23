# Task 6 修复报告：浮动文本模式设置入口

## 修复目标

修复审查报告指出的唯一 Important：浮动快捷控制面板缺少“文本模式”设置入口。

## 根因

`Controls.showTextModePanel()` 已构造并发送完整的 `textStyle`，但 `upload.html` 的浮动文本分页区域和 `FloatingControl` 仅提供 `textPlayback` 控制，没有设置入口。

## 实现

- 浮动文本分页区域新增 `floatingTextModeSettingsBtn`，点击调用 `FloatingControl.showTextModePanel()`。
- `FloatingControl.showTextModePanel()` 委托 `Controls.showTextModePanel()`，不复制表单、默认值或 WebSocket 发送逻辑。
- 因此浮动入口与主面板都发送 `{ background: "#FFF4B8", color: "#333333", fontSize, lineHeight, pageMargin }`。

## TDD 证据

1. 新增“浮动文本模式入口复用主面板的完整 textStyle 设置协议”测试。
2. 执行 `node --test tests/text-media-controls.test.js`：新增断言先因缺少 `floatingTextModeSettingsBtn` 失败。
3. 增加入口和委托方法后，同一 focused 测试 5/5 通过。

## 验证

- `node --test tests/text-media-controls.test.js`：5/5 通过。
- `node --check src/apps/web-mediacenter/ui/public/js/floating-control.js`：通过。
- `node --check src/apps/web-mediacenter/ui/public/js/controls.js`：通过。
- `git diff --check`：通过。

## 兼容性与范围

未改动主面板文本播放、`textPlayback`、`playlistControl`、HTML、audio 或 chat 路径；浮动入口仅复用现有主面板的文本样式协议。
