# 主服务器管理子服务器媒体库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主控制端完整管理在线子服务器媒体库，并在播放时优先使用子服务器原始 URL，无法直连时通过主服务器同源代理回退。

**Architecture:** 主服务器通过现有 AASC 节点 WebSocket 向子服务器下发媒体库配置和文件操作命令；大文件上传和媒体读取由主服务器提供同源 HTTP 代理并转发到子服务器。聚合索引保留子服务器原始 URL，同时提供主服务器备用代理 URL，控制端不再把 `nodeId::libraryId` 当作真实媒体库 ID发送给本地接口。

**Tech Stack:** Node.js、Express、ws、原生浏览器 Fetch、Node.js `http/https` 流式代理、Node Test Runner。

**Spec:** `docs/design/aasc.md`、`docs/spec/aasc.md`、`docs/task/20260906_主服务器控制端聚合子服务器媒体库.md`

## Global Constraints

- 子服务器必须主动连接主服务器 `/server` WebSocket；主服务器只通过已连接节点下发管理命令。
- 当前不实现权限认证，沿用现有 AASC 无认证边界。
- 子服务器媒体库配置只持久化在目标子服务器，主服务器不保存远程账号密码。
- 播放使用子服务器原始 URL 优先，主服务器同源代理仅作为备用。
- 遵守 `const/let`、`async/await`、`try-catch` 和中文详细注释规范。
- 不修改日志、`3rd`、模型和与本任务无关的用户改动。

---

### Task 1: 同步设计、规格和任务文档

**Files:**
- Modify: `docs/design/aasc.md` 的主服务器媒体库聚合章节
- Modify: `docs/spec/aasc.md` 的主服务器媒体库聚合伪代码
- Modify: `docs/task/20260906_主服务器控制端聚合子服务器媒体库.md`
- Create: `docs/superpowers/plans/2026-09-07-remote-media-library-management.md`

**Interfaces:**
- Produces: 远程媒体库管理命令、主控 REST 路由、直连播放和代理回退的统一契约。

- [x] **Step 1: 写入设计边界**

  将原“远程媒体库只读”改为：配置和文件操作通过节点 WebSocket；播放直接使用子服务器 URL；主服务器提供代理回退；远程只读属性仍由目标子服务器决定。

- [x] **Step 2: 写入伪代码**

  记录 `nodeId`、`sourceLibraryId`、`directUrl`、`proxyUrl` 的数据流，以及本地/远程操作的路由选择规则。

- [x] **Step 3: 补充任务验收项**

  记录在线子服务器添加、编辑、删除、上传、建目录、删目录、删除文件、设默认、直连播放、代理回退和 404 错误显示场景。

### Task 2: AASC 远程媒体库服务端契约

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/framework/aasc/media-index-service.js`
- Test: `tests/aasc-media-index.test.js`
- Test: `tests/aasc-remote-media-library.test.js`

**Interfaces:**
- Produces: `media.library.add/update/remove/delete-file/create-folder/delete-folder/set-default` 节点命令。
- Produces: `/api/aasc/servers/:nodeId/media-libraries...` 主服务器远程管理接口。
- Produces: `/api/aasc/servers/:nodeId/media-libraries/:libraryId/proxy/*` 同源媒体代理。

- [x] **Step 1: 写远程 URL 和命令的失败测试**

  覆盖远程索引生成主服务器备用代理 URL、保留子服务器直连 URL、远程节点不可用时返回明确错误，以及服务端命令只允许白名单操作。

- [x] **Step 2: 运行新增测试确认失败**

  Run: `node --test tests/aasc-media-index.test.js tests/aasc-remote-media-library.test.js`

  Expected: 新增断言因代理 URL 和远程操作契约尚未实现而失败。

- [x] **Step 3: 实现远程节点媒体库命令**

  主服务器验证目标节点为在线、非主服务器且存在连接句柄；通过 `aascServerRegistry.request` 下发命令。子服务器收到命令后调用 `mediaLibraryManager`，添加本地媒体库后动态注册静态路由，并返回不含密码的库信息。

- [x] **Step 4: 实现主服务器同源媒体代理**

  主服务器根据注册表中的子服务器 URL请求子服务器 `/api/media-libraries/:libraryId/proxy/*`，转发 `Range`、`Content-Type`、`Content-Length`、`Content-Range` 和 `Accept-Ranges`，非 2xx 状态保持原状态返回。

- [x] **Step 5: 实现聚合索引 URL 双轨输出**

  远程条目保留 `directUrl` 和 `sourceUrl`，控制端播放字段 `url` 默认使用子服务器原始 URL，同时提供 `proxyUrl`供回退和错误重试使用；不把密码放入索引。

- [x] **Step 6: 运行新增测试确认通过**

  Run: `node --test tests/aasc-media-index.test.js tests/aasc-remote-media-library.test.js`

  Expected: 新增服务端契约测试全部通过。

### Task 3: 控制端远程媒体库操作和 404 处理

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/server-list.js`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Modify: `src/apps/web-mediacenter/ui/public/css/media-library.css`
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`
- Test: `tests/media-library-ui.test.js`

**Interfaces:**
- Consumes: 聚合索引中的 `ownerNodeId`、`sourceLibraryId`、`directUrl`、`proxyUrl`。
- Consumes: 主服务器远程媒体库管理 API。
- Produces: 目标服务器选择、远程完整操作、直连失败代理回退和可读错误提示。

- [x] **Step 1: 写 UI 失败测试**

  覆盖添加弹窗选择子服务器后使用远程 API、远程库不会生成本地复合 ID请求、播放首选 `directUrl`、直连失败后改用 `proxyUrl`，以及 404 显示完整接口状态。

- [x] **Step 2: 运行 UI 测试确认失败**

  Run: `node --test tests/media-library-ui.test.js`

  Expected: 新增远程添加、播放回退或错误提示断言失败。

- [x] **Step 3: 实现媒体库目标服务器选择**

  添加弹窗显示主服务器和在线子服务器；远程目标提交到 `/api/aasc/servers/:nodeId/media-libraries`，本地目标继续使用 `/api/media-libraries`。

- [x] **Step 4: 实现远程操作路由选择**

  为上传、删除文件、建目录、删目录、编辑、删除媒体库和设默认统一构造本地或远程接口，使用真实 `sourceLibraryId`，不发送 `nodeId::libraryId`。

- [x] **Step 5: 实现直连优先和代理回退**

  媒体条目首选子服务器 `directUrl`；图片、视频和播放预览加载失败时切换 `proxyUrl`并只提示一次错误。发送给显示端的媒体消息携带 `fallbackUrl`，显示端资源加载失败时自动切换代理。远程只读库隐藏文件写入控件，可编辑库配置以解除只读或删除媒体库。

- [x] **Step 6: 接入远程批量播放**

  批量播放请求携带 `remoteNodeId` 和真实 `sourceLibraryId`；主服务器通过 `media.library.playlist` 请求子服务器生成列表，列表中的媒体继续使用子服务器直连 URL。

- [x] **Step 7: 优化服务器页面和响应错误**

  子服务器卡片增加“添加媒体库”入口；媒体库列表显示节点来源、连接状态和读写状态；所有 Fetch 请求先检查 `response.ok`，把 404 的路径和状态展示给用户。

- [x] **Step 8: 运行 UI 测试确认通过**

  Run: `node --test tests/media-library-ui.test.js`

  Expected: 远程目标、远程操作和直连回退测试全部通过。

### Task 4: 全量验证与文档收尾

**Files:**
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `tests/aasc-media-index.test.js`
- Modify: `tests/media-library-ui.test.js`

**Interfaces:**
- Consumes: Tasks 1-3 的实现和测试。
- Produces: 完整验证记录、已完成任务移除和变更日志。

- [x] **Step 1: 运行完整测试**

  Run: `npm test`

  Expected: 全部测试通过；若存在与本任务无关的既有失败，单独记录测试名称和原因。

- [x] **Step 2: 做静态路由和文档核对**

  检查主服务器和子服务器的 `/server`、`/display`、`/control`、媒体库 API 和代理路径；检查所有新增命令均有白名单处理器和错误返回。

- [x] **Step 3: 更新任务状态**

  从 `docs/todo.md` 删除“媒体写入代理”已完成部分，只保留认证和 Android 自动恢复等未完成事项；在 `changelog.md` 记录文件、接口、播放策略和测试结果。

- [x] **Step 4: 查看最终差异**

  Run: `git status --short` and `git diff --stat`

  Expected: 只包含本次功能和文档变更；日志、`3rd`、模型及其他用户改动不被纳入。
