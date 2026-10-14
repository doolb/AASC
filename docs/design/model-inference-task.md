# 显示端模型推理任务设计

## 概述

在远程任务系统中增加模型推理能力，通过通用 ModelManager 架构管理多种 AI 模型，在显示端浏览器中执行推理。

## 2026-10-14 任务声明依赖并触发下载（已发布服务87/依赖10）

用户确认将 `onnxruntime-web` 从 Offline common 拆成独立任务依赖，由 `model.inference` 任务声明并在首次执行前自动准备。普通首装和页面打开不准备ORT；依赖完成后同页按需加载运行库，已校验缓存供后续任务和重启后离线复用。下载落在负责提供显示网页的Node服务；Offline Android的服务就在本机。

基础清单保持四组，在签名components旁增加taskDependencies。包按代码锁的真实版本校验，使用独立缓存，避免运行时改变基础依赖指纹；任务停止后不再继续执行，失败返回任务错误，可重试。`onnxruntime-web`移到optionalDependencies使既有Node/Android生产锁验证允许其缺席。当前仅拆ORT包本身，其其他小型共享依赖继续留在基础组。

enterprise评审：主L6、次L7，置信度0.77，88/100，风险中，可开发；下放L4为任务声明→基础分包→签名制品→准备缓存→懒加载。实施记录：`docs/task/20261014_模型推理依赖按任务触发下载.md`；伪代码：`docs/spec/model-inference-task.md`。

实现使用 `TaskDependencyManager` 在任务运行前准备，缓存附带原签名清单并核对真实文件指纹，重启后无需联网即可复用。同一包并发任务共享准备Promise；下载/版本/指纹失败终止该任务，停止等待的任务不再派发。网页先检查WebGPU，再懒加载支持该后端的 `ort.webgpu.min.js`，WASM目录固定为服务同源 `/js/lib/`。基础common及新完整Offline APK资产均剔除ORT本身；独立ORT v10、基础common v10及服务87已正式发布，旧APK内原有ORT需更新或干净min安装后再核对物理占用。

`npm run test:task-dependencies`106/106，真实Chromium `test:task-dependencies:browser`1/1通过。服务87/依赖10及独立ORT10已发布，min54干净首装已验证新版基础依赖；common展开约130MiB，首装不下载ORT。真实LFM-VL模型/GPU推理仍待验收。其他后续TTS修改要求servicePackage/minApk=true，dependenciesPackage=false。

## 系统架构

```
控制端 (task-panel.js)
  │ task:submit { builtinId: "model.inference", modelId, image, prompt }
  ▼
服务端 task-manager
  │ target=display 转发
  ▼
显示端 executeTask()
  │
  ▼
ModelManager.run(modelId, params)
  ├── 按需 load() 模型
  ├── ONNX Runtime Web + WebGPU 推理
  └── 返回结果
      │
      ▼
  服务端 → 控制端 (结果展示)
```

## 模型文件目录

```
res/models/
  ├── lfm-vl/                    ← LFM2.5-VL-1.6B 视觉语言模型
  │   ├── embed_images_fp16.onnx ← 视觉编码器
  │   ├── decoder_q4.onnx        ← 语言解码器 (Q4量化)
  │   └── config.json            ← 模型配置
  └── (其他模型，后续扩展)
```

模型文件从 ModelScope/HuggingFace 通过脚本拉取到服务端，通过 Express 静态路由对外暴露。

## ModelManager（显示端）

通用模型管理器，管理所有模型的生命周期。

```
class ModelManager {
  // 内部状态
  adapters: Map<modelId, ModelAdapter>   // 已注册适配器
  loadQueue: Map<modelId, Promise>       // 正在加载中的模型
  runningTasks: Map<instanceId, AbortController>

  // 注册适配器
  register(modelId, adapter)

  // 生命周期
  async load(modelId)        → 按需加载模型，返回是否成功
  async unload(modelId)      → 释放显存
  async run(modelId, params) → 执行推理
  releaseAll()               → 全部释放

  // 查询
  getLoadedModels()          → 已加载模型列表
  isModelReady(modelId)      → 模型是否就绪
  getModelStatus()           → 全部模型状态
}
```

### 加载策略

| 时机 | 行为 |
|------|------|
| 首次 run() | 自动 load，同时推 task:progress 下载进度 |
| 同时多个 run(同一模型) | 队列化，串行推理 |
| 后一个 run 要换模型 | 自动 unload 当前，load 新模型 |
| 浏览器不支持 WebGPU | 直接返回错误，能力声明中不报告 webgpu |

## ModelAdapter 接口

每种模型实现一个 adapter，统一生命周期：

```javascript
// ModelAdapter 接口定义 (抽象契约)
{
  modelId: 'lfm-vl',           // 唯一标识
  state: 'unloaded',           // unloaded | loading | ready | error

  async load(baseUrl)          // 加载模型（下载 ONNX 文件到 WebGPU）
  async process(params)        // 推理 { image, prompt } → { text, metrics }
  async release()              // 释放显存和 session
  estimateVRAM()               // 预估显存占用
}
```

## LfmVlAdapter

### 模型文件

| 文件 | 大小 | 作用 | 运行时 |
|------|------|------|--------|
| `embed_images_fp16.onnx` | ~200MB | 视觉编码器 | ORT WebGPU |
| `decoder_q4.onnx` | ~900MB | 语言解码器 | ORT WebGPU |

合计约 1.1GB 显存，Q4 解码器适配 WebGPU 约束。

### process 执行流程

```
1. fetch(imageUrl) → 图片数据
2. 预处理:
   - canvas resize 到 336x336
   - normalize (mean/std 标准化)
   - NHWC → NCHW 格式转换
3. embed_images.run(imageTensor)
   → imageFeatures (视觉特征向量)
4. 拼接完整输入:
   - prompt → tokenize → token_ids
   - 格式: <image_token> + prompt_tokens
5. decoder.run(inputTokens, imageFeatures) 自回归推理:
   - 逐 token 生成
   - greedy / top-k 采样
   - 遇 <EOS> 停止
6. detokenize → 完整文本
7. 统计指标：
   - totalDuration: 总耗时 ms
   - ttft: 首 token 延迟 ms (time to first token)
   - tokensPerSecond: 生成速度 tokens/s
   - totalTokens: 生成 token 数
8. 返回 { text: "描述结果", metrics: { totalDuration, ttft, tokensPerSecond, totalTokens } }
```

### Tokenizer

- 方式 A：用独立的 tokenizer.onnx 模型（如果有），经 ORT 推理分词
- 方式 B：JS 实现轻量 BPE（匹配 LFM 词表）

优先方式 A，文件不存在则用方式 B。

## 控制端消息流

### 提交任务

```javascript
// 控制端 → 服务端
{
  type: "task:submit",
  payload: {
    taskType: "builtin",
    builtinId: "model.inference",
    taskName: "模型推理",
    target: "display",
    displayId: "display-uuid",
    params: {
      modelId: "lfm-vl",
      prompt: "请详细描述这张图片"
    },
    files: [
      { name: "input.jpg", data: "<base64>" }
    ]
  }
}
```

### 服务端处理

```javascript
// 服务端收到提交后:
// 1. 保存图片到 res/tasks/model-inference/{instanceId}/input.jpg
// 2. 生成静态 URL
// 3. 转发到显示端
{
  type: "task:execute",
  payload: {
    taskName: "model-inference",
    instanceId: "a1b2c3",
    builtinId: "model.inference",
    params: {
      modelId: "lfm-vl",
      prompt: "请详细描述这张图片",
      imageUrl: "/res/tasks/model-inference/a1b2c3/input.jpg"
    },
    env: "webgpu"
  }
}
```

### 显示端 → 服务端

```javascript
// 进度推送
{ type: "task:progress", payload: { taskName, instanceId, stage: "loading-model", progress: 30 } }
{ type: "task:progress", payload: { taskName, instanceId, stage: "running", progress: 60 } }

// 推理结果 (含 token 速度指标)
{ type: "task:result", payload: { taskName, instanceId, success: true, outputFiles: [
  { name: "result.json", data: "<base64>" }
], metrics: { duration: 1234, ttft: 320, tokensPerSecond: 25.3, totalTokens: 128 } } }
```

## 内置任务注册（服务端）

`src/apps/server/modules/task-engine/builtin-tasks/model-inference.js`：

```javascript
module.exports = {
  id: 'model.inference',
  name: '模型推理',
  params: [
    {
      name: 'modelId',
      type: 'select',
      required: true,
      options: ['lfm-vl'],
      label: '模型'
    },
    {
      name: 'image',
      type: 'file',
      required: true,
      label: '图片'
    },
    {
      name: 'prompt',
      type: 'string',
      required: false,
      default: '请详细描述这张图片',
      label: '提示词'
    },
    {
      name: 'targetDisplay',
      type: 'displaySelect',
      required: true,
      label: '目标显示端'
    }
  ],
  target: 'display',

  async run(context) {
    // 服务端职责：保存图片 → 生成 URL → 路由到显示端
    const imageFile = context.files['image'];
    if (!imageFile) throw new Error('缺少图片文件');

    const imagePath = `model-inference/${context.instanceId}/input.jpg`;
    await context.taskIO.saveTaskFile(context.taskName, imagePath, imageFile);

    return {
      forwardTo: 'display',
      params: {
        modelId: context.params.modelId,
        prompt: context.params.prompt || '请详细描述这张图片',
        imageUrl: `/res/tasks/${context.taskName}/${imagePath}`
      }
    };
  }
};
```

## 控制端 UI 变更（task-panel.js）

内置任务标签页增加"模型推理"入口：

- 模型选择：下拉框，动态从服务器注册列表加载
- 图片上传：拖拽/点击选择 + 预览缩略图
- 提示词输入：文本框，支持回车快捷提交
- 目标显示端：下拉列表，标注 WebGPU 能力
- 结果展示区：显示模型返回文本

**显示端选择逻辑：** 只有 capabilities 中包含 webgpu = true 的显示端才出现在下拉列表中。

## 显示端 executeTask 增强

在 `display.html` 中:

```javascript
// executeTask 函数增加 builtin 分支
function executeTask(payload) {
  if (payload.builtinId === 'model.inference') {
    executeModelInference(payload);
    return;
  }
  // ...原有逻辑
}

async function executeModelInference(payload) {
  const { instanceId, params } = payload;
  const { modelId, prompt, imageUrl } = params;

  if (!modelManager.isModelReady(modelId)) {
    sendProgress(instanceId, 'loading-model', 10);
    await modelManager.load(modelId);
  }

  sendProgress(instanceId, 'running', 50);
  const result = await modelManager.run(modelId, {
    imageUrl,
    prompt,
    signal: getAbortSignal(instanceId)
  });

  sendTaskResult(payload.taskName, instanceId, true, null, [
    { name: 'result.json', data: btoa(JSON.stringify(result)) }
  ], result.metrics);
}
```

## 模型下载脚本

`scripts/models/download-lfm-vl-model.js`：

```javascript
// 从 ModelScope 下载 LFM2.5-VL-1.6B-ONNX 模型文件
// node scripts/models/download-lfm-vl-model.js
// 下载到 res/models/lfm-vl/
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 显示端不支持 WebGPU | 提交前在控制端禁用，提示用户 |
| 模型加载失败 | 推 task:error + 详细错误，控制端展示 |
| WebGPU 设备丢失 (device loss) | 自动重置 session，重新加载模型 |
| 推理超时 | 默认 60s，超时自动取消并释放显存 |
| 中途停止 | 支持 task:stop → AbortController → 释放推理中间状态 |

## 未来扩展

### 更多模型

只需要新写一个 ModelAdapter 实现 + 注册到 ModelManager，无需改动其他代码。

### 服务端 OpenAI API

服务端增加推理端点时，可以复用同一套 Adapter（用 onnxruntime-node）：

```
/v1/chat/completions
  → 服务端 ModelManager
  → 服务端 ModelAdapter (与显示端相同的接口)
  → 返回 OpenAI 格式响应
```

### ASR 任务化

后续 asr（sherpa-onnx WASM）可以包装为 `AsrAdapter`，统一走 ModelManager 生命周期：

```javascript
modelManager.register('asr', new AsrAdapter());
// 与 LfmVlAdapter 共用 load/process/release 接口
```

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/apps/web-mediacenter/ui/public/display.html` | 显示端，新增 ModelManager + LfmVlAdapter |
| `src/apps/server/modules/task-engine/builtin-tasks/model-inference.js` | 内置任务注册 |
| `src/apps/web-mediacenter/ui/public/js/task-panel.js` | 控制端 UI |
| `scripts/models/download-lfm-vl-model.js` | 模型下载脚本 |
| `res/models/lfm-vl/` | 模型文件目录 |
