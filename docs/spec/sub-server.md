# 子服务器管理 实现文档

## 模块结构

```
src/framework/cluster/sub-server-manager.js
├── SubServer          # 单个子服务器管理
│   ├── healthCheck()  # 健康检查
│   ├── registerDisplay()    # 注册显示端
│   ├── unregisterDisplay()  # 注销显示端
│   ├── sendToDisplay()      # 发送消息到显示端
│   └── getDisplayList()     # 获取显示端列表
└── SubServerManager   # 子服务器集合管理
    ├── addServer()          # 添加子服务器
    ├── removeServer()       # 删除子服务器
    ├── getAvailableServers() # 获取可用服务器列表
    ├── selectBestServer()   # 负载均衡选择最佳服务器
    ├── checkAllHealth()     # 批量健康检查
    ├── startHealthCheck()   # 启动定时健康检查
    └── loadFromConfig()     # 从配置加载
```

## SubServer 类

### 构造函数
```
SubServer(id, url, config)
    id: 服务器唯一标识
    url: 服务器地址 (如 http://192.168.1.100:3001)
    config:
        name: 服务器名称
        maxDisplays: 最大显示端数 (默认10)
        currentDisplays: 当前显示端数 (默认0)
        priority: 优先级 (默认0，越大越优先)
        enabled: 是否启用 (默认true)
```

### healthCheck
```
async healthCheck():
    发送 GET /api/health 请求
    记录响应时间作为延迟
    更新 healthy 状态
    更新 lastHealthCheck 时间
    超时5秒
    返回 healthy 状态
```

### registerDisplay
```
async registerDisplay(displayId, displayData):
    发送 POST /api/displays 请求
    成功时 currentDisplays++
    返回结果
```

### sendToDisplay
```
async sendToDisplay(displayId, data):
    发送 POST /api/displays/{displayId}/send 请求
    返回结果
```

## SubServerManager 类

### selectBestServer 负载均衡策略
```
selectBestServer():
    过滤: enabled && healthy
    排序1: priority 降序 (高优先级优先)
    排序2: currentDisplays/maxDisplays 升序 (低负载优先)
    返回排序后的第一个服务器
```

### 健康检查
```
startHealthCheck(period):
    立即执行一次 checkAllHealth
    设置定时器，每 period 毫秒执行一次
    默认间隔 30000ms

checkAllHealth():
    并行执行所有服务器的 healthCheck
    汇总结果: { total, healthy, unhealthy }
```

### 配置持久化
```
saveToConfig():
    序列化所有服务器配置
    返回 { servers: [...], healthCheckPeriod }

loadFromConfig(config):
    遍历 config.servers
    调用 addServer 加载每个服务器
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/subservers | 获取所有子服务器列表 |
| POST | /api/subservers | 添加子服务器 |
| DELETE | /api/subservers/:id | 删除子服务器 |
| GET | /api/subservers/health | 检查所有子服务器健康状态 |

## 相关文件

| 文件 | 说明 |
|------|------|
| src/framework/cluster/sub-server-manager.js | 子服务器管理核心模块 |
| server.js | API 路由和集成 |
| config/config.json | 配置持久化 |

## 强制获取最新代码伪代码

```text
主服务器发送 node.request
    → type = server.update
    → payload.force = true
    → 子服务器启动一次性 Bootstrap update --force
    → Bootstrap 为 /server 清单和代码包请求增加缓存绕过参数
    → 即使版本号相同也重新下载并执行既有校验、备份、双进程重启和回滚流程
```

## 控制端服务器列表实现（第一阶段）

```text
控制端打开 /control
    → 侧边栏显示“服务器”入口
    → 用户点击入口
    → 切换到 panel-servers
    → 页面调用 GET /api/aasc/servers
    → 校验响应为 { status: 'success', servers: [] }
    → 按服务器快照渲染只读卡片
    → 展示 nodeId、name、url、status、connected、lastHeartbeatAt、能力/版本元数据
    → 用户点击“刷新”
    → 重新请求 GET /api/aasc/servers
    → 请求失败或响应异常时显示错误状态，不清空上一次成功数据
```

页面边界：

```text
允许：查看服务器列表、手动刷新
不允许：添加、删除、编辑、自动发现、自动选择最近服务器、权限管理
```

兼容规则：

```text
如果服务器快照缺少可选字段
    → 使用“未提供”或“未知”显示
如果 servers 为空
    → 显示“暂无服务器”空状态
如果请求失败
    → 显示错误提示并保留已有列表
```

## 子服务器任务路由边界

```text
收到普通媒体或显示任务
    → 查询显示端能力
    → 存在匹配显示端
        → 直接向显示端发送任务
    → 不存在匹配显示端
        → 判断任务是否允许服务节点执行
        → 允许时查询主服务器/子服务器能力
        → 选择可用服务节点并发送任务
        → 不允许时返回能力不可用
```

```text
子服务器使用条件
    → 任务需要服务器本地媒体库、NAS、数据库或持久化资源
    → 或任务需要 Node.js、Puppeteer、后台脚本等服务端运行环境
    → 或任务需要显示端离线后继续运行
    → 或任务需要资源隔离、网络出口、聚合或多显示端网关
```

`SubServerManager` 只负责已选择服务节点之后的健康检查、负载排序和消息转发，不负责劫持所有显示端任务。

## 子服务器主动连接伪代码

```text
子服务器启动
    → 读取 aasc.role=subserver
    → 读取 aasc.mainServerUrl、aasc.nodeId、aasc.advertisedUrl
    → 主动建立 WebSocket /server
    → 发送 node.register
    → 周期发送 node.heartbeat
    → 收到 node.request 后执行 media.index.local、task.execute 或 server.update
    → 断线清理状态并指数退避重连
```

```text
主服务器节点入口
    → 接收子服务器 /server WebSocket
    → 首条消息必须是 node.register
    → 将 nodeId 与连接句柄放入 AascServerRegistry
    → 新连接接管同 nodeId 的旧连接
    → 连接关闭时标记节点离线
    → 不通过节点 url 主动发起 HTTP 健康检查
```

旧 `/api/subservers` 和 `SubServerManager` 只作为兼容层保留，不再代表 AASC 节点主动连接状态。

## AASC 节点运行数据与媒体库空状态

```text
子服务器服务进程
    → 每次 node.register 和 node.heartbeat 读取本地运行统计
    → runtime.displayCount = displayClients.size
    → runtime.controlCount = controlClients.size
    → runtime.libraryCount = MediaLibraryManager.listLibraries().length
    → 通过 /server WebSocket 上报 runtime
```

```text
控制端打开子服务器 /control
    → 请求 GET /api/media-libraries
    → libraries 为空时显示“暂无媒体库”
    → 同时保留“+ 添加”按钮
    → 用户添加本地、HTTP 或 SMB 媒体库
    → 子服务器保存 media-libraries.json
    → 主服务器下次 GET /api/aasc/media-index 时通过 node.request 获取该媒体库索引
```

主服务器的共享媒体库面板只读取聚合索引，不直接修改子服务器媒体库。要管理 Termux 子服务器媒体库，连接 `https://<子服务器地址>:8081/control`。

## 控制端批量重载子服务器代码

```text
控制端服务端设置
    → 用户确认“重载所有子服务端代码”
    → 调用主服务器 POST /api/aasc/servers/update-all
    → 主服务器只选择在线且已有主动 WebSocket 连接的子服务器
    → 每个节点接收 server.update
    → 子服务器启动 Bootstrap update
    → 返回节点级 accepted 或错误汇总
```

主服务器不把自己加入批量更新列表；没有在线子服务器时返回成功的空汇总，不产生错误更新请求。
