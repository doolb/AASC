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
| task-panel.js | 任务面板：三标签导航（列表/新建/监控）、编辑、结果查看、设备选择 |

## 数据流

```
控制端 task:submit -> 服务端 taskManager.submit()
  +-- taskType=builtin -> builtin-tasks/registry
  +-- target=server,env=cpu -> NodeJsRunner
  +-- target=server,env=webgl/webgpu -> PuppeteerRunner
  +-- target=display -> 转发 -> display.html executeTask()
  +-- target=subdisplay -> 转发 -> voice-display-node handleTaskExecute()

显示端/子显示端 -> task:result -> 服务端 -> task:result -> 控制端

TaskManager 事件 -> web-socket-handler -> task:progress/task:log/task:result -> 控制端 UI
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

web-socket-handler 将上述事件桥接到控制端：

```
progress -> task:progress { taskName, instanceId, stage, progress }
log       -> task:log       { taskName, instanceId, stream, level, message, timestamp }
result    -> task:result    { taskName, instanceId, success, data/error }
```

## 消息类型

详见 docs/design/remote-task-system.md

## 注意事项

1. 服务端 CPU 任务通过 child_process.fork 隔离执行
2. GPU 任务通过 Puppeteer headless Chrome 执行（支持 WebGL/WebGPU）
3. 显示端浏览器执行时检测 capabilities (webgl/webgpu)
4. 每个实例独立结果目录，保留最近 50 个实例
5. 所有任务日志实时推送并持久化到 run.log
6. 转发到显示端/子显示端的任务，结果通过 task:result 回传
7. 服务端根据 env 字段自动路由到 NodeJsRunner 或 PuppeteerRunner
8. 控制端通过 taskName 关联事件和 UI
