# WebGPU 渲染用户任务 - 实现文档

## 概述

`webgpu-render` 是用户任务，在显示端浏览器使用 WebGPU 渲染全蓝图片并持久化到服务端。

## 模块结构

```
用户任务:
  res/tasks/webgpu-render/task.js    任务逻辑、参数定义、widget

显示端:
  src/apps/web-mediacenter/ui/public/display.html   env=webgpu 检测 → 主线程执行
```

## 数据流

```text
控制端选择 webgpu-render 任务 → 选 target=display, env=webgpu
  → task:submit → 服务端创建 draft
  → task:run → taskManager.runInstance()
  → 检测 target=display → _forwardToDisplay()
  → 读取 res/tasks/webgpu-render/task.js 作为 files
  → task:execute { files: [task.js], env: webgpu, params }

显示端 executeTask()
  → payload.env === 'webgpu'
  → executeUserTaskMainThread(taskName, instanceId, entryCode, files, capabilities, params)
  → new Function('context', entryCode + '\nreturn run(context);')
  → task.js run(context) 执行:
      navigator.gpu.requestAdapter() → 先无参数，再 { powerPreference: 'high-performance' }，最后 { powerPreference: 'low-power' }
      OffscreenCanvas → WebGPU context → clear { r:0, g:0, b:1, a:1 }
      convertToBlob('image/png') → context.files['output.png'] = bytes
      return { outputFiles: ['output.png'] }
  → sendTaskResult(outputFiles: [{ name: 'output.png', data: base64 }])

服务端 handleForwardResult()
  → _handleResult() → 更新状态，通知控制端
  → saveOutputFiles() → 写入 res/tasks/webgpu-render/results/<instanceId>/output.png
```

## 执行环境路由

`display.html executeTask()` 中，`env=webgpu` 或 `env=webgl` 的用户任务跳过 Web Worker，直接在**主线程**执行 GPU 渲染：

```text
function executeTask(payload):
  if payload.builtinId == 'model.inference' → executeModelInference()

  // 用户任务
  解码 entryFile
  检测 capabilities (webgl, webgpu)

  if payload.env == 'webgpu' or payload.env == 'webgl':
    // GPU 任务需要主线程访问 API，跳过 Worker
    executeUserTaskMainThread(…)
    return

  // 普通 CPU 任务 → Web Worker 隔离
  try Worker → Worker 执行
  catch → executeUserTaskMainThread() 回退
```

不硬编码渲染逻辑，显示端只提供 GPU 主线程执行环境。

## 任务参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width  | number | 640 | 图片宽度 |
| height | number | 480 | 图片高度 |

## task.js 接口

```text
run(context):
  context.params      — 用户参数
  context.files       — 文件存储（Uint8Array），输出文件写入此对象
  context.capabilities — { cpu, webgl, webgpu }

  返回:
  {
    outputFiles: ['output.png'],   // context.files 中的文件名列表
    message: '...',
    width, height, sizeBytes       // 元数据
  }

params: Array<ParamDef>
widget: { html: '…' }
```

## 并发与阻塞防护

- WebGPU 渲染在主线程异步执行（await device.queue.onSubmittedWorkDone）
- 不阻塞显示端 WebSocket 接收、媒体播放等核心功能
- 30 秒转发超时由 taskManager._forwardToDisplay 默认保障
- GPU 任务不走 Web Worker，避免 Worker 无 WebGPU API 导致失败

## 显示端能力检测升级

`detectCapabilities()` 中 WebGPU 检测从浅层 `!!navigator.gpu` 升级为适配器探活：

```text
webgpu: !!navigator.gpu && await requestAdapter()  // 三层 powerPreference 回退
  → 成功获取 adapter → adapter.destroy() → return true
  → null/异常 → return false
```

确保控制端显示的能力信息反映真实 GPU 可用性，而非仅 API 存在。
