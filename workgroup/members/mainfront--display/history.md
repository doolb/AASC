# 专长画像
{"排查":1,"任务引擎":2,"WebSocket":1,"显示端":2,"render-display":1,"重连恢复":2,"服务器重启":1,"display_offline":1}

## 经验约定
- 任务引擎的孤儿恢复机制（_orphanedTasks/retryOrphanedTasks/reforwardStaleDisplayTasks）与实例表 this.instances 都是纯内存态，服务重启即失；restoreAutoStartServices 只兜 mode==='service' && status==='running'，display_offline 是持久态与内存态的脱节点。
- TaskManager 运行日志（writeInstanceLog → run.log）与 server.jsonl 结构化日志是两套输出：重启后日志轮换到 server.1.jsonl，且 TaskManager 的 console.log 不进 jsonl，排查时以 res/tasks/*/results/*/run.log 为准。
- render-display 是用户任务（res/tasks/render-display/task.js，target=display, mode=service），非 builtin；靠 .task-links.json 由 win-monitor/system-stats 等源实例驱动，重连恢复必须保留源链路（sourceInstanceId）才能重建。
- 任务引擎孤儿恢复机制（_orphanedTasks/retryOrphanedTasks/reforwardStaleDisplayTasks）与实例表 this.instances 都是纯内存态，服务重启即失；display_offline 是持久态（results/index.json）与内存态的脱节点，恢复的关键是让磁盘上的 display_offline 与内存孤儿表在重启后重新对齐。
- _forwardToDisplay 是 fire-and-forget（runInstance 未 await），readTaskFiles 异步完成后才真正转发/入队；写 task-manager 相关测试必须轮询等待异步完成，不能固定延时或同步断言。
- 服务器是用户手动启动的活跃进程（父进程 lxqt-session、--no-tui，非 supervisor 管理）；对共享服务器做重启冒烟前需先评估对现有显示端/控制端 WS 连接的影响，可改用只读冒烟验证收集逻辑。

## 最近记录
- {"id":"20260818-0934-001","title":"排查：显示端重连后 render-display 任务不自动恢复","summary":"根因：render-display 断连恢复完全依赖内存态 _orphanedTasks / this.instances，服务器重启后 restoreAutoStartServices()（task-manager.js:60）只恢复 status==='running' 的服务实例，display_offline 实例（44fbce2d）既不进内存也不进孤儿表；显示端重连时 server-app.js:2762-2763 的 retryOrphanedTasks/reforwardStaleDisplayTasks 均只遍历内存，找不到该实例 → 永不自动恢复。修复建议：①restoreAutoStartServices 把 display_offline 服务实例也恢复进 _orphanedTasks；②显示端连接时扫描各任务 index.json 中 status==='display_offline' && displayId===当前显示端 的实例回填 _orphanedTasks 再走 retryOrphanedTasks，reforwardStaleDisplayTasks 加磁盘兜底；③retryOrphanedTasks 改为转发成功后再删孤儿记录；④修复 server-app.js:2857 旧连接 close 无条件 displayClients.delete(displayId) 误删新连接条目的重连竞态。最近三次 sleep/autoTts 改动仅涉 display.html 媒体/睡眠/TTS 逻辑，非回归来源。","tags":["排查","任务引擎","WebSocket","显示端","render-display","重连恢复"],"at":1787018724134}
- {"id":"20260818-1033-001","title":"实现：服务器重启后 display_offline 实例自动恢复（方案 A）","summary":"修复：restoreAutoStartServices() 在服务器重启后把磁盘上 display_offline 的显示端服务实例按 displayId 回填 _orphanedTasks（复用 handleDisplayDisconnect 孤儿结构，同 instanceId 去重、缺 displayId 跳过），显示端重连时由 retryOrphanedTasks(displayId) 自然接管，render-display 等显示端服务无需手动启停即自动恢复。","tags":["任务引擎","显示端","重连恢复","服务器重启","display_offline"],"at":1787029015653}
