#skill: ai-code-translation

# TransportConnector 接口定义

## 模块
core

## 目标文件清单

- `src/core/viewbind/ViewBind.js` // 依赖 TransportConnector 接口

## 范围约束

- TransportConnector 是概念接口（duck typing），不生成独立类文件
- 外部传输实现（WS、IPC 等）按此接口实现即可接入 ViewBind.connect

## 已有声明

- `ViewBind.connect` setter 接受 transport 参数 // 来自 viewbind-connect

## 新增定义

TransportConnector  // 可插拔连接实现的概念接口
- send(data)  // 将 data 发送到远端，具体序列化由实现决定
- close()  // 关闭连接，清理资源
- onReceive(callback)  // ViewBind 内部调用，注册收到数据后的回调；返回取消函数

## 操作流程

### TransportConnector 实现方约定

- send 接受任意可 JSON 序列化的 data
- onReceive 注册的回调在收到远端数据时被调用，传入解析后的 data
- onReceive 返回一个取消函数，调用后不再接收通知
- close 释放所有资源，断开连接

### ViewBind 使用 TransportConnector 的流程

- connect setter 调用 transport.onReceive 注册回调 // 收到远端数据 → this.data = data
- connect setter 缓存 transport.send // data setter 变化时自动调用
- connect setter 在已有连接时先调用旧 transport.close
- disconnect 释放所有引用
