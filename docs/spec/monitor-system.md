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
| `res/tasks/render-display/render.html` | 覆盖层 HTML 结构（横条容器，纯 DOM/CSS 无 canvas） |
| `res/tasks/render-display/render.js` | 主线程渲染逻辑，返回 update(data) 函数 |

#### 横条渲染（单行内联 + 两行 GPU/VRAM）

每个来源按数据分行，纯 DOM/CSS（无 canvas）。设备名占 CPU 条标签位（替代 "CPU" 文字），MEM/GPU/VRAM 标签保留：

第一行（所有来源）：

```
Pixel 6   ▓▓▓▓▓▓[62%]                M ▓▓▓░░[38% 3.1/8.0G]
PC-1      ▓▓▓▓▓▓[62% 45°C]           M ▓▓▓░░[38% 6.4/32.0G]
```

第二行（仅来源有 GPU 数据时，前部等宽占位对齐 MEM 条标签起点）：

```
PC-1      ▓▓▓▓▓▓[62% 45°C]           M ▓▓▓░░[38% 6.4/32.0G]
          GPU ▓▓░░[12% 52°C 180W]    VRAM ▓░░[23% 6.0/24.0G]
```

- 利用率/温度/显存/功耗文字叠加在**进度条内部水平垂直居中**（`left:50%` + `translate(-50%,-50%)`），字号 40px（标签 45px），可略高出条身（条高 30~36px），白色 + `text-shadow` 深色描边，不受进度条裁切
- 设备名、`M`、`GPU`、`VRAM` 等进度条外标签使用固定白色文字和固定黑色阴影，并在文字正下方使用 2px、无模糊的当前主题 `accent-color` 投影；投影优先使用约 65% 透明度的 `color-mix(in srgb, accent-color 65%, transparent)`，同时保留纯色回退，不使用文字轮廓或元素盒子内阴影
- 所有进度条外标签使用固定宽度并左对齐；设备名不添加前导空格，`arch0`、`SM-N...` 等不同长度名称从同一左边缘开始显示
- 进度条总长度轨道为灰底 `background:rgba(255,255,255,0.18)`，填充段由 fillWrap（`overflow:hidden` + 圆角）裁出与现状一致的圆角填充；文字与 fillWrap 平级
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
| `task-manager.js` | 维护 taskLinks Map，提供 linkTasks/unlinkTasks/getTaskLinks；链接新增幂等，查询时过滤失效实例并去重 |
| `web-socket-handler.js` | 新增 task:link/task:unlink handler；task:list 返回 links；task:progress 触发 taskManager 事件（广播+路由） |

#### 任务链接查询与管理伪代码

```text
TaskManager.linkTasks(sourceId, targetTask, targetId):
  targets = taskLinks.get(sourceId) 或 []
  如果 targets 中已经存在相同 targetTask + targetId:
    保持原数组，不重复添加
  否则追加目标并持久化 taskLinks

TaskManager.getTaskLinks():
  taskIndex = 读取所有任务及实例，建立 instanceId -> { taskName, entry } 索引
  result = []
  对 taskLinks 中每个 sourceId -> targets:
    如果 sourceId 不在 taskIndex：跳过
    对 targets 中每个 target:
      如果 target.instanceId 不在 taskIndex：跳过
      key = sourceId + target.taskName + target.instanceId
      如果 key 已处理：跳过
      追加 {
        sourceTaskName, sourceInstanceId,
        targetTaskName, targetInstanceId,
        targetDisplayId, targetStatus
      }
  返回 result

服务实例互斥范围:
  如果 target 是 server：同一任务名 + target 仍保持单实例互斥
  如果 target 是 display/subdisplay：仅同一任务名 + target + displayId 互斥
  不同 displayId 的 render-display 实例并行运行，不能停止彼此的显示端覆盖层
  多个 sourceInstanceId 可以共同指向同一个 targetInstanceId，解除其中一个来源不影响其他来源路由
  解除来源时向 render-display 发送 task:renderUpdate({_stop:true, _sourceInstanceId:sourceId})，只隐藏该来源子条目

task:list:
  tasks = listTasks() 并合并任务元数据
  links = getTaskLinks()
  向控制端返回 { tasks, links, sidebarGroups, sidebarTabs }

控制端现有“链接到...”弹窗:
  当前来源 = sourceTaskName + sourceInstanceId
  已链接列表 = links 中 sourceInstanceId 匹配的有效目标
  可链接列表 = running 实例 - 当前来源 - 已链接目标，并按目标实例去重
  已链接目标显示目标任务、实例短 ID、displayId/设备名称和状态
  每个已链接目标节点写入 data-instanceid=targetInstanceId
  点击“解除”读取该节点的 targetInstanceId，发送 task:unlink(sourceInstance, targetInstance)
  解除成功后从当前弹窗的已链接列表移除该目标节点
  如果目标仍为 running，将该节点移动到当前弹窗的添加列表，保持弹窗打开并可直接再次链接
  如果目标已停止，只从已链接列表移除，不加入添加列表
  点击“选择”发送 task:link(sourceInstance, targetTask, targetInstance)，保持当前弹窗打开
  选择成功后将目标节点从添加列表移动到已链接列表，并将按钮切换为“解除”，便于继续管理多个目标
  收到 task:linked/task:unlinked 后刷新 task:list
```

### 显示端增强

| 文件 | 说明 |
|------|------|
| `display.html` | 新增 executeRenderTask() + task:renderUpdate/hardwareStats 处理 + task:stop 清理覆盖层 |
| `display.css` | 新增 .render-task-overlay 样式 |

### 显示端旋转适配

render-display 覆盖层（`#monitorOverlay`）跟随显示端旋转：

- 旋转 90°/270° 时使用 CSS transform 旋转，旋转中心为 center center
- `update()` 完成来源条目重建后再调用 `applyRotationStyle()`，避免用旧覆盖层尺寸计算位置。
- `applyRotationStyle()` 根据旋转后的实际包围盒限制上下视口边距，并避让 `fileNameDisplay`：90°放在媒体名右侧、180°放在媒体名下侧、270°放在媒体名左侧，保持 0°时覆盖层位于媒体名上侧的相对关系。
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
3. 不发送 `commandAck`；该消息是高频实时数据，不是需要控制端提示的命令执行结果

兼容方式：`type: 'hardwareStats'` 广播给所有活跃渲染任务。

兼容消息同样只执行数据分发，不发送 `commandAck`。控制端的命令确认提示仅由播放、控制、TTS、提醒等显式控制消息触发。

伪代码：

```
收到 task:renderUpdate:
    找到对应 instanceId 的更新函数
    如果存在:
        调用更新函数(data)
    结束处理，不回传 commandAck

收到 hardwareStats:
    遍历所有活跃渲染任务并分发 data
    结束处理，不回传 commandAck
```

### 停止渲染任务

控制端点击停止 → `stopInstance()` → 发送 `{type: 'task:stop', instanceId}` 到显示端。
display.html 清理：
1. 移除 `#renderTask-{instanceId}` DOM 覆盖层
2. 移除 `#renderTaskStyle-{instanceId}` 样式
3. 删除 `window._renderTaskUpdates[instanceId]`
