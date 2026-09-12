# 显示端代码变化检测远端配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 AASC 远端配置流程，让控制端配置显示端代码变化检测间隔，并实时同步到显示端。

**Architecture:** 控制端只通过现有 `/control` WebSocket 发送配置消息；服务端校验后使用现有 `config.set` 持久化，并用显示端 WebSocket 推送当前配置。显示端继续调用既有 `/api/display-version` 获取文件版本，只把检测间隔改为服务端下发的运行时配置，不新增配置读取或保存 HTTP 接口。

**Tech Stack:** Node.js、Express、`ws`、原生 HTML/CSS/JavaScript、Node.js `node:test`。

**Spec:** `docs/spec/display-version-remote-config.md`

## Global Constraints

- 配置读写必须走 AASC 现有 WebSocket 远端配置流程，不新增独立配置读取/保存 HTTP 接口。
- `/api/display-version` 只负责返回显示端静态文件版本时间戳。
- 检测间隔以毫秒在协议中传输，控制端以秒展示；有效范围为 5–300 秒，默认 30 秒。
- 服务端必须在显示端连接时补发当前配置，更新时广播到已连接显示端。
- 保留现有显示端代码变化检测、版本变化后 `location.reload()` 和失败重试行为。
- 修改代码前先同步 design/spec/task 文档；完成后同步 `todo.md`、`changelog.md` 和项目规则。

---

### Task 1: 补齐需求设计、实现规格和项目远端配置规则

**Files:**
- Create: `docs/design/display-version-remote-config.md`
- Create: `docs/spec/display-version-remote-config.md`
- Create: `docs/task/20260912_显示端代码变化检测远端配置.md`
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `AGENTS.md`
- Modify: `docs/rules.md`
- Modify: `docs/todo.md`

- [x] **Step 1: 写入设计与伪代码规格**

记录控制端 WebSocket → 服务端校验/`config.set` → 显示端广播/连接补发 → 显示端定时器更新的消息流程，并明确没有独立配置 HTTP API。

- [x] **Step 2: 将远端配置流程写入项目规则**

在 `AGENTS.md` 和 `docs/rules.md` 增加通用约束：已有 AASC/WebSocket 配置能力必须复用现有远端配置消息模式，服务端负责权威持久化和广播，不能为同一配置另建 HTTP GET/POST 读写接口。

- [x] **Step 3: 创建任务文档并登记进行中事项**

任务文档记录需求、受影响文件、测试、兼容性、性能和风险；在 `docs/todo.md` 增加本任务进行中条目。

### Task 2: 先写服务端远端配置契约测试

**Files:**
- Create: `tests/display-version-remote-config.test.js`
- Modify: `tests/display-version-watch.test.js`

- [x] **Step 1: 写失败测试**

断言服务端拥有默认值和 5–300 秒规范化逻辑，控制端消息使用 WebSocket 配置消息，服务端持久化并向显示端发送配置；前端断言控制端存在配置输入/发送逻辑、WebSocket 客户端分发配置消息、显示端监听并更新检测间隔。

- [x] **Step 2: 运行定向测试确认失败**

Run: `node --test tests/display-version-remote-config.test.js tests/display-version-watch.test.js`

Expected: FAIL，失败原因是远端配置消息、配置 UI 和可变定时器尚未实现。

### Task 3: 实现服务端配置权威链路

**Files:**
- Modify: `src/apps/server/modules/config/config-app-service.js`
- Modify: `src/apps/server/boot/server-app.js`

- [x] **Step 1: 增加配置默认值和规范化函数**

使用 `display.versionCheckIntervalMs` 保存配置；缺失、非有限值或越界值回退到 30000，并把有效值限制到 5000–300000 毫秒。

- [x] **Step 2: 增加控制端 WebSocket 消息处理**

控制端发送 `updateDisplayVersionConfig` 后，服务端校验并 `config.set`，通过 `displayVersionConfig` 回复当前值并广播给控制端及显示端；控制端连接初始化时发送当前 `displayVersionConfig`。

- [x] **Step 3: 在显示端连接初始化时补发配置**

显示端建立 WebSocket 后收到当前规范化间隔，保证重连和刷新后不依赖独立配置读取接口。

- [x] **Step 4: 运行服务端定向测试**

Run: `node --test tests/display-version-remote-config.test.js`

Expected: 服务端相关契约通过。

### Task 4: 实现控制端和显示端运行时配置

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `tests/display-version-watch.test.js`

- [x] **Step 1: 增加控制端设置项**

在系统设置增加“显示端代码检测间隔”输入和保存按钮，以秒展示；初始化和服务端推送时更新输入值，保存时只发送 WebSocket 消息。

- [x] **Step 2: 接入控制端 WebSocket 消息分发**

把 `displayVersionConfig` 转交给 `Settings`，让多个控制端保持同一权威值。

- [x] **Step 3: 改造显示端定时器**

以 30000 毫秒为初始值，收到 `displayVersionConfig` 后规范化并清除旧定时器、按新间隔重新调度；版本变化仍执行 reload，HTTP 失败仍按当前间隔重试。

- [x] **Step 4: 运行前端定向测试和语法检查**

Run: `node --test tests/display-version-remote-config.test.js tests/display-version-watch.test.js`

Expected: 所有显示端版本检测和远端配置契约通过；再运行 `node --check src/apps/server/boot/server-app.js`、`node --check src/apps/web-mediacenter/ui/public/js/websocket.js`。

### Task 5: 同步文档并完成验证

**Files:**
- Modify: `docs/design/display-version-remote-config.md`
- Modify: `docs/spec/display-version-remote-config.md`
- Modify: `docs/task/20260912_显示端代码变化检测远端配置.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] **Step 1: 同步实现状态**

记录最终消息名、配置键、范围、默认值、兼容行为和没有配置 HTTP 读写接口的结论；从 `todo.md` 删除完成事项。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 记录完整测试结果；若出现本任务之外的既有失败，保留失败证据并在任务/changelog 中注明，不修改无关功能。

- [x] **Step 3: 检查变更范围**

Run: `git diff --check`；`git diff --stat`；`git status --short`

Expected: 只确认本任务新增或修改的文件，保留工作区中已有的用户改动，不提交无关文件。
