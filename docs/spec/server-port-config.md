# 控制端服务器端口设置实现伪代码

```text
DEFAULT_SERVER_PORT = 8081

normalizeServerPort(value, fallback):
  若 value 为整数且 1 <= value <= 65535，返回 value
  若允许 fallback，则规范化 fallback；否则返回错误

控制端设置卡片:
  初始化 serverPort = DEFAULT_SERVER_PORT
  收到 serverPortConfig -> 更新输入框和权威值
  保存时校验整数范围
  无效 -> 显示错误且不发送
  有效 -> send({ type: 'setServerPortConfig', port })

服务端收到 setServerPortConfig:
  确认消息来自控制端
  若 serverRestartScheduled -> 回送当前权威端口和重启中错误，不再改写配置
  validation = validateServerPort(message.port)
  validation 失败 -> 向发送端回传当前权威端口和错误
  config.set('server.port', validation.port)
  保存失败 -> 向发送端回传当前权威端口和错误，不广播/不重启
  保存成功 -> 向控制端和在线显示端广播
    { type: 'serverPortConfig', port, success: true,
      restartRequired: (port != 当前监听端口) }
  若 restartRequired -> 留出消息接收时间后调用现有 requestManagedServerRestart()

控制端连接 / 显示端连接初始化:
  发送 serverPortConfig(当前持久化权威端口)

控制端或显示端收到变更通知:
  更新输入框
  若 restartRequired:
    构造保留 pathname/search/hash 的目标 URL，将端口改为权威端口
    定时探测目标端口可访问
    可访问 -> 跳转目标 URL
    尚不可访问 -> 稍后重试
```
