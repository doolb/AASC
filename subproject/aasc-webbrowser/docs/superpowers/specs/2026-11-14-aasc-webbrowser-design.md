# AASC WebBrowser 会话管理设计规格

## 目标

在 `/mnt/AASC/subproject/aasc-webbrowser` 建立独立的浏览器会话管理服务，统一管理多个 Vivaldi/Chromium 浏览器实例、业务窗口和子业务 Tab，并通过 HTTP 控制面与标准 CDP WebSocket 代理对外提供能力。

第一阶段只建设浏览器基础设施，不修改或接入 `/mnt/aasc-media-server`。当前媒体服务继续使用自己的 `BrowserManager` 和现有 API。

## 已确认范围

- 服务形态：独立 Node.js HTTP 服务。
- 默认监听：`127.0.0.1:3090`。
- HTTP 控制面和 CDP WebSocket 代理共用 3090 端口。
- 配置格式：JSON。
- 默认配置文件：`config.json`，支持 `--config <path>` 覆盖。
- 一个服务进程可以管理多个浏览器实例。
- 支持浏览器类型 `vivaldi` 和 `chromium`。
- 浏览器通过 debug port 区分实例和账号环境。
- 同一 debug port 的业务共享同一个浏览器和 profile。
- 不同 debug port 可以隔离有账号、无账号或不同账号的环境。
- 每个主业务对应一个 Chromium 原生窗口。
- 每个子业务对应主业务窗口中的一个 Tab。
- 主业务窗口和子业务 Tab 都按需创建。
- 每个主业务窗口拥有一个 FIFO 总队列。
- 同一主业务窗口内的所有服务操作按顺序执行。
- 不同主业务窗口可以并行执行。
- 导航和页面操作通过异步 `taskId` 返回。
- 原生 CDP 消息保持标准格式；CDP 目标操作进入相应主业务窗口队列，无法归属目标的浏览器级命令进入浏览器级队列。
- Tab 切换由服务的业务接口管理，其他页面能力尽量保持原生 CDP 语义。
- 默认只监听本机，不暴露到局域网。
- 服务退出时只关闭服务自己启动的浏览器；连接已有浏览器时只断开 CDP。
- 服务自己启动的持久化 profile 不因退出删除。

## 非目标

第一阶段不做：

- 当前媒体服务接入或迁移。
- 豆包或媒体站点业务逻辑。
- profile 数据迁移。
- 局域网远程访问。
- 认证系统。
- 代理 Cookie 或站点登录流程。
- 以业务专属端口替代原生浏览器 debug port。
- 修改已有媒体服务的 `/api/extract`、`/api/search` 等接口。

## 总体架构

```text
                    127.0.0.1:3090
                           │
             ┌─────────────┴─────────────┐
             │                           │
       HTTP 控制面                    CDP 代理
             │                           │
             └─────────────┬─────────────┘
                           │
                  Browser Registry
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
   主 AI 浏览器         专用 AI 浏览器       媒体浏览器
   debugPort 9222      debugPort 9333       debugPort 9334
       │                   │                   │
   主 AI 窗口           专用 AI 窗口         媒体窗口
   日常窗口             ...                  ...
       │                                       │
   子业务 Tab A/B                         Pornhub/Iwara Tab
```

服务由以下逻辑组件组成：

1. **Config Loader**：读取并校验 JSON 配置。
2. **Browser Registry**：按浏览器实例 ID 管理 debug port、连接状态、进程归属和 profile 元数据。
3. **Browser Lifecycle**：检查端口；端口已开放则连接，端口未开放则按配置启动 Vivaldi 或 Chromium。
4. **Business Window Manager**：按业务创建并维护原生窗口。
5. **Sub-business Tab Manager**：按子业务创建、复用和关闭 Tab。
6. **Window Queue**：每个主业务窗口一个 FIFO 队列，串行执行服务托管操作。
7. **HTTP Control API**：管理实例、业务、Tab、任务和状态。
8. **CDP Proxy**：以标准 CDP 消息格式转发浏览器协议，并将可归属操作提交到窗口队列。

## 配置模型

默认 `config.json` 可以包含四个默认业务，并允许继续扩展：

```json
{
  "port": 3090,
  "host": "127.0.0.1",
  "browsers": {
    "main-ai": {
      "browser": "vivaldi",
      "debugPort": 9222
    },
    "special-ai": {
      "browser": "vivaldi",
      "debugPort": 9333,
      "profile": "/home/as/.config/vivaldi-special"
    },
    "media": {
      "browser": "chromium",
      "debugPort": 9334,
      "profile": "/mnt/AASC/browser-profiles/media"
    }
  },
  "businesses": {
    "main-ai": {
      "browser": "main-ai"
    },
    "special-ai": {
      "browser": "special-ai"
    },
    "media": {
      "browser": "media"
    },
    "daily": {
      "browser": "main-ai"
    }
  }
}
```

### 浏览器字段

- `browser`：`vivaldi` 或 `chromium`，默认 `chromium`。
- `debugPort`：本机浏览器 CDP 端口，必须是正整数。
- `profile`：可选的 profile 路径。
- `display`：可选的 X11 display，启动浏览器时传入；默认使用服务环境中的 `DISPLAY`。
- `executable`：可选的浏览器可执行文件路径；未配置时按 `browser` 使用系统默认路径。

### 端口判断与启动

服务不要求配置显式 `mode`，而是按 debug port 状态决定：

1. 端口已开放：连接已有浏览器。
2. 端口未开放：按 `browser` 字段启动新的 Vivaldi 或 Chromium。
3. 启动成功后校验 CDP 浏览器类型与协议可用性。
4. 启动失败直接报告错误，不切换到其他端口，也不接管其他浏览器。

端口已开放时：

- 不读取或猜测已有浏览器的 profile 路径。
- 不删除或修改已有 profile。
- 服务关闭时只断开 CDP。
- 如果配置的 `browser` 与实际 CDP 浏览器类型不匹配，应报告错误。

端口未开放时：

- 配置了 `profile`：使用指定路径启动浏览器。
- 未配置 `profile`：使用对应浏览器用户默认 profile。
- 使用默认 profile 启动时，如果 profile 已被其他浏览器锁定，启动失败并报告清晰错误；不强制结束其他浏览器。
- 服务自己启动的浏览器需要记录进程句柄和 profile 使用权。
- 服务退出时只终止自己启动的进程，不删除持久化 profile。

同一个 profile 路径不得被本服务的两个自启动浏览器实例同时使用。不同 debug port 的实例默认视为不同浏览器环境；如果它们配置相同 profile，服务应在启动前拒绝，避免 Chromium profile 损坏或账号混用。

### 业务字段

- `browser`：引用 `browsers` 中的实例 ID。
- 业务不直接指定 profile 或 debug port。
- 同一业务 ID对应一个主业务原生窗口。
- 同一浏览器实例可以承载多个主业务窗口。
- 同一浏览器实例上的多个业务共享 Cookie 环境，但窗口和队列独立。

## 生命周期

服务启动时：

1. 读取并校验配置。
2. 检查服务监听端口。
3. 不主动创建业务窗口或子业务 Tab。
4. 对配置中的已开放 debug port 可以建立轻量连接并记录状态。
5. 对未开放端口不启动浏览器，等待首次业务使用。
6. 服务启动成功后监听 `127.0.0.1:3090`。

首次使用业务时：

1. 确保业务绑定的浏览器实例可用。
2. 连接已开放端口，或启动配置的浏览器。
3. 创建该业务的原生窗口。
4. 创建请求的子业务 Tab。
5. 将后续服务操作提交到该主业务窗口队列。

服务退出时：

1. 停止接收新任务。
2. 等待或取消尚未执行的服务任务并返回明确状态。
3. 关闭服务自己创建的业务 Tab 和原生窗口。
4. 断开所有 CDP 连接。
5. 只终止服务自己启动的浏览器进程。
6. 不关闭连接已有端口的浏览器。
7. 保留持久化 profile。

浏览器断开时：

- 标记浏览器实例不可用。
- 该实例下所有业务窗口进入断开状态。
- 正在执行的任务失败。
- 排队任务失败或按统一策略取消。
- 不自动连接到其他 debug port。

## 窗口、Tab 和队列

### 层级

```text
BrowserInstance
└── BusinessWindow
    ├── SubBusinessTab A
    ├── SubBusinessTab B
    └── WindowQueue
```

主 AI 和日常如果绑定同一浏览器实例，仍分别拥有不同原生窗口和不同窗口队列；它们共享 Cookie 和浏览器进程，但页面导航互不排队。

### 主业务窗口

主业务窗口是 Chromium 的原生窗口，不是仅靠 Tab 标识的逻辑对象。服务需要记录：

- `businessId`
- `browserId`
- 窗口关联的初始 Target/页面
- 当前窗口状态
- 子业务 Tab 列表
- FIFO 队列

如果目标浏览器或运行环境不支持可见原生窗口，服务应报告窗口创建失败，而不是静默退化为同一窗口 Tab。

### 子业务 Tab

每个子业务在主业务窗口中使用一个独立 Tab。服务记录：

- `subBusinessId`
- `businessId`
- `browserId`
- `targetId`
- 页面 URL、标题和状态
- 创建时间和最后活动时间

Tab 切换由业务接口执行。除 Tab 切换和业务归属管理外，页面控制优先使用标准 CDP。

### 总队列

每个主业务窗口有一个 FIFO 总队列，窗口内所有由服务提交的动作共用该队列：

- 导航
- 点击
- 输入
- 文本或 HTML 读取
- 页面脚本执行
- 截图
- PDF
- 下载状态查询
- Tab 激活/切换
- 可识别目标 Tab 的 CDP 命令

队列任务返回唯一 `taskId`。状态至少包括：

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

不同主业务窗口的队列可以并行。浏览器级 CDP 命令无法归属到某个窗口时进入该浏览器实例的浏览器级队列；不能伪造归属到任意业务窗口。

## HTTP 控制面

服务使用 JSON 请求和响应，统一返回错误对象：

```json
{
  "error": {
    "code": "BROWSER_UNAVAILABLE",
    "message": "浏览器实例不可用"
  }
}
```

第一版接口：

```text
GET  /api/status
GET  /api/browsers
POST /api/browsers/:browserId/ensure
GET  /api/businesses
POST /api/businesses/:businessId/ensure
GET  /api/businesses/:businessId
POST /api/businesses/:businessId/sub-businesses/:subId/ensure
POST /api/businesses/:businessId/sub-businesses/:subId/navigate
POST /api/businesses/:businessId/sub-businesses/:subId/action
POST /api/businesses/:businessId/sub-businesses/:subId/activate
GET  /api/tasks/:taskId
POST /api/shutdown
```

### 主要请求语义

`POST /api/browsers/:browserId/ensure`：确保浏览器实例已连接或已启动，返回浏览器状态和原生 CDP 信息。

`POST /api/businesses/:businessId/ensure`：确保浏览器可用并创建主业务原生窗口，返回 `businessId`、`browserId`、窗口状态和队列状态。

`POST .../:subId/ensure`：确保主业务窗口和子业务 Tab 存在，返回 `targetId`、当前 URL 和 Tab 状态。

`POST .../:subId/navigate`：提交导航任务，例如：

```json
{
  "url": "https://example.test/page"
}
```

立即返回：

```json
{
  "taskId": "task-...",
  "status": "queued",
  "businessId": "media",
  "subBusinessId": "pornhub"
}
```

`POST .../:subId/action`：提交常用页面操作，至少支持安全的结构化动作：

- `click`：按选择器点击。
- `type`：向选择器对应元素输入文本。
- `text`：读取元素文本。
- `html`：读取元素 HTML。
- `evaluate`：执行受控页面脚本，必须明确权限边界和请求体限制。
- `screenshot`：截图并返回任务结果或服务端文件引用。
- `pdf`：生成 PDF 并返回任务结果或服务端文件引用。
- `downloadStatus`：查询由页面动作产生的下载状态。

动作结果通过 `GET /api/tasks/:taskId` 查询。二进制输出不直接无限制嵌入 JSON，使用有大小限制的结果引用。

`POST .../:subId/activate`：将业务 Tab 设为当前活动 Tab，进入该主业务窗口队列。

## CDP 代理

服务提供标准 CDP HTTP/WS 代理，不修改 CDP 消息结构。代理至少需要支持：

```text
GET /cdp/:browserId/json/version
GET /cdp/:browserId/json/list
GET /cdp/:browserId/json/new
GET /cdp/:browserId/json/close/:targetId
WS  /cdp/:browserId/devtools/browser/:sessionId
WS  /cdp/:browserId/devtools/page/:targetId
```

具体路径和返回字段应与目标 Chromium/Vivaldi 的原生调试端口兼容，使 Puppeteer、Playwright 和 Chrome DevTools 可以通过替换 endpoint 使用。

代理规则：

- 保留原始 CDP `id`、`method`、`params`、`sessionId`。
- 保留浏览器发出的 Target、Page、Runtime 等事件。
- 不重写协议方法名称和参数结构。
- 维护浏览器实例到原生 debug port 的映射。
- 根据 `targetId`/`sessionId` 识别目标 Tab 所属主业务窗口。
- 可识别目标的 CDP 命令进入该窗口 FIFO 队列。
- 浏览器级命令进入浏览器实例级队列。
- CDP 代理无法识别归属时不擅自选择业务窗口。
- 业务接口负责 Tab 激活；CDP 客户端可以使用原生 Target 能力进行其他操作。
- 直接绕过服务连接浏览器原始 debug port 的客户端不受业务队列约束，这是原生 CDP 的明确边界。

CDP 代理需要处理多客户端连接、WebSocket 断开、浏览器断开、Target 创建/销毁和 session 生命周期。代理本身不能通过复制或猜测 `sessionId` 破坏原生 Target 会话。

## 安全与资源边界

- 默认只绑定 `127.0.0.1`。
- 所有 HTTP 请求体和 URL 长度有上限。
- profile 路径必须经过配置解析，不接受未经约束的任意路径穿透。
- 同一自启动 profile 禁止并发占用。
- 服务不转发浏览器 Cookie 到其他服务。
- 服务启动失败不连接或终止其他 debug port 的浏览器。
- 服务只终止记录为自身子进程的浏览器。
- `evaluate`、下载、截图和 PDF 等高权限操作应有独立大小、时长和结果限制。
- 未授权的业务 ID、浏览器 ID、Tab ID 和 task ID 返回明确的 404/403 错误。
- 关闭业务窗口时不得误关闭同一浏览器中的其他业务窗口。

## 测试策略

使用 Node.js `node:test`，不依赖真实网络站点；真实 Chromium 只用于单独 smoke test。

### 配置测试

- 默认配置文件读取。
- `--config` 覆盖路径。
- `vivaldi` 和 `chromium` 类型校验。
- debug port 正整数校验。
- 业务引用不存在的浏览器时拒绝启动。
- 同一 profile 被两个自启动实例使用时拒绝。
- 同一个 debug port 被多个业务引用时允许并确认共享实例。
- 默认四个业务存在且可以扩展自定义业务。

### 生命周期测试

- 已开放端口连接已有浏览器。
- 已开放端口不启动新进程。
- 未开放端口按配置启动 Vivaldi/Chromium。
- 启动失败返回明确错误。
- 启动进程退出时清理句柄。
- 服务只关闭自己启动的浏览器。
- 连接已有浏览器时关闭服务只断开连接。
- 持久化 profile 不被删除。
- 不同 debug port 可以管理不同实例。

### 窗口和队列测试

- 业务首次请求按需创建主业务窗口。
- 同一业务重复请求复用窗口。
- 子业务首次请求创建 Tab，重复请求复用 Tab。
- 同一窗口任务严格 FIFO。
- 同一窗口不同子业务仍共用总队列。
- 不同窗口任务可以并行。
- 任务成功、失败、取消和浏览器断开状态正确。
- 关闭业务窗口不影响同浏览器其他业务窗口。

### HTTP/CDP 测试

- 状态、浏览器、业务和 Tab 查询。
- 导航立即返回 taskId。
- action 进入正确窗口队列。
- activate 进入窗口队列。
- CDP `/json/version` 和 `/json/list` 保持兼容字段。
- CDP 命令和事件保留原生消息字段。
- target/session 映射正确。
- 多客户端连接和断开不泄露 session。
- 未归属浏览器级命令进入浏览器级队列。
- 直接原始 debug port 不被服务误判为已排队操作。

### 现场验证

使用独立 Chromium/Vivaldi、独立 debug port 和临时测试 profile：

1. 配置四个业务，其中至少两个业务共享一个浏览器实例，至少一个业务使用独立端口。
2. 验证已有 debug port 连接不启动新浏览器。
3. 验证未开放端口按 `browser` 配置按需启动。
4. 验证每个主业务创建独立原生窗口。
5. 验证同一主业务的多个子业务创建独立 Tab。
6. 验证同窗口任务按顺序执行，不同窗口可以并行。
7. 使用 Puppeteer/Playwright 或 Chrome DevTools 通过 CDP endpoint 连接。
8. 发送 Target/Page/Runtime 等原生 CDP 命令并确认字段未被改写。
9. 关闭服务，确认只关闭服务启动的实例，已有浏览器和 profile 不受影响。

## 实现边界

本规格只定义新工程，不要求当前媒体服务迁移。后续若要接入媒体服务，应另行设计适配层，使当前 `/api/extract`、`/api/search` 等外部 API 保持不变。
