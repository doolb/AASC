# 显示端身份与批量播放恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让显示端重连后按稳定 `displayId` 恢复设置和批量播放，并让控制端切换显示端时隔离各自的批量状态。

**Architecture:** 服务器在线连接继续使用 `displayId`，持久化状态改为以 `displayId` 为主键，连接 IP 只作为兼容旧数据的迁移线索、日志和展示字段。重连时分别发送通用显示设置恢复消息和批量播放断点消息；控制端切换目标时清理旧面板，并用新目标的 `displayState.currentPlaylist` 重绘。

**Tech Stack:** Node.js CommonJS、Node 内置 `node:test`、浏览器端原生 JavaScript、WebSocket JSON 消息。

**Spec:** `docs/design/display.md`、`docs/design/batch-playlist.md`、`docs/spec/config.md`、`docs/spec/batch-playlist.md`、`docs/spec/display-selection.md`

## Global Constraints

- 服务器状态持久化优先使用稳定 `displayId`，不能使用 IP 作为显示端唯一身份。
- Agent/测试显示端必须显式提供与真实显示端不同的 `displayId`；非显示 Agent 不注册 `/display`。
- 发送批量恢复消息时必须保留 `resumeIndex`、`resumeTime`、`resumeState`。
- 控制端只显示当前选中显示端的批量状态，没有批量状态时必须隐藏全部批量状态面板。
- 使用 `const/let`、`async/await`、`try-catch` 和中文注释，保留工作区中无关的用户改动。

### Task 1: 文档与失败测试

**Files:**
- Modify: `docs/design/display.md`
- Modify: `docs/design/batch-playlist.md`
- Modify: `docs/spec/config.md`
- Modify: `docs/spec/batch-playlist.md`
- Modify: `docs/spec/display-selection.md`
- Create: `docs/task/2026-08-22_显示端身份与批量状态恢复.md`
- Create: `tests/display-identity-batch-restore.test.js`

- [ ] 写出身份以 `displayId` 持久化、批量恢复同时发送 settings/playlist、切换无列表隐藏旧面板的失败测试。
- [ ] 运行测试确认失败原因对应缺少新行为。

### Task 2: 稳定显示端身份与状态持久化

**Files:**
- Modify: `src/apps/server/modules/config/config-app-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/framework/aasc/agents/index.js`

- [ ] 增加按 `displayId` 读取/更新状态的 API，首次读取时仅用旧 IP 状态做一次兼容迁移，并写入 `displayId`。
- [ ] 连接对象记录 `displayId`，所有显示端状态、播放进度、能力和 Agent 媒体控制写入显示端 ID 对应的状态。
- [ ] 保留 IP 作为设备事件和界面展示字段；显示端列表同时返回 `id` 与 `ip`，让 `agent-local` 与 `display-main` 可见区分。
- [ ] 运行身份和配置定向测试。

### Task 3: 批量重连恢复

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`

- [ ] 重连时先恢复通用设置，再恢复批量列表断点，避免批量分支跳过 rotation/fit/crop/volume/sleep/autoTts 等设置。
- [ ] 保证恢复消息顺序稳定，批量播放仍使用保存的索引、时间和暂停状态。
- [ ] 运行显示端恢复回归测试。

### Task 4: 控制端批量状态按显示端隔离

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/device-list.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`

- [ ] 切换显示端立即清理旧批量面板和临时预览缓存。
- [ ] `displayState` 无 `currentPlaylist` 时主动隐藏面板；有列表时按新目标恢复。
- [ ] `playlistProgress` 只更新当前显示端，避免后台显示端覆盖当前面板。
- [ ] 运行控制端 UI 静态回归测试。

### Task 5: 验证、文档收尾与提交

- [ ] 运行新增测试、批量/播放恢复/媒体 UI/Agent 相关串行测试和语法检查。
- [ ] 更新 `todo.md`、相关 design/spec、任务文档和 `changelog.md`。
- [ ] 仅暂存本需求改动，避开日志、任务结果、ViewBind 等用户已有改动。
- [ ] 提交 git，并记录提交号与验证结果。
