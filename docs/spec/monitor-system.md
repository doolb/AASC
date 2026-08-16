# 硬件监控系统 — 实现文档

## 模块

### win-monitor (采集任务)

| 文件 | 说明 |
|------|------|
| `res/tasks/win-monitor/task.js` | 采集任务，target=subdisplay 或 target=server，mode=service |

#### 采集数据

```
{
  cpuPercent,          // CPU 使用率（%）
  cpuTemp,             // CPU 温度（°C）
  memPercent, memTotal, memUsed,  // 内存
  hostname, timestamp,
  gpuName, gpuPercent, gpuTemp,   // GPU 利用率/温度
  gpuMemUsed, gpuMemTotal,        // GPU 显存
  gpuClock, gpuFan,               // GPU 频率/风扇
  gpuPower                          // GPU 功耗（nvidia-smi power.draw）
}
```

#### CPU 温度采集

| 平台 | 方式 |
|------|------|
| Windows | `systeminformation` 库的 `si.cpuTemperature()` |
| Linux | `sensors -j` JSON 解析，取 Package id 0 或 Core 0 |

#### GPU 数据采集

nvidia-smi 查询字段：
- utilization.gpu, temperature.gpu
- memory.used, memory.total
- clocks.current.graphics, fan.speed
- **power.draw**（GPU 功耗）

### render-display (渲染任务)

| 文件 | 说明 |
|------|------|
| `res/tasks/render-display/task.js` | 元数据注册，target=display |
| `res/tasks/render-display/render.html` | 覆盖层 HTML 结构（单行横条容器，纯 DOM/CSS 无 canvas） |
| `res/tasks/render-display/render.js` | 主线程渲染逻辑，返回 update(data) 函数 |

#### 横条渲染（单行内联 + 两行 GPU/VRAM）

每个来源按数据分行，纯 DOM/CSS（无 canvas）。设备名占 CPU 条标签位（替代 "CPU" 文字），MEM/GPU/VRAM 标签保留：

第一行（所有来源）：

```
Pixel 6   ▓▓▓▓▓▓[62%]                MEM ▓▓▓░░[38% 3.1/8G]
PC-1      ▓▓▓▓▓▓[62% 45°C]           MEM ▓▓▓░░[38% 6.4/32G]
```

第二行（仅来源有 GPU 数据时，前部等宽占位对齐 MEM 条标签起点）：

```
PC-1      ▓▓▓▓▓▓[62% 45°C]           MEM ▓▓▓░░[38% 6.4/32G]
          GPU ▓▓░░[12% 52°C 180W]    VRAM ▓░░[23% 6/24G]
```

- 利用率/温度/显存/功耗文字叠加在**进度条内部水平垂直居中**（`left:50%` + `translate(-50%,-50%)`），字号 34px（标签 45px），白色 + `text-shadow` 深色描边，不受进度条裁切
- 填充段由 fillWrap（`overflow:hidden` + 圆角）裁出与现状一致的圆角填充；文字与 fillWrap 平级
- 布局参数由 `getLayout()` 动态计算：旋转 90°/270° 或来源数 ≥3 时紧凑模式（条宽 280px/条高 30px/间距收紧），否则常规模式（条宽 360px/条高 36px）；`update()` 每帧按当前 `rotation` 与来源数刷新行级样式
- 覆盖层整体半透明黑底 `background:rgba(0,0,0,0.25)`，底下内容隐约可见且文字清晰
- 内存/显存文字格式：`memUsed/memTotal G`；CPU 温度、GPU 温度/功耗仅在字段有效时并入条内文字

#### APK 本地来源轮询

```
render.js 检测 window.NativeDisplay 存在
  → setInterval(800ms) 轮询 NativeDisplay.getSystemStats()
    → JSON.parse → update(stats)（_sourceInstanceId = 'local-' + instanceId）
  → 每次触发先检查 _renderTaskUpdates[instanceId] 是否存在
    → 不存在 clearInterval 退出（覆盖层移除时防泄漏）
```

### 任务系统增强

| 文件 | 说明 |
|------|------|
| `task-manager.js` | 新增 taskLinks Map + linkTasks/unlinkTasks 方法 |
| `web-socket-handler.js` | 新增 task:link/task:unlink handler；task:progress 触发 taskManager 事件（广播+路由） |

### 显示端增强

| 文件 | 说明 |
|------|------|
| `display.html` | 新增 executeRenderTask() + task:renderUpdate/hardwareStats 处理 + task:stop 清理覆盖层 |
| `display.css` | 新增 .render-task-overlay 样式 |

### 显示端旋转适配

render-display 覆盖层（`#monitorOverlay`）跟随显示端旋转：

- 旋转 90°/270° 时使用 CSS transform 旋转，旋转中心为 center center
- `applyRotationStyle()` 动态计算 `left/top`（90°）或 `right/bottom`（270°），保证旋转后视觉边缘距屏幕边缘 24px，适配多设备（3 台）时的高覆盖层
- 每次 `update()` 都调用 `applyRotationStyle()`（不仅 rotation 变化时），确保设备增减后定位重新计算
- render.html 使用 `position:fixed;display:flex;flex-direction:column`，覆盖层自然跟随旋转

### 子显示端增强

| 文件 | 说明 |
|------|------|
| `voice-display-node/main.js` | context 新增 sendProgress 函数；handleTaskExecute 支持服务模式（返回 {stop}）；静默忽略 task:renderUpdate |

#### 服务任务结果处理

服务模式（mode=service）任务在显示端启动成功后：
1. 显示端检测到 `run()` 返回 `{ stop: fn }` → 注册到 `_serviceTasks`，发送 `task:result` 含 `data.serviceStarted=true`
2. 服务端 `handleForwardResult` 识别为 displayService + success → 状态保持 `running`，不发 `result` 事件（避免被误解为任务完成）
3. 控制端前端 `_onResult` 检测到 `data.serviceStarted` → 保持 `running` 状态而非改为 `completed`

非服务任务（one-shot）在显示端执行完成后：
1. 显示端发回 `task:result` 不含 `data.serviceStarted`
2. 服务端 `_handleResult` 将状态设为 `completed`/`failed`，发出 `result` 事件
3. 前端按 `success` 标志设为 `completed`/`failed`

## 数据流

```
subdisplay: task.js 采集
  └─ sendProgress({ cpuPercent, gpuPercent, memPercent, ... })
       │
       └─ task:progress → wsServer.registerHandler
            │
            └─ taskManager.emit('progress', instanceId, stage, data)
                 │
                 ├─ sendToControl (控制端面板)
                 │
                 └─ taskLinks 检测 → sendToDisplay(displayId, { type: 'task:renderUpdate', instanceId, data })
                      │
                      └─ display.html onmessage
                           │
                           └─ window._renderTaskUpdates[instanceId](data)
                                │
                                └─ Canvas 环形图 / 折线图 / 内存条
```

## 通用渲染任务协议

### 任务文件约定

files 中包含 `render.html` → display.html 自动识别为渲染任务

| 文件名 | 必须 | 说明 |
|--------|------|------|
| `render.html` | 是 | HTML 结构，注入到覆盖层 |
| `render.css` | 否 | 样式（可选） |
| `render.js` | 否 | 返回 `update(data)` 函数的 JS 代码 |

### render.js 接口

```js
// render.js 内容必须在 IIFE 中包裹，return update(data) 函数
(function() {
return function(api) {
    // api.params — 任务参数
    // api.container — 覆盖层 DOM 元素
    // api.instanceId — 任务实例 ID

    return function update(data) {
        // 收到实时数据时调用
        // data: { cpuPercent, gpuPercent, memPercent, ... }
    };
};
})();
```

### 数据推送

服务端通过 `sendToDisplay(displayId, { type: 'task:renderUpdate', instanceId, data })` 推送。

display.html 收到后：
1. 查找 `window._renderTaskUpdates[instanceId]`
2. 如果存在，调用 `fn(data)`

兼容方式：`type: 'hardwareStats'` 广播给所有活跃渲染任务。

### 停止渲染任务

控制端点击停止 → `stopInstance()` → 发送 `{type: 'task:stop', instanceId}` 到显示端。
display.html 清理：
1. 移除 `#renderTask-{instanceId}` DOM 覆盖层
2. 移除 `#renderTaskStyle-{instanceId}` 样式
3. 删除 `window._renderTaskUpdates[instanceId]`
