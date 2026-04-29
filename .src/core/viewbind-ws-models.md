#skill: ai-code-translation

# WS 通信层 - 核心模型

## 模块
core

## 目标文件清单

- `src/core/viewbind/ViewBind.js` // 使用 ViewBind 存储显示端数据
- `src/core/viewbind/ViewBindList.js` // 使用 ViewBindList 管理显示端列表
- `src/apps/server/boot/server-app.js` // 现有 createDisplayState() / getDisplayList()

## 范围约束

- 模型定义和 `createDisplayState()` 结构一致 // 保持向后兼容，现有控制端不修改
- 不新增字段类型定义，只映射真实代码中已有的结构

## 已有声明

- `class ViewBind` 位于 `src/core/viewbind/ViewBind.js`
- `class ViewBindList` 位于 `src/core/viewbind/ViewBindList.js`
- `function createDisplayState()` 位于 `src/apps/server/boot/server-app.js:336`
  - 返回 { currentMedia, rotation, fit, crop, volume, isPlaying, canvasSize, browserInfo, capabilities }
- `function getDisplayList()` 位于 `src/apps/server/boot/server-app.js:1652`
  - 从 displayClients Map 中遍历组装 { id, ip, isSubDisplay, canvasSize, rotation, browserInfo, voiceSupported, voiceListening, capabilities }
- `displayClients` Map 位于 `src/apps/server/boot/server-app.js:144` // 现有显示端管理
- `controlClients` Set 位于 `src/apps/server/boot/server-app.js:145` // 现有控制端管理

## 新增定义

无  // 项目已有 DisplayState 结构，已有 displayClients/controlClients 管理方式
    // ViewBind 替换时不新增独立模型类，直接用 ViewBind 实例替代 Map 条目

## 操作流程

### ViewBind 替换 displayClients Map 条目的映射

- 现有 displayClients Map 每条存储：{ ws, ip, isSubDisplay, lastSeen, state: DisplayState }
- 替换后每个显示端使用一个 ViewBind 实例，data 包含 { ws, ip, isSubDisplay, lastSeen, state: DisplayState }
- ViewBindList 管理所有显示端的 ViewBind 实例 // 替代 Map.forEach 遍历

### 现有 getDisplayList() 行为的保持

- 遍历 ViewBindList.list，从每个 ViewBind.data 中提取字段
- 组装 getDisplayList 所需格式：{ id, ip, isSubDisplay, canvasSize, rotation, browserInfo, voiceSupported, voiceListening, capabilities }
- 不暴露 ws 字段 // 安全性要求，和现有 sanitize 行为一致

### controlClients Set 的保持

- controlClients 继续使用 Set<WebSocket> // 广播方式不变
- displayClients ViewBindList 绑定回调：列表变化时遍历 controlClients 广播 displayList
