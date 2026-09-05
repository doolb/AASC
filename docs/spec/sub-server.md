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

## 控制端服务器列表实现（第一阶段）

```text
控制端打开 /upload
    → 侧边栏显示“服务器”入口
    → 用户点击入口
    → 切换到 panel-servers
    → 页面调用 GET /api/subservers
    → 校验响应为 { status: 'success', servers: [] }
    → 按服务器快照渲染只读卡片
    → 展示 id、name、url、healthy、latency、lastHealthCheck、currentDisplays、能力/版本元数据
    → 用户点击“刷新”
    → 重新请求 GET /api/subservers
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
