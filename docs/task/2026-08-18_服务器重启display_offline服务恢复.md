# 服务器重启后 display_offline 服务恢复

## 任务描述
修复服务器重启后，已持久化为 `display_offline` 的显示端常驻任务无法在显示端重连时自动恢复的问题。

## Design 需求
服务器启动时扫描任务索引：`running` 服务沿用立即恢复路径；`display_offline` 服务不立即转发，按 `displayId` 回填内存孤儿队列，等待显示端重连后恢复。相同实例不得重复收集，缺少 `displayId` 的记录跳过并告警。

## Spec 设计
`restoreAutoStartServices()` 对 `mode=service && status=display_offline` 调用 `_collectOfflineOrphan(entry)`。收集对象与 `handleDisplayDisconnect()` 使用相同字段结构，按 `displayId` 分组并以 `instanceId` 去重。显示端重连调用 `retryOrphanedTasks(displayId)`，通过 `rerunInstance()` 和 `runInstance()` 重新转发任务。

## 受影响模块和代码
- `src/apps/server/modules/task-engine/task-manager.js`
- `tests/task-engine-restore.test.js`
- `docs/design/remote-task-system.md`
- `docs/spec/remote-task-system.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例
- `display_offline` 按 `displayId` 回填孤儿队列且不进入内存实例表。
- 重复恢复扫描和重复收集不产生重复孤儿。
- 缺少 `displayId` 的记录被跳过。
- 显示端重连后孤儿实例重新进入运行流程并发送 `task:execute`。
- `running` 服务仍进入原有待转发队列，和 `display_offline` 队列互不冲突。

## 兼容性测试
- Node.js `node:test` 回归测试。
- 相关既有单元测试。
- 修改文件执行 `node --check`。

## 性能测试
启动扫描仅对任务索引中的 `display_offline` 服务创建轻量内存队列，不启动执行器、不读取任务文件、不转发网络消息；复杂度为任务实例数量线性扫描。

## 风险评估
- 缺少 `displayId` 的历史记录无法自动分组恢复，只记录警告。
- 显示端在恢复扫描完成前重连存在既有时序风险，仍由连接处理流程负责重试。
- 未改变 `running` 服务原有恢复路径。

## 预计工时
约 1 小时。

## 完成情况
- ✅已完成 [2026-08-18][2026-08-18] 实现恢复逻辑、补充 5 项回归测试并同步设计/spec/changelog/todo。
