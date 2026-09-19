# 控制端与显示端 render 刷新诊断

## 状态

2026-09-19 增加临时诊断埋点，用于确认控制端显示面板 `DeviceList.render()` 与显示端
`render-display` 的高频更新来源。当前开关默认关闭，避免现场持续输出日志；重新开启后日志只做
1 秒窗口汇总，不改变刷新行为。

## 目标

- 现场诊断曾记录控制端“语音播报 (TTS)”输入框 `ttsTextInput` 的初始化、焦点、鼠标、输入和 DOM 变化，确认历史建议弹窗关闭与输入框失焦有关。
- 记录服务端 `displayList` 广播的调用来源和频率。
- 记录控制端收到 `displayList`、调用 `setDisplayList` 和 `render` 的频率。
- 记录显示端 `task:renderUpdate` 按实例的更新频率。
- 通过同一秒窗口内的计数和来源，区分显示列表刷新与渲染任务数据刷新。

## 范围

本次只增加浏览器控制台和服务端标准输出诊断埋点，不改变定时器、WebSocket 协议、DOM 更新和任务状态。
通用 render 诊断开关 `ENABLE_RENDER_REFRESH_DIAGNOSTICS` 仍默认值为 `false`；TTS 输入框诊断单独输出
`[TTS输入诊断]`，不发送 TTS 请求、不改变输入框内容；问题确认后已移除该临时监听，输入历史方案单独记录在 `docs/design/tts-input-history.md`。
