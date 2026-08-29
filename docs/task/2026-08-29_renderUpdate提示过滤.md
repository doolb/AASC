# 任务：过滤高频 renderUpdate 提示

## 任务描述

控制端持续弹出 `renderUpdate` 命令确认提示。原因是显示端对每次高频 `task:renderUpdate` 和 `hardwareStats` 数据刷新发送了 `commandAck`，服务端再广播到控制端，聊天模块将其转换成 Toast/Tips。

## Design 需求

- 高频渲染数据只负责刷新显示端任务，不发送命令回执。
- 保留播放、控制、TTS、提醒等显式控制命令的 `commandAck`。
- 控制端不再因监控数据刷新持续弹出提示。

## Spec 设计

- `display.html` 的 `task:renderUpdate` 分支仅分发 `data`。
- `display.html` 的兼容 `hardwareStats` 分支仅广播给活跃渲染任务。
- `commandAck` 协议文档明确只表示显式命令确认。

## 受影响的功能模块和代码

- `src/apps/web-mediacenter/ui/public/display.html`
- `tests/display-render-update-ack.test.js`
- `docs/design/monitor-system.md`
- `docs/spec/monitor-system.md`
- `docs/spec/websocket.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. 检查 `task:renderUpdate` 分支仍调用对应渲染更新函数。
2. 检查 `hardwareStats` 分支仍向所有活跃任务分发数据。
3. 检查两个高频分支均不调用 `sendCommandAck`。
4. 检查播放类显式命令仍保留 `commandAck`。
5. 运行相关 Node 测试、语法检查和 `git diff --check`。

## 兼容性测试

- 新版任务链 `task:renderUpdate` 正常更新。
- 旧版 `hardwareStats` 转发仍能更新监控任务。
- 控制端已有显式命令确认流程不变。

## 性能测试

- 高频监控刷新不再产生回执消息、服务端广播和控制端 Toast，减少 WebSocket 与 DOM 更新。

## 风险评估

- 若外部调用方错误地依赖 `renderUpdate` 回执，将不再收到该回执；该消息本身没有命令执行确认语义，且控制端原先只将其作为提示显示。

## 未明确需求

- 无。

## 预计工时

约 10 分钟，包含契约测试和文档同步。
