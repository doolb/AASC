#skill: ai-code-translation

# WSViewBindServer - 替换 WebSocketSystem

## 模块
framework

## 目标文件清单

- `src/framework/aasc/system/websocket-system.js` // 被替换目标，576 行
- `src/framework/aasc/init.js` // 被替换的初始化入口
- `src/framework/aasc/actor-adapter.js` // 被替换的 AgentActorAdapter + ActorFactory

## 范围约束

- 只替代 WebSocketSystem 对外 API 和内部 Actor 路由，不替代业务服务
- 对外暴露与 WebSocketSystem 相似的 API 接口，降低 server-app.js 改造成本
- 内部使用 ViewBind + ViewBindList 替代 MessageBus + Actor

## 已有声明

- `class WebSocketSystem` 位于 `src/framework/aasc/system/websocket-system.js`
  - `handleDisplayConnect(displayId, clientIP, ws, savedState)`  // 显示端连接
  - `handleDisplayMessage(displayId, rawMessage, ws)`  // 显示端消息处理
  - `handleDisplayDisconnect(displayId)`  // 显示端断连
  - `handleControlConnect(ws)`  // 控制端连接
  - `handleControlMessage(rawMessage, ws)`  // 控制端消息处理
  - `handleControlDisconnect(ws)`  // 控制端断连
  - `registerActor(name, actor)`  // 注册 Actor
  - `use(middleware)`  // 注册中间件
  - `initialize()`  // 初始化系统
  - `shutdown()`  // 关闭系统
  - `sendToDisplay(displayId, data)`  // 发送到显示端
  - `broadcastToControls(data)`  // 广播到控制端
  - `getDisplayList()`  // 获取显示端列表
  - `getStats()`  // 获取统计信息
- `class ViewBind` 位于 `src/core/viewbind/ViewBind.js`
- `class ViewBindList` 位于 `src/core/viewbind/ViewBindList.js`

## 新增定义

WSViewBindServer  // 基于 ViewBind 的 WS 服务器端管理类，替代 WebSocketSystem
- displayClients // ViewBindList，管理所有显示端
- controlClients // Set，管理控制端连接
- handlers // Map<string, Function>，消息类型到处理函数的映射
- lifecycleCallbacks // { onDisplayConnect, onDisplayDisconnect, onControlConnect, onControlDisconnect }

## 操作流程

### 初始化

- 创建 displayClients ViewBindList 实例
- 绑定 ViewBindList 回调：列表变化时调用 broadcastDisplayList // push/remove 自动广播
- 初始化 controlClients 为空 Set
- 初始化 handlers 为空 Map

### handleDisplayConnect

- 从 ws 连接获取 displayId、clientIP
- 读取持久化 savedState
- 创建 ViewBind 实例，data = { ws, ip, isSubDisplay, lastSeen, state: { ...createDisplayState(), ...savedState } }
- 将 ViewBind 实例 push 到 displayClients // ViewBindList 自动触发广播
- 调用 lifecycleCallbacks.onDisplayConnect  // 外部钩子
- 返回该 ViewBind 实例

### handleDisplayMessage

- 从 displayClients 中找到对应显示端的 ViewBind
- 解析消息 type
- heartbeat 类型直接返回 // 不触发 data 变更
- 其他消息：在 handlers 中查找 type 匹配的处理函数
  - 若匹配，调用 handler(type, data, viewbind, context)
  - 若不匹配，走默认处理（更新 viewbind.data = receivedData）
- 更新 viewbind.data.lastSeen 为当前时间

### handleDisplayDisconnect

- 从 displayClients 移除 ViewBind // 自动触发广播
- viewbind.disconnect() // 关闭 WS 连接
- 调用 lifecycleCallbacks.onDisplayDisconnect

### handleControlConnect

- 将 ws 加入 controlClients
- displayClients ViewBindList 回调自动广播 displayList // 新控制端收到列表
- 调用 lifecycleCallbacks.onControlConnect

### handleControlMessage

- 解析消息 type
- 在 handlers 中查找匹配的处理函数
- updateCapabilities 类型：找到目标显示端 ViewBind，修改 data.state.capabilities，持久化配置
- 其他类型：调用 handler(type, data, context)

### handleControlDisconnect

- 从 controlClients 移除 ws
- 调用 lifecycleCallbacks.onControlDisconnect

### registerHandler

- handlers.set(type, handlerFn) // 注册消息处理函数

### broadcastDisplayList

- 遍历 displayClients.list，组装 sanitized 列表 // 同 getDisplayList() 格式
- 遍历 controlClients，广播 { type: 'displayList', list }

### sendToDisplay

- 从 displayClients.list 中根据条件查找目标显示端的 ViewBind
- viewbind.data = data  // 通过 connect.send 自动推送到显示端

### shutdown

- 遍历 displayClients，逐个断开
- 清空 controlClients
- 清空 handlers
