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
  +-- taskType=builtin -> builtin-tasks/registry
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
```

## TaskManager 接口

```
class TaskManager extends EventEmitter {
  submit(task)         // 提交任务，返回 { taskName, instanceId, status }
  stopInstance(taskName, instanceId)  // 停止指定实例
  getInstance(instanceId)             // 按 instanceId 获取实例对象
  getInstanceStatus(taskName, instanceId?)  // 查询实例状态
  handleForwardResult(taskName, instanceId, result)  // 处理显示端/子显示端返回的结果
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

## 注意事项

1. 服务端 CPU 任务通过 child_process.fork 隔离执行
2. GPU 任务通过 Puppeteer headless Chrome 执行（支持 WebGL/WebGPU）
3. 显示端浏览器执行时检测 capabilities (webgl/webgpu)
4. 每个实例独立结果目录，保留最近 50 个实例
5. 所有任务日志实时推送并持久化到 run.log
6. 转发到显示端/子显示端的任务，结果通过 task:result 回传
7. 服务端根据 env 字段自动路由到 NodeJsRunner 或 PuppeteerRunner
8. 控制端通过 taskName 关联事件和 UI
