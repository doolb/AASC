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
- `taskType=builtin` → 始终路由到服务端 Node.js 运行时
- `taskType=user` → 根据 target 路由到对应目标

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
