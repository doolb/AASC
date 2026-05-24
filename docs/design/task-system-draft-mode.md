# 任务系统草稿模式设计

## 概述

在远程任务系统中引入统一的草稿模式（Draft Mode）：所有任务实例从 `draft` 状态开始，用户可编辑参数后再执行，已完成实例可重置为草稿重新运行。

## 设计目标

1. 消除 `autoRun` 概念，统一实例生命周期
2. 所有实例从 `draft` 启动，用户显式触发执行
3. 已完成/失败/已停止的实例可 rerun 回到 `draft` 编辑再运行
4. 服务重启时自动恢复正在运行的服务

## 状态机

```
submit → draft (可编辑参数)
          │
          │ task:run
          ▼
       pending → preparing → running
          │                    │
          │                    ├─ completed
          │                    ├─ failed
          │                    └─ stopped → task:rerun → draft
          │                    (模式)
          └── display 转发 ──── pending_forward ──────┘
```

## 核心规则

1. **所有实例从 draft 开始** — `submit()` 始终返回 `status: 'draft'`
2. **显式触发执行** — `task:run` 将 draft → running
3. **rerun 不克隆** — `task:rerun` 将 completed/failed/stopped 重置回 draft（同实例、同目录）
4. **draft 可编辑** — 仅在 draft 状态下允许修改参数
5. **服务自动恢复** — `restoreAutoStartServices()` 分两步：`submit()` → `runInstance()`

## 接口设计

### submit(task)
- 始终创建实例，status = 'draft'
- 保存文件/参数到磁盘
- 返回 `{ taskName, instanceId, status: 'draft' }`

### runInstance(taskName, instanceId)
- 从 index 读取实例
- 校验 status 为 draft/created
- 执行完整的生命周期（pending → preparing → running → completed/failed）
- 返回执行结果

### rerunInstance(taskName, instanceId)
- 校验 status 为 completed/failed/stopped
- 重置 status = 'draft'
- 保留参数和历史日志
- 返回 `{ taskName, instanceId, status: 'draft' }`

### restoreAutoStartServices()
- 扫描 index 中 status='running' 且 mode='service' 的实例
- 调 submit() → 创建 draft
- 调 runInstance() → 启动服务

## WebSocket 协议变更

| 消息 | 变更 |
|------|------|
| `task:submit` | 不再检查 autoRun，始终返回 draft |
| `task:run` | 接受 `draft` 和 `created`（兼容旧数据） |
| `task:rerun` | **新增**，重置同实例为 draft |
| `task:update_instance_params` | 仅 draft 状态允许 |
| **移除** | `autoRun` 概念，前端不再发 autoRun 参数 |

## 向后兼容

- 旧 index 中的 `status:'created'` → 启动时自动修正为 `'draft'`
- `task:run` 同时接受 `'created'` 和 `'draft'`
- 现有内置任务不受影响（运行时只看 params）
- 服务器重启时，`restoreAutoStartServices()` 恢复运行中的服务

## 受影响文件

| 文件 | 改动 |
|------|------|
| `src/apps/server/modules/task-engine/task-manager.js` | submit/runInstance/rerunInstance 重构 |
| `src/apps/server/modules/task-engine/web-socket-handler.js` | 新增 task:rerun 处理，移除 autoRun |
| `src/apps/web-mediacenter/ui/public/js/task-panel.js` | UI 适配：草稿编辑、rerun 按钮、状态图标 |
| `res/tasks/*/results/index.json` | 旧数据自动迁移 |
