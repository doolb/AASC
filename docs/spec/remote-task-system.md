# 远程任务系统 - 实现文档

## 概述

远程任务系统允许用户通过控制端上传 JS 代码，选择在服务端/显示端/子显示端执行，获取执行结果和实时日志。

## 模块

### 服务端

| 文件 | 说明 |
|------|------|
| task-manager.js | 任务生命周期管理、实例跟踪、派发 |
| task-io.js | 文件管理、refs 解析、结果目录、日志写入 |
| nodejs-runner.js | child_process.fork 独立进程执行用户 JS |
| puppeteer-runner.js | Puppeteer headless 浏览器执行（GPU） |
| web-socket-handler.js | task:* 消息注册和事件桥接 |

### 前端

| 文件 | 说明 |
|------|------|
| task-panel.js | 任务面板：三标签导航（列表/新建/监控）、编辑、结果查看、设备选择、快捷运行 |

## 数据流

```
控制端 task:submit -> 服务端 taskManager.submit()
  +-- mode=service -> _runServiceTask() 主进程运行，返回控制器
  |     +-- taskType=builtin -> builtinRegistry.run() 加载内置服务
  |     +-- taskType=user -> require(service.js) 加载用户服务
  |     +-- controller.stop() 用于 task:stop 停止服务
  +-- taskType=builtin --- 检查 builtinDef.mode
  |     +-- mode=service -> _runServiceTask() 内置服务路径
  |     +-- one-shot -> builtinRegistry.run() 一次性执行
  |           +-- 执行后检查实例是否 stopped，是则跳过 _handleResult 防止覆盖
  +-- target=server -> _runServerTask() 异步派发，立即返回
  |     +-- env=cpu -> NodeJsRunner (child_process.fork 隔离)
  |     +-- env=webgl/webgpu -> PuppeteerRunner
  |     +-- 结果通过 TaskManager 事件异步通知控制端
  +-- target=display -> 转发 -> display.html executeTask()
  |     +-- model.inference: WebGPU 异步执行，不阻塞主线程
  |     +-- 用户任务: Web Worker 隔离执行，不阻塞主线程
  +-- target=subdisplay -> 转发 -> voice-display-node handleTaskExecute()

显示端/子显示端 -> task:result -> 服务端 -> task:result -> 控制端

TaskManager 事件 -> web-socket-handler -> task:progress/task:log/task:result -> 控制端 UI

服务任务生命周期:
submit() -> _runServiceTask() -> run() 返回 { type: 'service', stop() }
  -> 控制器存 _services Map
  -> task:stop -> stopInstance() -> controller.stop()
  -> 清理 _services, 更新 index.json status='stopped'

显示端服务（target=display, mode=service）:
  转发启动: runInstance() -> _forwardToDisplay() -> display executeTask()
  -> 显示端 task:result(success=true) -> handleForwardResult()
     -> 检测 isDisplayService, 保持 status='running'
     -> 注册到 _services (stop 时发送 task:stop 到显示端)
  停止: stopInstance() -> svc.stop() -> 发送 {type:'task:stop', instanceId} 到显示端
  -> 显示端清理 DOM 覆盖层 + 注销 _renderTaskUpdates
  -> 服务端清理 _services, 更新 status='stopped'
```

### 停止孤儿实例

#### 服务器重启孤儿

服务器重启后，`mode=one-shot` 且 `status=running` 的实例不会被 `restoreAutoStartServices()` 恢复。
`stopInstance()` 在 `this.instances` 中找不到实例时，回退到 index.json 查找并直接更新 `status='stopped'`，
确保前端发起的停止操作不会因实例不在内存而失败。

#### 显示端断连孤儿

显示端的 WebSocket 断开时（浏览器刷新、网络断开），`server-app.js` 的 `onDisplayDisconnect` 回调调用
`taskManager.handleDisplayDisconnect(displayId)` 清理孤儿任务：

1. 遍历 `this.instances`，匹配 `targetInfo.displayId === displayId` 且状态为 `running`/`pending_forward`
2. 清除转发超时 `_forwardTimeout`
3. **服务任务**（`mode=service`）：状态改为 `display_offline`（非终态，等待重连恢复），通过 `progress` 事件（带 `status` 字段）通知控制端；
   **一次性任务**：状态改为 `failed`（终态），通过 `result` 事件通知控制端
4. 清除 `_services` 和 `_widgetActions` 中的条目
5. 持久化状态到 index.json
6. 服务任务同时记录到 `_orphanedTasks`，待显示端重连后自动恢复

这样避免控制端仍显示"运行中"而实际任务已无法继续执行的歧义。`display_offline` 在控制端 UI 中显示为"进行中(offline)"（橙色标签），
语义上区别于"失败"和"运行中"。

如果实例是 `mode=service` 的服务任务，还会记录到 `_orphanedTasks` Map 中，
待显示端重连后由 `retryOrphanedTasks(displayId)` 自动恢复：

1. `handleDisplayDisconnect` 将服务任务的信息（taskName、params、target、entryFile 等）存入 `_orphanedTasks`
2. `server-app.js` 的显示端连接处理（`onDisplayConnect`）在 `retryPendingDisplayServices` 后调用 `retryOrphanedTasks(displayId)`
3. 遍历该显示端的孤儿任务列表，逐一调 `submit()` → `runInstance()` 重新创建并执行
4. 新实例通过 `task:execute` 转发到显示端，状态流转：draft → running（pending_forward → running）

## 草稿模式（Draft Mode）

所有实例从 `draft` 状态开始，`submit()` 只创建草稿不执行，`runInstance()` 显式触发执行。

### 状态机

```
submit → draft (可编辑参数)
          │ task:run
          ▼
       pending → preparing → running → completed/failed/stopped
          │         │            │
          │         │      (显示端断开)
          │         │            ▼
          │         │     display_offline (非终态，待重连恢复)
          │         │            │ rerunInstance + runInstance (显示端重连)
          │         │            ▼
          │         │         running (复用原 instanceId)
          ▼         ▼
       pending_forward
```

### 状态说明

- `display_offline`：仅用于 `mode=service` 的显示端任务，显示端断开时从 `running` 转入。
  非终态，显示端重连后自动恢复为 `running`。控制端显示"进行中(offline)"。
- `pending_forward`：任务已提交、等待显示端确认。30 秒超时后转为 `failed`。

### 核心规则

1. `submit()` 始终返回 `status: 'draft'`
2. `task:run` 将 draft → running
3. `task:rerun` 将 completed/failed/stopped 重置回 draft（同实例、同目录）
4. 仅 draft 状态允许编辑参数
5. 服务重启时 `restoreAutoStartServices()` 通过 submit→runInstance 两步恢复

## TaskManager 接口

```
class TaskManager extends EventEmitter {
  submit(task)         // 创建 draft 实例，返回 { taskName, instanceId, status: 'draft' }
                       // 自动检测内置任务：taskName 匹配内置注册表则修正 taskType='builtin'
  runInstance(taskName, instanceId)  // draft → running，执行完整生命周期
                       // 注意：内置 task 执行后检查实例是否已 stopped，防止 _handleResult 覆盖
  rerunInstance(taskName, instanceId)  // completed/failed/stopped → draft
  stopInstance(taskName, instanceId)   // 停止指定实例
                       // 实例不在内存时回退到 index.json 查找并更新 status='stopped'
  getInstance(instanceId)             // 按 instanceId 获取实例对象
  getInstanceStatus(taskName, instanceId?)  // 查询实例状态
  handleForwardResult(taskName, instanceId, result)  // 处理显示端/子显示端返回的结果
  handleDisplayDisconnect(displayId)  // 显示端断开时清理孤儿任务
  destroy()            // 清理资源、终止进程、关闭浏览器
}
```

## 事件

TaskManager 继承 EventEmitter，主要事件：

| 事件 | 参数 | 触发时机 |
|------|------|----------|
| progress | (instanceId, stage, progress) | 各阶段切换/进度更新 |
| log | (instanceId, stream, level, message) | 每行日志输出 |
| result | (instanceId, result) | 执行完成/失败 |
| forward | (instanceId, task) | 需要转发到显示端/子显示端 |
| widgetUpdate | (instanceId, data) | 服务任务实时状态推送 |

web-socket-handler 将上述事件桥接到控制端：

```
progress     -> task:progress       { taskName, instanceId, stage, progress }
log          -> task:log            { taskName, instanceId, stream, level, message, timestamp }
result       -> task:result         { taskName, instanceId, success, data/error }
widgetUpdate -> task:widget_update  { instanceId, data }
```

## Widget 系统

内置服务任务可定义 widget，在控制端显示自定义 UI。

### Widget 定义

两种模式：

**1. 自定义 HTML（推荐）** — 用 `{{var}}` 引用实时数据

```js
widget: {
  html: '<div>状态: <strong>{{lastTime}}</strong></div>' +
    '<button onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'test\')">测试</button>' +
    '<button class="task-card-btn primary" onclick="TaskPanel._onWidgetSaveConfig(\'{{instanceId}}\')">保存</button>',
  // 字段必须带 class="task-widget-field" data-field="name" 供保存配置遍历
  // checkbox 用 type="checkbox" data-field="name"（保存配置会收集 checked 值）
}
```

HTML 模板支持的占位符：
- `{{instanceId}}` — 当前实例 ID（用于 action 回调）
- `{{varName}}` — 由 `postWidgetUpdate({ varName: value })` 推送的实时数据

**3. 自定义 script 控制器（推荐）**

```js
widget: {
  html: '<div id="clock">{{time}}</div>',
  script: \`
    api.onUpdate(function(data) {
      document.getElementById('clock').textContent = data.time;
    });
    api.onDestroy(function() {
      // cleanup
    });
  \`
}
```

script 执行的上下文提供 `api` 对象：

| API | 说明 |
|-----|------|
| `api.onUpdate(fn)` | 每次 `task:widget_update` 时调用 `fn(data)`，替代 `{{var}}` 模板替换 |
| `api.sendAction(action, params)` | 发送 `task:widget_action` 到服务端 |
| `api.getContainer()` | 返回 widget 根 DOM 元素 |
| `api.getData()` | 返回当前 widget 数据 |
| `api.onDestroy(fn)` | widget 卸载时清理（定时器、事件监听等） |
| `api.setInterval(fn, ms)` | 安全定时器，controller 销毁时自动清理 |

注意：有 `script` 时 `{{var}}` 模板替换不再自动执行，所有渲染逻辑由 `onUpdate` 控制。

**2. 自动表单字段**

```js
widget: {
  fields: [       // 配置表单字段
    { name: 'enabled', type: 'toggle', label: '启用', default: true },
    { name: 'interval', type: 'select', label: '间隔', options: [15,30,60], default: 15 },
  ],
  displays: [     // 实时数据显示
    { id: 'lastTime', label: '上次报时' },
  ],
  actions: [      // 动作按钮
    { id: 'test', label: '测试报时' }
  ]
}
```

### 数据流

```
服务任务 postWidgetUpdate({ lastTime, nextTime })
  -> TaskManager emit('widgetUpdate', instanceId, data)
  -> web-socket-handler -> task:widget_update { instanceId, data }
  -> 控制端 _onWidgetUpdate() -> 更新 _widgetData -> 重新渲染右列

控制端点击"测试报时"
  -> task:widget_action { instanceId, action: 'test' }
  -> web-socket-handler -> taskManager.handleWidgetAction()
  -> 服务 onWidgetAction('test', handler)

控制端点击"保存配置"（_onWidgetSaveConfig）
  仅收集当前实例容器 #task-widget-{instanceId} 内 .task-widget-field 字段:
    checkbox -> el.checked（布尔值）
    number   -> parseInt(el.value) || 0
    select   -> parseInt(el.value)
  -> task:widget_action { instanceId, action: 'updateConfig', params }
  -> taskManager.handleWidgetAction() -> 服务 onWidgetAction('updateConfig', params)
  更新运行配置（config.enabled 等）并持久化到任务索引（taskIO.updateIndex）
```

## 消息类型

详见 docs/design/remote-task-system.md

## 并发与阻塞防护

### 服务端：异步派发

服务端用户任务（NodeJsRunner/PuppeteerRunner）通过 `_runServerTask()` 异步派发：
- `TaskManager.submit()` 收到服务端任务后立即返回 `{ status: 'running' }`
- Runner 在后台通过 `child_process.fork()` 或 Puppeteer 隔离执行
- 结果通过 TaskManager 事件（progress/log/result）异步广播到控制端
- 控制端 WebSocket 连接在任务执行期间不被阻塞，可以继续处理其他消息

### 显示端：Web Worker 隔离

浏览器显示端的用户任务通过 Web Worker 隔离执行：
- Worker 内解码文件、执行用户代码，不阻塞主线程
- 主线程仍可正常处理媒体播放、WebSocket 通信和 UI 更新
- 内置模型推理（model.inference）通过 WebGPU 异步执行，不受影响
- Worker 任务有 30 秒超时保护

## 控制端调试日志

TaskPanel 内置分级调试日志系统，通过 `_debug` 对象控制各类日志开关：

```js
_debug: {
  init: false,       // 初始化日志（init）
  polling: false,    // 3 秒轮询日志
  ws: false,         // WebSocket 挂载日志
  displayList: false,// 显示端列表拉取日志
  message: false     // 每条消息类型日志（最噪）
}

_log(cat, ...args)   // 统一日志入口，_debug[cat]=true 时输出
```

默认全部关闭。需要排查时在浏览器控制台执行 `TaskPanel._debug.message = true` 等单独开启。

## 注意事项

1. 服务端 CPU 任务通过 child_process.fork 隔离执行
2. GPU 任务通过 Puppeteer headless Chrome 执行（支持 WebGL/WebGPU）
3. 显示端浏览器执行时检测 capabilities (webgl/webgpu)
4. 每个实例独立结果目录，保留最近 50 个实例
5. 所有任务日志实时推送并持久化到 run.log
6. 转发到显示端/子显示端的任务，结果通过 task:result 回传
7. 服务端根据 env 字段自动路由到 NodeJsRunner 或 PuppeteerRunner
8. 控制端通过 taskName 关联事件和 UI
9. 内置任务应通过 taskType='builtin' + builtinId 提交；若误传为 taskType='user'，服务端 submit() 自动检测修正
10. 控制端 _runUserTask() 和 _runEditTask() 均检测 taskType，内置任务自动切换为内置提交路径
11. 实例名在 UI 中显示完整字符串 + title 悬浮提示，不再截断
12. one-shot 任务 Widget 使用硬编码默认值（不依赖 {{var}} 实时推送），未运行时参数面板始终可见
13. one-shot 任务通过 TaskPanel._saveWidgetGlobalConfig() 保存全局配置（task:set_config）
