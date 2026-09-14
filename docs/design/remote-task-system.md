# 远程任务系统设计

## 概述

在 Web MediaCenter 中新增远程任务系统，用户可在控制端提交任务（执行代码 + 输入文件），选择在服务端、显示端或子显示端执行，获取执行结果。

## 系统架构

```
控制端 (upload.html)
    │ task:submit / task:stop
    ▼
RemoteTaskService (服务端 server-app.js)
    │
    ├── Node.js 运行时 ─── 内置任务 + 用户 CPU 任务
    ├── Puppeteer 运行时 ── 用户 JS (CPU/WebGL/WebGPU)
    │
    ├── target=display ───→ 显示端浏览器执行
    ├── target=subdisplay ─→ 子显示端 Node.js/Puppeteer 执行
    │
    └── 结果返回控制端
```

## 执行目标

| 目标 | 运行时 | 任务类型 | 执行环境 |
|------|--------|----------|----------|
| 服务端 | Node.js | 内置任务 / 用户 JS | CPU only |
| 服务端 | Puppeteer | 用户 JS | CPU / WebGL / WebGPU |
| 显示端 | 浏览器 | 用户 JS | CPU / WebGL / WebGPU |
| 子显示端(Node.js) | Node.js | 用户 JS | CPU |
| 子显示端(Node.js) | Puppeteer | 用户 JS | CPU / WebGL / WebGPU |

**路由规则：**
- `taskType=builtin` → 默认由服务端 Node.js 运行；明确支持显示端/子显示端执行的内置服务遵守 `target`
- `taskType=user` → 根据 `target` 路由到对应目标
- 任务声明的 `target` 只决定执行位置，不改变实例级状态、日志、结果和控制端消息协议

## 任务目录结构

```
res/tasks/
  ├── {taskName}/              ← 用户命名的任务名称
  │   ├── task.js              ← 任务文件（执行代码+输入数据，常驻）
  │   ├── utils/helper.js
  │   ├── data.json
  │   ├── ...
  │   └── results/             ← 执行结果，按实例独立目录
  │       ├── {instanceId}/    ← 每次执行一个实例目录（并行时并存）
  │       │   ├── output.json
  │       │   ├── run.log       ← 完整任务日志
  │       ├── latest/ → {instanceId}  (符号链接，指向最近实例)
  │       └── index.json       ← 实例索引（instanceId, 状态, 时间, 耗时）
  │
  └── (其他任务)
```

- **任务文件**常驻任务目录，不随执行变化
- **结果按实例**：每个实例独立结果目录，支持并行执行
- **latest**：符号链接指向最近一次执行结果
- **index.json**：记录实例历史，控制端查看用

## 任务类型

| | 一次性任务 | 常驻任务 |
|--|-----------|---------|
| 执行模式 | 执行完即结束 | 持续运行，直到主动停止 |
| 结果 | 一次性返回 | 持续产生中间结果/日志 |
| 状态机 | submit → done/failed/cancelled | submit → running → stopping → stopped |

**常驻任务额外支持：**
- `task:stop` — 发送停止指令
- `task:heartbeat` — 常驻任务定期汇报存活
- `task:partial_result` — 中间结果持续返回

## AI 任务通用能力

任务是项目维护者自行管理的代码隔离单元。任务可以自主管理控制端展示和业务路由，任务引擎提供统一上下文、消息桥接和生命周期清理。

### 任务描述元数据

任务模块可以声明以下通用元数据：

| 元数据 | 作用 |
|--------|------|
| `target` | 服务端、显示端或子显示端执行目标 |
| `mode` | 一次性任务或常驻服务任务 |
| `params` | 当前任务独立的参数定义和默认值 |
| `sidebar` | 控制端侧边栏分组、页签、标签和图标 |
| `widget` | 任务卡片、实例详情和侧边栏中的展示、字段、动作与脚本 |
| `control.actions` | 任务卡片或实例卡片中的页面/弹窗按钮及其 HTML、JavaScript |
| `configButton` | 旧版控制端任务专属配置入口；新任务页面统一使用 `control.actions` |

不同任务可以定义不同的参数、展示和控制逻辑，不要求共享同一套业务配置。内置任务和用户任务使用同一描述与上下文契约；后续可把稳定的内置任务迁移到 `res/tasks/<taskName>/` 作为用户任务维护，保留任务入口、元数据和上下文调用即可，控制端不需要新增任务名分支。

### 任务上下文

任务引擎按目标注入通用上下文：

- 基础数据：`taskName`、`instanceId`、`params`、`files`、`refs`、`workDir`、`taskIO`。
- 运行控制：`sendProgress()`、服务任务返回的 `stop()`。
- 控制端交互：`postWidgetUpdate()`、`onWidgetAction()`。
- 网络与节点：`registerRoute()`、`sendToDisplay()`、`broadcastToDisplays()`。
- 可选系统服务：TTS、LLM、聊天、运行时工厂等，仅在对应目标和任务类型可用时注入。

任务代码只通过上下文使用这些能力；任务停止、异常、显示端断开和引擎销毁时由 TaskManager 统一清理动作、路由、定时器关联状态和服务控制器。

### 控制端页面显示

用户任务可以自主管理控制端页面资源，不需要额外的页面/动作白名单：

- `sidebar` 把任务加入控制端动态侧边栏；`sidebarManifest` 可补充分组和页签。
- `widget.html` 提供页面片段，支持 `{{instanceId}}` 和任务推送数据占位符。
- `widget.script` 在任务容器中运行，通过 `api.getContainer()`、`api.getData()`、`api.onUpdate()`、`api.sendAction()` 和 `api.onDestroy()` 管理页面。
- `control.actions` 提供任务级或实例级页面/弹窗；每个动作可以声明 `placement`、`title`、`html` 和 `script`，由任务自己维护页面内容。
- `control.actions[].script` 使用控制端提供的通用 API 发送带 `type` 的 WebSocket 消息、接收任务消息、读取实例信息和清理页面资源。
- 服务端用户服务也可以注册 `postWidgetUpdate()` 与 `onWidgetAction()`，与内置服务使用同一消息通道。
- 控制端负责承载任务资源和转发 `task:widget_action`，不把任务页面状态混入全局业务配置。

任务自带 HTML/JavaScript 是任务资源管理方式；任务系统不把它当作第三方插件，也不额外引入白名单注册层。

### 内置任务拆分为用户任务

- 可以迁移不再需要服务端预装依赖或特权能力的内置任务。
- 迁移后的任务放入 `res/tasks/<taskName>/`，由 `task.js` 导出任务元数据；服务模式另由 `service.js` 导出 `run()`，并继续使用同样的 `target`、`mode`、`params`、`sidebar`、`widget`、`control.actions` 契约。
- 任务引擎继续按 `target`、`mode` 路由，并提供 `taskName`、`instanceId`、`params`、`taskIO`、Widget、控制端消息和 URL 路由上下文。
- 仍依赖项目级 Node 模块、核心服务或内部特权的任务暂时保留为内置任务；迁移时需要先确认依赖可以通过通用上下文提供。

### URL 路由

服务任务使用 `context.registerRoute()` 在 AASC 当前 `8081` 端口注册 URL。服务端任务直接处理请求，显示端/子显示端任务通过 WebSocket 转发请求和响应。任务路由与实例绑定，生命周期结束时必须注销，详见 [任务 URL 路由注册](task-url-route-registration.md)。

### Widget 刷新日志

运行中服务任务的 `widgetRefresh` 用于周期性同步状态。刷新动作和 `task:widget_update` 仍正常传输，但不写普通 WebSocket 操作日志；人工操作、任务错误和其他状态日志继续保留。

### 任务列表轮询日志

控制端进入任务页或任务状态变化后会正常轮询 `task:list`。该请求及成功响应不写普通 WebSocket 操作日志；任务列表处理异常仍记录错误，列表数据和刷新行为不变。

## 内置任务

内置任务代码预装在服务端，运行于 Node.js 环境，可访问：
- 项目全部 npm 包（puppeteer、sharp、axios 等）
- Node.js 内置模块（fs、path、child_process 等）
- 已有的系统 Service（TTS、LLM、媒体库等）
- 外部工具（通过 exec/spawn 调用）

**内置任务存放目录：**
```
src/apps/server/modules/task-engine/
  └── builtin-tasks/
      ├── registry.js           ← 任务注册表
      ├── image-resize.js       ← 示例：图片缩放
      ├── tts-generate.js       ← 示例：TTS 生成
      └── ...
```

**内置任务接口规范：**
```javascript
module.exports = {
  id: 'image.resize',
  name: '图片缩放',
  params: [
    { name: 'width', type: 'number', required: true },
    { name: 'height', type: 'number', required: false }
  ],
  async run(context) {
    // context.files   - 输入文件 { name: Buffer }
    // context.params  - 任务参数
    // context.refs    - 跨任务引用文件路径映射
    // context.services - 系统服务
    // context.logger  - 日志
    return { outputFiles: ['output.png'] };
  }
};
```

## 消息协议

### 控制端 → 服务端

```javascript
// 提交任务 — 服务端返回 instanceId
{
  type: "task:submit",
  payload: {
    taskName: "my-task",          // 任务名称
    taskType: "user",             // "user" | "builtin"
    builtinId: "image.resize",    // taskType=builtin 时使用
    entryFile: "task.js",         // 入口文件（taskType=user）
    target: "server",             // "server" | "display" | "subdisplay"
    displayId: null,              // 目标显示端/子显示端 ID
    mode: "one-shot",             // "one-shot" | "service"
    env: "auto",                  // "cpu" | "webgl" | "webgpu" | "auto"
    files: [                      // 文件列表（taskType=user）
      { name: "task.js", data: "<base64>" },        // 小文件 inline 上传
      { name: "utils.js", data: "<base64>" },
      { name: "data.json", path: "/res/tasks/other-task/data.json" }  // 引用已有文件
    ],
    refs: {                       // 跨任务引用
      "input.png": "image-processor/results/latest/output.png"
    },
    params: { width: 800 }        // 额外参数
  }
}

// 提交确认
{
  type: "task:submitted",
  payload: { taskName: "my-task", instanceId: "a1b2c3" }
}

// 停止任务 — 按实例停止
{
  type: "task:stop",
  payload: { taskName: "my-task", instanceId: "a1b2c3" }
}

// 查询任务状态 — 取最新或指定实例
{
  type: "task:status",
  payload: { taskName: "my-task", instanceId: "a1b2c3" }  // instanceId 可选，不传返回最新
}
```

### 服务端 → 显示端/子显示端

```javascript
// 执行任务
{
  type: "task:execute",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    entryFile: "task.js",
    files: [ ... ],
    refs: { ... },
    env: "auto"
  }
}
```

### 服务端 → 控制端（日志流）

```javascript
// 任务日志行 — 实时流式推送
{
  type: "task:log",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    stream: "stdout",       // "stdout" | "stderr" | "system"
    level: "info",          // "debug" | "info" | "warn" | "error"
    message: "图片处理完成, 耗时 320ms",
    timestamp: 1712345678901
  }
}
```

### 通用结果返回

```javascript
// 执行进度（含 instanceId）
{
  type: "task:progress",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    stage: "preparing" | "running" | "completed" | "failed",
    progress: 0-100
  }
}

// 执行结果
{
  type: "task:result",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    success: true,
    outputFiles: [
      { name: "result.json", url: "/res/tasks/my-task/results/a1b2c3/result.json" }
    ],
    metrics: {
      duration: 1234,        // 执行耗时 ms
      env: "webgpu"          // 实际使用的执行环境
    }
  }
}

// 执行错误
{
  type: "task:error",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    error: "错误信息",
    stack: "堆栈信息"
  }
}

// 常驻任务心跳
{
  type: "task:heartbeat",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    status: "running",
    uptime: 3600000         // 已运行时间 ms
  }
}

// 常驻任务中间结果
{
  type: "task:partial_result",
  payload: {
    taskName: "my-task",
    instanceId: "a1b2c3",
    outputFiles: [ ... ],
    metrics: { ... }
  }
}
```

## 任务日志

每个任务实例自动捕获以下日志流：

| 流 | 来源 | 说明 |
|----|------|------|
| `stdout` | 执行代码的 `console.log` | 普通输出 |
| `stderr` | 执行代码的 `console.error/warn` | 警告和错误 |
| `system` | 执行引擎内部 | 引擎启动、文件准备、清理等系统事件 |

**日志处理：**
- 实时通过 WebSocket `task:log` 消息推送到控制端（供 UI 实时显示）
- 同时写入实例结果目录 `results/{instanceId}/run.log`（完整持久化）
- 控制端可随时下载 `run.log` 查看完整日志

**执行代码中直接使用 `console.log / console.error`**，引擎自动捕获并分流到 stdout/stderr 流：

```javascript
// 用户代码中的日志
console.log('处理开始...');
const result = process(data);
console.log('处理完成, 结果:', result);
console.warn('输入数据格式不规范, 已自动修正');
```

## 文件传输策略

| 文件大小 | 传输方式 |
|----------|----------|
| 小文件 <1MB | WebSocket base64 直接传输 |
| 大文件 ≥1MB | HTTP 上传 → 消息中传路径引用 |
| 超大文件 ≥100MB | HTTP 分片上传 |

**结果文件：** 执行完成后写入 `res/tasks/{taskName}/results/{timestamp}/` 目录，控制端通过 URL 下载。

## 跨任务引用

执行上下文提供路径映射，代码通过 context.refs 读取引用文件：

```javascript
// 提交时声明引用（路径相对于 res/tasks/）
refs: {
  "input.png": "image-processor/results/latest/output.png"
}

// 执行代码中通过 context 读取
async function run(context) {
  // context.refs 已解析为绝对路径
  const inputPath = context.refs["input.png"];
  // inputPath → /absolute/path/to/res/tasks/image-processor/results/latest/output.png
  const data = fs.readFileSync(inputPath);
}
```

## 服务器重启后的显示端服务恢复

显示端常驻服务断连时，实例状态会持久化为 `display_offline`，等待显示端重连。服务器重启会清空 `this.instances` 与 `_orphanedTasks` 等内存状态，因此启动恢复按状态分流：

- `mode=service && status=running`：按既有流程重新提交并运行；显示端暂不可用时进入待转发队列。
- `mode=service && status=display_offline`：不立即执行，按 `displayId` 回填 `_orphanedTasks`；同一 `instanceId` 去重，缺失 `displayId` 的实例跳过并记录警告。
- 显示端重连后统一调用 `retryOrphanedTasks(displayId)`，将回填的实例恢复为 draft，再运行并转发到显示端；孤儿分组消费后删除，重复重连不会重复恢复。

这样持久化索引中的 `display_offline` 状态能够重新连接到内存恢复队列，同时避免服务器启动时在显示端尚未连接的情况下提前执行服务。

## 任务状态机

```
one-shot:
  submit → [preparing] → running → completed
                                → failed
                                → cancelled

resident:
  submit → [preparing] → running (持续心跳/中间结果)
                              ↓ stop
                            stopping → stopped
                              ↓ crash
                            failed (可选 auto-restart)
```

## 实例管理

每次 `task:submit` 生成独立 `instanceId`，所有操作按实例粒度：

```javascript
// 提交 → 返回 instanceId
{ type: "task:submitted", payload: { taskName: "my-task", instanceId: "a1b2c3" } }

// 按实例停止 / 查询状态
{ type: "task:stop",    payload: { taskName: "my-task", instanceId: "a1b2c3" } }
{ type: "task:status",  payload: { taskName: "my-task", instanceId: "a1b2c3" } }
```

## 文件清理策略

| 文件类型 | 策略 |
|----------|------|
| 任务文件（执行代码+输入） | 不清理，常驻 |
| 实例结果目录 | 保留最近 N 个实例（默认 50），超出自动删除最旧实例目录和索引记录 |
| 临时文件 | 执行完成后立即清理 |

## 错误处理

| 场景 | 处理 |
|------|------|
| 执行超时 | 默认 30s 可配置，超时自动取消并清理 |
| JS 运行时异常 | 捕获错误、堆栈，返回控制端 |
| 显示端子显示端断连 | 正在执行的任务标记 failed，通知控制端 |
| Puppeteer 崩溃 | 自动重启浏览器，任务标记 failed |
| 常驻任务崩溃 (auto-restart) | 自动重启任务 |

## 控制端 UI 要点

- upload.html 侧边栏新增"远程任务"面板
- 任务类型切换：用户代码 / 内置功能
- 文件上传支持：拖拽、批量、从服务器选择已有文件
- 执行配置：目标、环境、模式（一次性/常驻）
- 任务列表：实时状态、进度、结果查看、常驻任务停止按钮
- 内置任务自动切换动态参数表单
