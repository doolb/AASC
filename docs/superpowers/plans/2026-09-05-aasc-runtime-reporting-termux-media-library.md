# AASC Runtime Reporting and Termux Media Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主服务器和 Termux 子服务器通过 AASC 注册/心跳上报运行数据，并保证空媒体库时仍可从控制端添加媒体库。

**Architecture:** 节点连接器在注册和每次心跳时调用运行数据采集函数，将显示端数、控制端数和媒体库数放入 `runtime` 对象；主服务器注册表校验并保存该对象，节点目录快照原样返回。媒体库页面在空列表分支也渲染添加按钮，媒体库创建继续通过当前服务器的本地 `/api/media-libraries` 接口完成，不通过主服务器代理子服务器的写操作。

**Tech Stack:** Node.js、Express、WebSocket、原生浏览器 JavaScript、Node test runner。

**Spec:** `docs/design/aasc.md`、`docs/spec/aasc.md`、`docs/spec/sub-server.md`

## Global Constraints

- 使用 `const/let`，不使用 `var`。
- 异步操作使用 `async/await`，错误处理使用 `try-catch`。
- 运行数据只展示节点实际已经上报的值，不用旧字段默认值制造假数据。
- 暂不实现权限认证、主服务器远程媒体库写操作和自动发现。
- 不修改 `logs/`、`3rd/` 和模型文件。

### Task 1: Define runtime telemetry contract and tests

**Files:**
- Modify: `docs/design/aasc.md`
- Modify: `docs/spec/aasc.md`
- Modify: `docs/spec/sub-server.md`
- Create: `docs/task/20260905_AASC节点运行数据与Termux媒体库.md`
- Modify: `tests/aasc-node-protocol.test.js`
- Modify: `tests/aasc-node-connector.test.js`
- Modify: `tests/aasc-server-registry.test.js`

- [x] **Step 1: Write the failing protocol/registry/connector tests**
- [x] **Step 2: Run the focused tests and confirm they fail because runtime is not yet handled**

### Task 2: Report and expose runtime data

**Files:**
- Modify: `src/framework/aasc/node-protocol.js`
- Modify: `src/framework/aasc/node-connector.js`
- Modify: `src/framework/aasc/server-registry.js`
- Modify: `src/apps/server/boot/server-app.js`

**Interface:**

```text
runtime = {
    displayCount: 非负整数,
    controlCount: 非负整数,
    libraryCount: 非负整数
}
```

- [x] **Step 1: Implement runtime normalization and registry snapshot preservation**
- [x] **Step 2: Pass dynamic runtime getter to the child connector and main registry heartbeat**
- [x] **Step 3: Run the focused runtime tests and confirm they pass**

### Task 3: Keep the empty media library manageable

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`
- Create or modify: `tests/media-library-ui.test.js`

- [x] **Step 1: Write the failing empty-list rendering test**
- [x] **Step 2: Run the UI test and confirm the add button is absent before the fix**
- [x] **Step 3: Render `+ 添加` in the empty-library branch**
- [x] **Step 4: Run the UI test and confirm the empty state is usable**

### Task 4: Update project records and verify

**Files:**
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [x] **Step 1: Record completed behavior and remove the completed item from todo**
- [x] **Step 2: Run the relevant npm test script, syntax checks and `git diff --check`**
- [x] **Step 3: Review the diff and leave unrelated workspace changes untouched**
