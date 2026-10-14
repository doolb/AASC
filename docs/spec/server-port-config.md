# 控制端服务器端口设置实现伪代码

## APK 冷启动保留端口（2026-10-14）

```text
已有声明 := NodeServerConfig.write + 持久化 server.port + NodeServerService 本机健康检查
新增定义 := 有效端口 = 数值整数且属于 1..65535，缺省端口 = 8081
普通 APK 启动配置 → 读取原配置 → 保留有效 server.port，否则写缺省端口
Offline APK 启动配置 → 继续写 8081，与本机 WebView 首装地址一致
本机健康 URL → 读取当前配置端口 + 证书决定协议 + 回环地址 + /api/status
损坏配置 → 健康检查失败，不探测另一个 APK 的缺省端口
ADB 普通 APK → 已经通过 setServerPortConfig 保存 8071 → 覆盖安装 → 完全停止并重开
普通 withserver 出包版本 := versionCode 2，versionName 0.1.1；与当前设备普通 v1 区分
验收 → 普通配置/监听/权威广播均 8071；Offline 配置 8081；普通节点仍连接原主服务器
实际验收 := 普通APK v2覆盖 + force-stop + 重新启动 → /api/status 200/ok + 权威端口8071
主服务器目录 := 同一nodeId在线，URL8071，版本apk-0.1.1；Offline仅配置核对8081
自动验证 := Android232/232 + profile/端口契约16/16，无失败/跳过
```

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
