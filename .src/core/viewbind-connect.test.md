#skill: ai-code-translation

# ViewBind connect 自测

## 模块
core

## 目标文件清单
- `src/core/viewbind/ViewBind.test.js` // 追加 connect 字段测试
- `src/core/viewbind/ViewBind.self-test.js` // 追加 transport 通信自测

## 测试场景

### connect setter/getter

- 创建 ViewBind 实例，connect 默认为 undefined
- 设置 connect = transport 后，getter 返回 transport
- 断开后 connect 返回 undefined

### data setter 自动同步

- 创建 ViewBind，设置 connect 为 mockTransport
- viewbind.data = newData
- 验证 mockTransport.send 被调用，参数为 newData

### onReceive 收到数据更新本地

- 注册 mockTransport.onReceive 的回调
- 模拟远端推送数据，调用回调函数
- 验证 ViewBind.data 更新为推送的数据

### disconnect 清理

- 设置 connect，然后 disconnect
- 验证 transport.close 被调用
- 验证 data 变化不再触发 transport.send

### pauseSync / resumeSync

- pauseSync 后发送 data
- 验证 transport.send 不被调用
- resumeSync 后立即调用 transport.send
- 验证 transport.send 被调用一次

### 多点同步

- 多个 ViewBind 连接同一个 mockTransport
- 一个 ViewBind 变化不影响其他 ViewBind
