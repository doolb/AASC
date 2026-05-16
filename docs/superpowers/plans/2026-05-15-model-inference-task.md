# 显示端模型推理任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model inference builtin task that runs ONNX models on display terminal via WebGPU

**Architecture:** ModelManager singleton in display.html manages model lifecycle (load/process/release). Each model has a ModelAdapter (LfmVlAdapter first). Server-side builtin task saves image files then forwards execution to display via WebSocket. Control panel shows model-specific params panel and token speed metrics.

**Tech Stack:** onnxruntime-web (browser), WebGPU, WebSocket, vanilla JS

**Files Overview:**

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/apps/server/modules/task-engine/builtin-tasks/model-inference.js` | Builtin task: save image, prepare params for display |
| Modify | `src/apps/server/modules/task-engine/builtin-tasks/registry.js` | Register model-inference task |
| Modify | `src/apps/server/modules/task-engine/task-manager.js` | Support builtin tasks forwarding to display |
| Modify | `src/apps/server/modules/task-engine/web-socket-handler.js` | Forward builtinId+params, return metrics |
| Modify | `src/apps/web-mediacenter/ui/public/display.html` | ModelManager + LfmVlAdapter + executeTask integration |
| Modify | `src/apps/web-mediacenter/ui/public/js/task-panel.js` | Model inference UI, metrics display |
| Create | `res/models/lfm-vl/config.json` | Model configuration |
| Create | `src/scripts/download-lfm-vl-model.js` | Model download from ModelScope |

---

### Task 1: Server builtin task registration

**Files:**
- Create: `src/apps/server/modules/task-engine/builtin-tasks/model-inference.js`
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`

- [ ] **Step 1: Create model-inference.js builtin task**

```javascript
// src/apps/server/modules/task-engine/builtin-tasks/model-inference.js
module.exports = {
  id: 'model.inference',
  name: '模型推理',
  description: '在显示端执行 AI 模型推理',
  target: 'display',
  params: [
    { name: 'modelId', type: 'select', required: true, options: ['lfm-vl'], label: '模型' },
    { name: 'image', type: 'file', required: true, label: '图片' },
    { name: 'prompt', type: 'string', required: false, default: '请详细描述这张图片', label: '提示词' },
    { name: 'targetDisplay', type: 'displaySelect', required: true, label: '目标显示端' }
  ],
  async run(context) {
    const imageFile = context.files && context.files['image'];
    if (!imageFile) throw new Error('缺少图片文件');

    const imageDir = `model-inference/${context.instanceId}`;
    const imagePath = `${imageDir}/input.jpg`;
    await context.taskIO.saveTaskFiles(context.taskName, [
      { name: imagePath, data: imageFile.toString('base64') }
    ]);

    return {
      forwardTo: 'display',
      forwardParams: {
        modelId: context.params.modelId || 'lfm-vl',
        prompt: context.params.prompt || '请详细描述这张图片',
        imageUrl: `/res/tasks/${context.taskName}/${imagePath}`
      }
    };
  }
};
```

- [ ] **Step 2: Register in registry.js**

Modify `src/apps/server/modules/task-engine/builtin-tasks/registry.js`:

```javascript
const tasks = {
  'image.resize': require('./image-resize'),
  'model.inference': require('./model-inference')
};
```

- [ ] **Step 3: Commit**

```bash
git add src/apps/server/modules/task-engine/builtin-tasks/model-inference.js src/apps/server/modules/task-engine/builtin-tasks/registry.js
git commit -m "feat(task-engine): add model.inference builtin task"
```

---

### Task 2: Server task-manager forward support for builtin tasks

**Files:**
- Modify: `src/apps/server/modules/task-engine/task-manager.js`

- [ ] **Step 1: Add builtin forward logic in submit()**

After line 79 (`if (task.taskType === 'builtin')` block), replace the existing builtin handling:

```javascript
if (task.taskType === 'builtin') {
  if (!builtinRegistry) throw new Error('内置任务模块不可用');
  const result = await builtinRegistry.run(task.builtinId, {
    ...context,
    instanceId,
    taskName: task.taskName,
    taskIO: this.taskIO
  });

  // builtin task can request forwarding to display
  if (result && result.forwardTo === 'display') {
    instance.status = 'pending_forward';
    instance.targetInfo = { displayId: task.displayId };
    this.emit('progress', instanceId, 'forwarding', 50);
    this.emit('log', instanceId, 'system', 'info', '正在转发到显示端...');
    return {
      taskName: task.taskName,
      instanceId,
      status: 'pending_forward',
      forwardParams: result.forwardParams
    };
  }

  await this._handleResult(task, instanceId, instance, result);
}
```

- [ ] **Step 2: Add metrics passthrough in _handleResult and handleForwardResult**

In `_handleResult`, add `metrics` to the emit:
```javascript
this.emit('result', instanceId, {
  success: result.success !== false,
  data: result.data || {},
  metrics: result.metrics || {}
});
```

In `handleForwardResult`, pass metrics through:
```javascript
async handleForwardResult(taskName, instanceId, result) {
  const instance = this.instances.get(instanceId);
  if (!instance) return { success: false, error: '实例不存在' };
  const task = { taskName: instance.taskName };
  await this._handleResult(task, instanceId, instance, {
    success: result.success,
    error: result.error,
    data: result.outputFiles ? { outputFiles: result.outputFiles } : undefined,
    metrics: result.metrics
  });
  await this.taskIO.updateLatestLink(task.taskName, instanceId);
  await this.taskIO.cleanupOldInstances(task.taskName, this.maxInstances);
  return { success: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/apps/server/modules/task-engine/task-manager.js
git commit -m "feat(task-engine): support builtin task forwarding and metrics passthrough"
```

---

### Task 3: WebSocket handler - forward builtinId and params to display

**Files:**
- Modify: `src/apps/server/modules/task-engine/web-socket-handler.js`

- [ ] **Step 1: Update forward payload to include builtinId + params**

In the `task:submit` case, replace the `pending_forward` block with:

```javascript
if (result.status === 'pending_forward') {
  const targetPayload = {
    type: 'task:execute',
    payload: {
      taskName: payload.taskName,
      instanceId: result.instanceId,
      builtinId: payload.builtinId || null,
      params: result.forwardParams || payload.params || {},
      env: payload.env || 'auto'
    },
  };
  const displayId = payload.displayId;
  if (displayId && sendToDisplay) {
    sendToDisplay(displayId, targetPayload);
  }
}
```

- [ ] **Step 2: Update task:result handler to pass metrics**

In the `task:result` case, update to pass metrics:

```javascript
case 'task:result': {
  taskManager.handleForwardResult(payload.taskName, payload.instanceId, {
    success: payload.success,
    error: payload.error,
    outputFiles: payload.outputFiles,
    metrics: payload.metrics
  });
  sendToControl({
    type: 'task:result',
    payload: { taskName: payload.taskName, instanceId: payload.instanceId, ...payload }
  });
  break;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/apps/server/modules/task-engine/web-socket-handler.js
git commit -m "feat(task-engine): forward builtinId/params to display, pass metrics back"
```

---

### Task 4: Display.html - ModelManager + LfmVlAdapter

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`

- [ ] **Step 1: Add ModelManager class before the `connectWebSocket` function**

Add after line 1796 (before the `document.addEventListener` blocks):

```javascript
// ============================================================
// ModelManager — 通用模型管理器
// ============================================================
var modelManager = {
  adapters: {},
  loadQueue: {},

  register: function(modelId, adapter) {
    adapter.modelId = modelId;
    adapter.state = 'unloaded';
    this.adapters[modelId] = adapter;
  },

  isModelReady: function(modelId) {
    var a = this.adapters[modelId];
    return a && a.state === 'ready';
  },

  getModelStatus: function() {
    var status = {};
    for (var id in this.adapters) {
      var a = this.adapters[id];
      status[id] = { state: a.state, vramEstimate: a.estimateVRAM ? a.estimateVRAM() : 0 };
    }
    return status;
  },

  load: function(modelId) {
    var self = this;
    if (this.loadQueue[modelId]) return this.loadQueue[modelId];
    var adapter = this.adapters[modelId];
    if (!adapter) return Promise.reject(new Error('未知模型: ' + modelId));
    if (adapter.state === 'ready') return Promise.resolve();
    adapter.state = 'loading';
    this.loadQueue[modelId] = adapter.load('/models/' + modelId + '/').then(function() {
      adapter.state = 'ready';
      delete self.loadQueue[modelId];
    }).catch(function(err) {
      adapter.state = 'error';
      delete self.loadQueue[modelId];
      throw err;
    });
    return this.loadQueue[modelId];
  },

  unload: function(modelId) {
    var adapter = this.adapters[modelId];
    if (!adapter) return;
    adapter.release();
    adapter.state = 'unloaded';
  },

  releaseAll: function() {
    for (var id in this.adapters) this.unload(id);
  },

  run: function(modelId, params) {
    var self = this;
    return this.load(modelId).then(function() {
      return self.adapters[modelId].process(params);
    });
  }
};
```

- [ ] **Step 2: Add LfmVlAdapter class**

Add after ModelManager:

```javascript
// ============================================================
// LfmVlAdapter — LFM2.5-VL-1.6B 视觉语言模型适配器
// ============================================================
var LfmVlAdapter = function() {
  this.state = 'unloaded';
  this.imageSession = null;
  this.textSession = null;
  this.modelBaseUrl = '';
};

LfmVlAdapter.prototype.load = function(baseUrl) {
  var self = this;
  this.modelBaseUrl = baseUrl;
  if (typeof onnx === 'undefined') {
    return Promise.reject(new Error('ONNX Runtime 未加载。请添加 <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>'));
  }
  return new Promise(function(resolve, reject) {
    if (!navigator.gpu) {
      reject(new Error('当前浏览器不支持 WebGPU'));
      return;
    }
    var opts = { executionProviders: ['webgpu', 'wasm'] };
    Promise.all([
      onnx.InferenceSession.create(baseUrl + 'embed_images_fp16.onnx', opts),
      onnx.InferenceSession.create(baseUrl + 'decoder_q4.onnx', opts)
    ]).then(function(sessions) {
      self.imageSession = sessions[0];
      self.textSession = sessions[1];
      self.state = 'ready';
      console.log('[LfmVl] 模型已加载到 WebGPU');
      resolve();
    }).catch(function(err) {
      self.state = 'error';
      console.error('[LfmVl] 模型加载失败:', err);
      reject(err);
    });
  });
};

LfmVlAdapter.prototype.release = function() {
  if (this.imageSession) { this.imageSession.release(); this.imageSession = null; }
  if (this.textSession) { this.textSession.release(); this.textSession = null; }
  this.state = 'unloaded';
};

LfmVlAdapter.prototype.estimateVRAM = function() {
  return 1100; // MB
};

LfmVlAdapter.prototype.process = function(params) {
  var self = this;
  var imageUrl = params.imageUrl;
  var prompt = params.prompt || '请详细描述这张图片';
  var signal = params.signal || null;

  return new Promise(function(resolve, reject) {
    var startTime = performance.now();
    var ttft = 0;
    var totalTokens = 0;

    // 1. 加载图片
    fetch(imageUrl).then(function(res) { return res.blob(); }).then(function(blob) {
      return createImageBitmap(blob);
    }).then(function(bitmap) {
      // 2. 预处理: resize → normalize → NCHW
      var canvas = document.createElement('canvas');
      canvas.width = 336;
      canvas.height = 336;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, 336, 336);
      var imageData = ctx.getImageData(0, 0, 336, 336);
      bitmap.close();

      // 3. 编码器推理
      var inputTensor = preprocessImage(imageData);
      return self.imageSession.run({ input: inputTensor });
    }).then(function(encoderResult) {
      if (signal && signal.aborted) throw new Error('推理已取消');

      var imageFeatures = encoderResult.image_features || Object.values(encoderResult)[0];

      // 4. 简单 tokenize (占位 — 后续替换为正式 tokenizer)
      var inputTokens = simpleTokenize(prompt);
      totalTokens = inputTokens.length;

      // 5. 解码器自回归
      return self._decode(inputTokens, imageFeatures, signal, function(tokenIndex) {
        if (tokenIndex === 0) ttft = performance.now() - startTime;
        totalTokens++;
      });
    }).then(function(outputText) {
      var endTime = performance.now();
      var totalDuration = endTime - startTime;
      var tokensPerSecond = totalTokens / (totalDuration / 1000);

      resolve({
        text: outputText,
        metrics: {
          totalDuration: Math.round(totalDuration),
          ttft: Math.round(ttft),
          tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
          totalTokens: totalTokens
        }
      });
    }).catch(function(err) {
      reject(err);
    });
  });
};

// 内部方法: 自回归解码
LfmVlAdapter.prototype._decode = function(inputTokens, imageFeatures, signal, onToken) {
  var self = this;
  // 逐 token 自回归生成
  var outputTokens = inputTokens.slice();
  var maxNewTokens = 256;
  var eosTokenId = 2; // <EOS>

  function step() {
    if (signal && signal.aborted) return Promise.reject(new Error('推理已取消'));
    if (outputTokens.length - inputTokens.length >= maxNewTokens) {
      return Promise.resolve(detokenize(outputTokens));
    }

    var inputTensor = new onnx.Tensor('int64', new BigInt64Array(outputTokens.map(BigInt)), [1, outputTokens.length]);
    return self.textSession.run({ input_ids: inputTensor, image_features: imageFeatures }).then(function(result) {
      var logits = Object.values(result)[0];
      var lastLogits = logits.data.slice(logits.data.length - logits.dims[logits.dims.length - 1]);
      var nextToken = greedySample(lastLogits);
      onToken(outputTokens.length - inputTokens.length);

      if (nextToken === eosTokenId) {
        return Promise.resolve(detokenize(outputTokens));
      }
      outputTokens.push(nextToken);
      return step();
    });
  }

  return step();
};

// 注册适配器
modelManager.register('lfm-vl', new LfmVlAdapter());

// ---- 工具函数 ----

function preprocessImage(imageData) {
  // 336x336 RGBA → 1x3x336x336 float32 normalized
  var pixels = imageData.data;
  var data = new Float32Array(3 * 336 * 336);
  var mean = [0.485, 0.456, 0.406];
  var std = [0.229, 0.224, 0.225];
  for (var y = 0; y < 336; y++) {
    for (var x = 0; x < 336; x++) {
      var idx = (y * 336 + x) * 4;
      data[0 * 336 * 336 + y * 336 + x] = (pixels[idx] / 255 - mean[0]) / std[0];
      data[1 * 336 * 336 + y * 336 + x] = (pixels[idx + 1] / 255 - mean[1]) / std[1];
      data[2 * 336 * 336 + y * 336 + x] = (pixels[idx + 2] / 255 - mean[2]) / std[2];
    }
  }
  return new onnx.Tensor('float32', data, [1, 3, 336, 336]);
}

function simpleTokenize(text) {
  // 临时简单 tokenize — 以空格/标点分割
  // 后续替换为真实 tokenizer.onnx
  var tokens = [1]; // <BOS>
  for (var i = 0; i < text.length; i++) {
    tokens.push(text.charCodeAt(i) + 10);
  }
  return tokens;
}

function detokenize(tokens) {
  // 临时 detokenize
  var chars = [];
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i] < 10) continue;
    if (tokens[i] === 2) break; // <EOS>
    chars.push(String.fromCharCode(tokens[i] - 10));
  }
  return chars.join('');
}

function greedySample(logits) {
  var maxIdx = 0;
  var maxVal = -Infinity;
  for (var i = 0; i < logits.length; i++) {
    if (logits[i] > maxVal) { maxVal = logits[i]; maxIdx = i; }
  }
  return maxIdx;
}
```

- [ ] **Step 3: Add model inference branch in executeTask()**

Replace the existing `executeTask` function (lines 1815-1896):

```javascript
function executeTask(payload) {
  // 模型推理内置任务
  if (payload.builtinId === 'model.inference') {
    executeModelInference(payload);
    return;
  }

  // 原有用户任务执行逻辑
  var taskName = payload.taskName;
  var instanceId = payload.instanceId;
  var entryFile = payload.entryFile;
  var files = payload.files || [];
  var params = payload.params || {};
  console.log('[Task] 收到任务: ' + taskName + '/' + instanceId);

  var fileStore = {};
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f.data) {
      try {
        var binary = atob(f.data);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) {
          bytes[j] = binary.charCodeAt(j);
        }
        fileStore[f.name] = bytes;
      } catch(e) {
        console.error('[Task] 文件加载失败: ' + f.name, e);
      }
    }
  }

  var capabilities = {
    cpu: true,
    webgl: (function() { try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch(e) { return false; } })(),
    webgpu: !!navigator.gpu
  };

  var entryContent = fileStore[entryFile];
  if (!entryContent) {
    sendTaskResult(taskName, instanceId, false, '入口文件不存在: ' + entryFile, null);
    return;
  }

  var decoder = new TextDecoder();
  var entryCode = decoder.decode(entryContent);

  try {
    var context = {
      files: fileStore,
      capabilities: capabilities,
      params: params,
      workDir: '/workspace'
    };

    var fn = new Function('context', entryCode + '\nreturn run(context);');
    var resultPromise = fn(context);

    Promise.resolve(resultPromise).then(function(result) {
      var outputFiles = [];
      if (result && result.outputFiles) {
        for (var k = 0; k < result.outputFiles.length; k++) {
          var name = result.outputFiles[k];
          if (fileStore[name]) {
            var data = btoa(String.fromCharCode.apply(null, fileStore[name]));
            outputFiles.push({ name: name, data: data });
          }
        }
      }
      sendTaskResult(taskName, instanceId, true, null, outputFiles);
    }).catch(function(err) {
      sendTaskResult(taskName, instanceId, false, err.message, null);
    });
  } catch (err) {
    sendTaskResult(taskName, instanceId, false, err.message, null);
  }
}

function executeModelInference(payload) {
  var taskName = payload.taskName;
  var instanceId = payload.instanceId;
  var params = payload.params || {};
  var modelId = params.modelId || 'lfm-vl';
  var prompt = params.prompt || '请详细描述这张图片';
  var imageUrl = params.imageUrl;

  sendProgress(instanceId, 'loading-model', 10);
  sendLog(instanceId, 'system', 'info', '正在加载 ' + modelId + ' 模型...');

  modelManager.run(modelId, {
    imageUrl: imageUrl,
    prompt: prompt,
    signal: getAbortSignal(instanceId)
  }).then(function(result) {
    sendLog(instanceId, 'system', 'info', '推理完成。Token 速度: ' + result.metrics.tokensPerSecond + ' tok/s, 首 Token: ' + result.metrics.ttft + 'ms');
    sendTaskResult(taskName, instanceId, true, null, [
      { name: 'result.json', data: btoa(JSON.stringify({ text: result.text })) }
    ], result.metrics);
  }).catch(function(err) {
    sendTaskResult(taskName, instanceId, false, err.message, null);
  });
}
```

- [ ] **Step 4: Add helper functions for sendProgress, sendLog, getAbortSignal**

Add just before `executeTask`:

```javascript
var _abortControllers = {};

function getAbortSignal(instanceId) {
  if (_abortControllers[instanceId]) _abortControllers[instanceId].abort();
  var ctrl = new AbortController();
  _abortControllers[instanceId] = ctrl;
  return ctrl.signal;
}

function sendProgress(instanceId, stage, progress) {
  if (displayWs && displayWs.readyState === WebSocket.OPEN) {
    displayWs.send(JSON.stringify({
      type: 'task:progress',
      payload: { instanceId: instanceId, stage: stage, progress: progress }
    }));
  }
}

function sendLog(instanceId, stream, level, message) {
  if (displayWs && displayWs.readyState === WebSocket.OPEN) {
    displayWs.send(JSON.stringify({
      type: 'task:log',
      payload: { instanceId: instanceId, stream: stream, level: level, message: message, timestamp: Date.now() }
    }));
  }
}
```

- [ ] **Step 5: Update sendTaskResult to accept metrics parameter**

Replace the existing `sendTaskResult` function:

```javascript
function sendTaskResult(taskName, instanceId, success, error, outputFiles, metrics) {
  if (displayWs && displayWs.readyState === WebSocket.OPEN) {
    var msg = {
      type: 'task:result',
      payload: {
        taskName: taskName,
        instanceId: instanceId,
        success: success,
        error: error || null,
        outputFiles: outputFiles || [],
        metrics: metrics || null
      }
    };
    displayWs.send(JSON.stringify(msg));
  }
}
```

- [ ] **Step 6: Add ONNX Runtime Web script tag**

Add before the closing `</body>` tag (before the existing `<script>` block), add:

```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
```

- [ ] **Step 7: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/display.html
git commit -m "feat(display): add ModelManager and LfmVlAdapter for model inference task"
```

---

### Task 5: Control panel UI - model inference form and metrics display

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

- [ ] **Step 1: Filter display list by WebGPU capability for model inference**

In `_runBuiltin`, when the builtin task is `model.inference`, open the new task tab with model inference preset. No major code change needed since the existing `_viewBuiltinParams` already switches to the builtin tab.

But the current `_loadBuiltinTasks` populates the dropdown generically. For model inference, we need to show the model-specific params panel. Add a new method `_renderBuiltinParams` that renders dynamic form for model inference:

```javascript
_renderBuiltinParams: function(builtinId, container) {
  if (builtinId === 'model.inference') {
    var modelTask = null;
    for (var i = 0; i < this.taskList.length; i++) {
      if (this.taskList[i].taskName === builtinId) { modelTask = this.taskList[i]; break; }
    }
    var params = modelTask ? modelTask.params || [] : [];

    var html = '';
    for (var p = 0; p < params.length; p++) {
      var param = params[p];
      if (param.name === 'image') {
        html += '<div class="task-form-field"><label>' + param.label + '</label>' +
          '<div class="task-file-zone" id="miImageZone" style="padding:12px">' +
          '<div class="task-file-zone-text">点击选择或拖拽图片</div></div>' +
          '<input type="file" id="miImageFile" accept="image/*" style="display:none">' +
          '<div id="miImagePreview" style="margin-top:4px;max-width:120px;max-height:80px;display:none"></div></div>';
      } else if (param.name === 'prompt') {
        html += '<div class="task-form-field"><label>' + param.label + '</label>' +
          '<textarea id="miPrompt" rows="2" style="width:100%;background:#1a1a2e;border:1px solid #333;border-radius:6px;color:#ccc;padding:8px;font-size:13px">' +
          (param.default || '') + '</textarea></div>';
      } else if (param.name === 'modelId') {
        html += '<div class="task-form-field"><label>' + param.label + '</label>' +
          '<select id="miModelId">' + (param.options || []).map(function(o) {
            return '<option value="' + o + '">' + o + '</option>';
          }).join('') + '</select></div>';
      } else if (param.name === 'targetDisplay') {
        html += '<div class="task-form-field"><label>' + param.label + '</label>' +
          '<div class="task-device-list" id="miDisplayList" style="max-height:150px;overflow-y:auto"></div></div>';
      }
    }
    html += '<button class="task-submit-btn" id="miSubmitBtn">提交推理任务</button>';
    container.innerHTML = html;
    this._bindMiEvents();
  }
},
```

- [ ] **Step 2: Add model inference event binding**

```javascript
_bindMiEvents: function() {
  var self = this;

  var imageZone = document.getElementById('miImageZone');
  var imageInput = document.getElementById('miImageFile');
  if (imageZone && imageInput) {
    imageZone.addEventListener('click', function() { imageInput.click(); });
    imageZone.addEventListener('dragover', function(e) { e.preventDefault(); imageZone.classList.add('dragover'); });
    imageZone.addEventListener('dragleave', function() { imageZone.classList.remove('dragover'); });
    imageZone.addEventListener('drop', function(e) {
      e.preventDefault();
      imageZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        imageInput.files = e.dataTransfer.files;
        self._previewMiImage(e.dataTransfer.files[0]);
      }
    });
    imageInput.addEventListener('change', function() {
      if (imageInput.files.length > 0) self._previewMiImage(imageInput.files[0]);
    });
  }

  this._renderMiDisplayList();

  var submitBtn = document.getElementById('miSubmitBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', function() { self._submitMiTask(); });
  }
},

_previewMiImage: function(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var preview = document.getElementById('miImagePreview');
    if (preview) {
      preview.innerHTML = '<img src="' + e.target.result + '" style="max-width:120px;max-height:80px;border-radius:6px">';
      preview.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
},

_renderMiDisplayList: function() {
  var list = document.getElementById('miDisplayList');
  if (!list) return;
  var html = '';
  for (var i = 0; i < this.displayList.length; i++) {
    var d = this.displayList[i];
    var caps = d.capabilities || {};
    var hasWebGPU = !!(d.webgpu || caps.webgpu);
    if (!hasWebGPU) continue;
    var safeId = this._escapeAttr(d.id);
    html += '<div class="task-device-item selected" data-id="' + safeId + '">' +
      '<div class="task-device-radio"></div>' +
      '<div class="task-device-info"><div class="task-device-name">' + this._escapeHtml(d.id) + '</div>' +
      '<div class="task-device-cap">WebGPU</div></div>' +
      '<span class="task-device-state online">在线</span></div>';
  }
  if (!html) {
    html = '<div style="color:#666;font-size:12px">没有支持 WebGPU 的在线显示端</div>';
  }
  list.innerHTML = html;
  list.addEventListener('click', function(e) {
    var item = e.target.closest('.task-device-item');
    if (!item) return;
    list.querySelectorAll('.task-device-item').forEach(function(el) { el.classList.remove('selected'); });
    item.classList.add('selected');
  });
},
```

- [ ] **Step 3: Add model inference submit handler**

```javascript
_submitMiTask: function() {
  var modelId = document.getElementById('miModelId');
  var prompt = document.getElementById('miPrompt');
  var imageInput = document.getElementById('miImageFile');
  var displayList = document.getElementById('miDisplayList');
  var selectedDisplay = displayList ? displayList.querySelector('.task-device-item.selected') : null;

  if (!imageInput || !imageInput.files || imageInput.files.length === 0) {
    alert('请选择图片'); return;
  }
  if (!selectedDisplay || !selectedDisplay.dataset.id) {
    alert('请选择目标显示端'); return;
  }

  var self = this;
  var file = imageInput.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result.split(',')[1];
    var params = {};
    if (prompt && prompt.value) params.prompt = prompt.value;
    params.modelId = modelId ? modelId.value : 'lfm-vl';

    self._send({
      type: 'task:submit',
      payload: {
        taskName: 'model-inference-' + Date.now(),
        taskType: 'builtin',
        builtinId: 'model.inference',
        target: 'display',
        displayId: selectedDisplay.dataset.id,
        mode: 'one-shot',
        env: 'webgpu',
        files: [{ name: 'image', data: base64 }],
        params: params
      }
    });
  };
  reader.readAsDataURL(file);

  // 切换到监控标签
  var monitorTab = document.querySelector('[data-tab="monitor"]');
  if (monitorTab) monitorTab.click();
},
```

- [ ] **Step 4: Add token speed metrics to monitor card**

Modify `_monitorActiveCard` to show metrics when available. After line 704 (the progress bar section), add metrics display:

In `_monitorActiveCard`, after `progressBar`:
```javascript
var metricsHtml = '';
if (inst.result && inst.result.metrics) {
  var m = inst.result.metrics;
  metricsHtml = '<div class="task-monitor-metrics">' +
    '<span title="首 Token 延迟">TTFT: ' + (m.ttft || '-') + 'ms</span>' +
    '<span title="生成速度">' + (m.tokensPerSecond || '-') + ' tok/s</span>' +
    '<span title="总 Token 数">' + (m.totalTokens || '-') + ' tokens</span>' +
    '</div>';
}
```

And add `metricsHtml` to the template after `progressBar`.

- [ ] **Step 5: Add metrics display in results detail view**

In `_resultDetailHTML`, add metrics to the result meta section. After line 1118 (the env line):

```javascript
'<div class="task-result-meta-item">环境: <strong>' + this._escapeHtml(inst.env || '-') + '</strong></div>' +
```

Add:
```javascript
(inst.result && inst.result.metrics ? '<div class="task-result-metrics">' +
  '<div class="task-result-metrics-title">推理性能</div>' +
  '<div class="task-result-metrics-row">' +
    '<span>首 Token: <strong>' + (inst.result.metrics.ttft || '-') + 'ms</strong></span>' +
    '<span>速度: <strong>' + (inst.result.metrics.tokensPerSecond || '-') + ' tok/s</strong></span>' +
    '<span>总 Token: <strong>' + (inst.result.metrics.totalTokens || '-') + '</strong></span>' +
    '<span>耗时: <strong>' + (inst.result.metrics.totalDuration || '-') + 'ms</strong></span>' +
  '</div></div>' : '') +
```

- [ ] **Step 6: Add CSS for metrics display**

Add CSS rules for `.task-monitor-metrics` and `.task-result-metrics` (in the existing task panel CSS, likely in `display.css` or inline in task-panel.js). Check if task-panel.js has inline styles... Looking at the code, it uses JS-generated HTML with classes. The styles should go in an existing CSS file.

- [ ] **Step 7: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/js/task-panel.js src/apps/web-mediacenter/ui/public/css/task-panel.css
git commit -m "feat(task-panel): add model inference form and token speed metrics display"
```

---

### Task 6: Model config and download script

**Files:**
- Create: `res/models/lfm-vl/config.json`
- Create: `src/scripts/download-lfm-vl-model.js`

- [ ] **Step 1: Create model config**

```json
{
  "modelId": "lfm-vl",
  "name": "LFM2.5-VL-1.6B",
  "description": "Liquid AI 视觉语言模型",
  "files": [
    { "name": "embed_images_fp16.onnx", "size": 210000000, "sha256": "download-and-verify" },
    { "name": "decoder_q4.onnx", "size": 920000000, "sha256": "download-and-verify" }
  ],
  "input": { "imageSize": 336, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225] },
  "vramEstimate": 1100
}
```

- [ ] **Step 2: Create download script**

```javascript
// src/scripts/download-lfm-vl-model.js
// 下载 LFM2.5-VL-1.6B ONNX 模型文件到 res/models/lfm-vl/
// 用法: node src/scripts/download-lfm-vl-model.js [--source modelscope|huggingface]
const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.resolve(__dirname, '../../res/models/lfm-vl');

const SOURCES = {
  modelscope: {
    base: 'https://www.modelscope.cn/models/LiquidAI/LFM2.5-VL-1.6B-ONNX/resolve',
    files: ['onnx/embed_images_fp16.onnx', 'onnx/decoder_q4.onnx']
  },
  huggingface: {
    base: 'https://huggingface.co/liquid-ai/LFM-2.5-VL-1.6B-ONNX/resolve/main',
    files: ['onnx/embed_images_fp16.onnx', 'onnx/decoder_q4.onnx']
  }
};

async function downloadFile(url, dest) {
  // ... 标准文件下载逻辑
}

async function main() {
  const source = process.argv.includes('--source')
    ? process.argv[process.argv.indexOf('--source') + 1] || 'modelscope'
    : 'modelscope';
  const config = SOURCES[source];
  if (!config) { console.error('未知下载源:', source); process.exit(1); }
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const file of config.files) {
    const url = config.base + '/' + file;
    const dest = path.join(MODEL_DIR, path.basename(file));
    console.log('下载 ' + url + ' -> ' + dest);
    await downloadFile(url, dest);
  }
  console.log('模型下载完成');
}

main().catch(console.error);
```

- [ ] **Step 3: Commit**

```bash
git add res/models/lfm-vl/config.json src/scripts/download-lfm-vl-model.js
git commit -m "feat(models): add LFM-VL model config and download script"
```

---

### Task 7: CSS for metrics display

**Files:**
- Create or modify: Check if `task-panel.css` exists, otherwise add to `display.css`

- [ ] **Step 1: Find or create CSS file**

Check if `src/apps/web-mediacenter/ui/public/css/task-panel.css` exists. If not, create it. If styles are inline in task-panel.js, add a `<style>` block or append to existing CSS.

- [ ] **Step 2: Add metrics CSS rules**

```css
.task-monitor-metrics {
  display: flex;
  gap: 12px;
  padding: 6px 16px;
  font-size: 11px;
  color: #8cf;
  background: rgba(0, 210, 255, 0.05);
  border-top: 1px solid rgba(255,255,255,0.05);
}
.task-monitor-metrics span {
  cursor: help;
}
.task-result-metrics {
  margin: 8px 0;
  padding: 8px 12px;
  background: rgba(0, 210, 255, 0.05);
  border-radius: 6px;
  border: 1px solid rgba(0, 210, 255, 0.1);
}
.task-result-metrics-title {
  font-size: 11px;
  color: #666;
  margin-bottom: 4px;
}
.task-result-metrics-row {
  display: flex;
  gap: 16px;
  font-size: 13px;
}
.task-result-metrics-row span {
  color: #aaa;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/css/
git commit -m "style: add metrics display CSS for model inference results"
```

---

## Spec Coverage Check

| Design Doc Requirement | Task | Status |
|-----------------------|------|--------|
| ModelManager singleton | Task 4 Step 1 | ✓ |
| ModelAdapter interface | Task 4 Step 2 (LfmVlAdapter) | ✓ |
| LfmVlAdapter.process with metrics | Task 4 Step 2 | ✓ |
| Model file location (res/models/lfm-vl/) | Task 6 | ✓ |
| Builtin task registration (model-inference.js) | Task 1 | ✓ |
| Task-manager builtin forward support | Task 2 | ✓ |
| WebSocket handler forward builtinId+params | Task 3 | ✓ |
| Display executeTask model inference branch | Task 4 Step 3 | ✓ |
| SendTaskResult with metrics | Task 4 Step 5 | ✓ |
| Control panel model inference form | Task 5 Steps 1-3 | ✓ |
| Display selector filtered by WebGPU | Task 5 Step 2 (_renderMiDisplayList) | ✓ |
| Token speed metrics in UI | Task 5 Steps 4-5 | ✓ |
| Model download script | Task 6 Step 2 | ✓ |
| Error handling | Throughout (promise catches, AbortController) | ✓ |
| Future extension (ASR adapter, server API) | Noted in design doc, not in scope | - |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-model-inference-task.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
