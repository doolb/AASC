#skill: ai-code-translation

# ViewBind connect 扩展 - 双向数据同步

## 模块
core

## 目标文件清单

- `src/core/viewbind/ViewBind.js` // 扩展 connect 字段

## 范围约束

- 不改 ViewBind 现有 bind/unbind/notify 逻辑
- 只新增 connect 字段（getter/setter）和 disconnect/pauseSync/resumeSync
- connect 的传输实现由外部注入，ViewBind 本身不依赖任何传输库

## 已有声明

- `class ViewBind` 位于 `src/core/viewbind/ViewBind.js`
- `ViewBind._data`  // 当前数据
- `ViewBind._bindings`  // Map<string, Set<Function>> 绑定表
- `ViewBind._notifyAll()`  // 通知所有绑定回调
- `ViewBind.data` setter // 设置 _data 并调用 _notifyAll
- `ViewBind._safeCall(callback)`  // try-catch 包装回调调用

## 新增定义

`ViewBind._transport`  // connect 设置的传输实例，实现 { send, close, onReceive } 接口
`ViewBind._transportSend`  // 缓存 transport.send 引用，避免每次发送时属性查找
`ViewBind._transportUnsubscribe`  // 取消 transport.onReceive 注册的取消函数
`ViewBind._syncEnabled`  // 是否启用数据同步，默认 true，pauseSync 时设为 false

## 操作流程

### connect setter

- connect 接受 transport 参数 // transport 需实现 send(data)、close()、onReceive(callback)
- 若已有 _transport，调用 disconnect 断开旧连接 // 避免重复连接泄漏
- 保存 transport 到 _transport
- 缓存 transport.send 到 _transportSend // 减少属性查找开销
- 调用 transport.onReceive 注册收到数据后的回调
  - 回调逻辑：收到 data，执行 this.data = data // 触发本地绑定回调，完成双向同步
  - 保存返回的取消函数到 _transportUnsubscribe
- connect 返回 this // 支持链式调用

### connect getter

- 返回 _transport

### 修改 data setter

- 在现有 data setter 的 _notifyAll 之后增加一步
- 若 _transportSend 存在且 _syncEnabled 为 true
  - 调用 _transportSend(newData) // 本地数据变化自动同步到远端

### disconnect 方法

- 若 _transportUnsubscribe 存在，调用取消函数
- 若 _transport 和 _transport.close 存在，调用 close 清理资源
- _transport = null
- _transportSend = null
- _transportUnsubscribe = null

### pauseSync / resumeSync

- pauseSync：_syncEnabled = false // 临时暂停同步，用于批量操作避免频繁发送
- resumeSync：_syncEnabled = true，立即调用 _transportSend 发送当前 _data // 恢复后同步最新状态
