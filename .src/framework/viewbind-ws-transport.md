#skill: ai-code-translation

# WS 传输连接器实现

## 模块
framework

## 目标文件清单

- `src/core/viewbind/ViewBind.js` // 依赖 ViewBind.connect 扩展
- `src/core/viewbind/ViewBindList.js` // 服务端用 ViewBindList 管理显示端

## 范围约束

- WSClientConnector 是实现 TransportConnector 接口的 WS 传输层
- 服务端管理不另起类，直接在 WSServerManager 中编排 ViewBind 和 ViewBindList
- 不引入新的传输依赖，只使用 ws 库

## 已有声明

- `ViewBind.connect` // 来自 core/viewbind-connect 扩展
- `TransportConnector` 接口 { send, close, onReceive } // 来自 core/viewbind-connect-models
- `ViewBindList` 来自 `src/core/viewbind/ViewBindList.js`
- `WebSocket` 来自 `ws` 库
- `WebSocketServer` 来自 `ws` 库

## 新增定义

WSClientConnector  // 客户端用：连接远端 WS 服务，实现 TransportConnector 接口
WSServerManager  // 服务端用：管理多个显示端的 ViewBind + TransportConnector

## 操作流程

### WSClientConnector

- constructor 接受 url 和 options（如 reconnect 策略）
- connect 方法：
  - 创建 WebSocket 连接到 url
  - ws.on('message') 中解析 JSON，调用 onReceive 注册的回调 // 收到数据推给 ViewBind
  - ws.on('close') 触发重连 // 根据 options 决定是否重连
  - ws.on('error') 触发重连
- send 方法：
  - 将 data 序列化为 JSON
  - ws.send 发送
- close 方法：
  - ws.close
  - 清理 onReceive 回调
- onReceive 方法：
  - 保存 callback
  - 返回取消函数

### WSServerManager - 服务端显示端管理

- displayClients: ViewBindList // 替代现有的 displayClients Map
  - 每个元素 = ViewBind 实例，data = { ws, ip, isSubDisplay, lastSeen, state: DisplayState }
  - ViewBindList.bind 回调：列表变化时自动 broadcastDisplayList // 替代手动调用
- 处理显示端连接：
  - 创建 ViewBind 实例，data 包含 { ws, ip, isSubDisplay, lastSeen, state }
  - 创建 WSClientConnector 包装 ws 连接
  - viewbind.connect = wsClientConnector // 数据变化自动推送到此显示端
  - 将 ViewBind 实例 push 到 displayClients // 自动触发广播
  - 外部向此显示端发数据 = 找到对应 viewbind，viewbind.data = newData // 自动通过 transport.send 推送
- 处理显示端断连：
  - 从 displayClients 移除对应的 ViewBind // 自动触发广播
  - viewbind.disconnect() // 关闭 WS 连接
- 获取显示端数据：
  - 通过 displayClients.list 遍历
  - 每个 ViewBind.data 包含该显示端的完整数据

### 消息流转

- 显示端上报 → ws.onMessage → 找到对应 ViewBind → viewbind.data = receivedData // 触发本地绑定
- 控制端命令 → 找到目标显示端的 ViewBind → viewbind.data = command // 通过 connect.send 推到显示端
- 本地状态变化 → viewbind.data = newState → 自动同步到 show 端 // 双向同步
