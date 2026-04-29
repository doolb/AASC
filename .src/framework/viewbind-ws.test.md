#skill: ai-code-translation

# WS 传输连接器自测

## 模块
framework

## 目标文件清单
- `src/core/viewbind/WSClientConnector.test.js` // WS 客户端连接器测试
- `src/core/viewbind/WSViewBindServer.test.js` // WS 服务端管理测试

## 测试场景

### WSClientConnector

- 连接 WS 服务后能够收发 JSON 消息
- send 发送的数据远端能收到
- onReceive 注册的回调能收到远端推送
- close 后清理所有回调
- 重复连接/断开不报错

### WSViewBindServer 显示端管理

- 添加显示端后 ViewBindList count 增加
- 显示端状态更新通过 ViewBind.data 自动同步
- 移除显示端后 ViewBindList count 减少

### WSViewBindServer 控制端广播

- 绑定 ViewBindList 回调，列表变化时收到广播
- 控制端列表和 ViewBindList 数据一致
- 多个控制端都收到广播

### WSViewBindServer handler 注册

- 注册 handler 后，匹配 type 的消息能调用 handler
- 不匹配 type 的消息不走 handler，不崩溃
- handler 执行出错不影响其他 handler
