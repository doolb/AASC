# 控制端 AI 角色自管理 role.md 和 history.md

## 任务描述

控制端聊天 AI 角色用于持续执行任务。角色启动 Claude 时加载自己的 `role.md` 与 `history.md`，并允许当前角色自行维护这两个文件；不使用 workgroup 任务队列，也不在每条消息前重新读取文件。

## Design 需求

- 当前角色直接处理控制端消息，角色由用户添加、删除和切换。
- `workgroup/roles/<角色名>.md` 保存稳定角色定义，由当前角色自行维护。
- `workgroup/members/control-<角色名>/history.md` 保存当前角色的重要任务经验和最近记录。
- 普通消息不强制更新 `history.md`。
- 当前角色不能修改其他角色、项目规则和服务器控制规则。

## Spec 设计

- `AiRolesService` 在 Claude 进程启动前组合角色定义、历史摘要和自管理规则。
- 组合结果写入角色的 `prompt.txt`，由 Claude 的 `--append-system-prompt-file` 注入系统提示词。
- 角色进程存活期间复用启动快照；下一次新建 Claude 进程时重新加载最新文件。
- `poll.js` 保持原有 workgroup 任务队列，不接管控制端角色聊天。

## 受影响模块和文件

- `src/apps/server/modules/ai-roles/ai-roles-service.js`
- `src/apps/server/modules/ai-roles/ai-roles-service.test.js`
- `docs/design/ai-roles.md`
- `docs/spec/ai-roles.md`
- `docs/task/2026-08-21_控制端AI角色自管理role和history.md`
- `docs/design.md`、`docs/spec.md`、`changelog.md`

## 自测用例

1. 启动提示词包含当前角色 `role.md` 内容。
2. 启动提示词包含当前角色 `history.md` 内容或摘要。
3. 启动提示词包含只能维护当前角色文件的规则。
4. Claude 进程存活期间修改源文件，后续消息不重新生成启动提示词。
5. 新建 Claude 进程时重新加载最新角色文件。

## 兼容性测试

- 不改变控制端角色 WebSocket 协议。
- 不改变 `poll.js` 任务队列和 workgroup 成员历史。
- 不操作用户手动启动的服务器进程。

## 风险评估

- 角色自管理依靠 Claude 系统提示词约束，不是 OS 级文件权限隔离。
- 角色文件变更在当前 Claude 进程中不会自动刷新系统提示词，需下一次新建角色进程生效。

## 预计工时

- 1 小时

## 执行结果

- ✅已完成 [2026-08-21][2026-08-21] 控制端 AI 角色启动时注入当前 `role.md`、`history.md` 和自管理规则
  - 改动文件：`src/apps/server/modules/ai-roles/ai-roles-service.js`、`src/apps/server/modules/ai-roles/ai-roles-service.test.js`
  - 验证：控制端 AI 角色 8 项测试通过，AI 角色全模块 36 项测试通过，workgroup 核心/文件系统 28 项测试通过
