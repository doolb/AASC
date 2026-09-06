# AASC 子服务器主动连接架构设计

## 状态

已获用户确认，进入实现前设计阶段。

## 目标

将 AASC 服务器节点的连接方向调整为“子服务器主动连接主服务器”。主服务器只接受子服务器在 `/server` 建立的 WebSocket 长连接，并通过该连接接收注册、心跳和状态，向子服务器发送控制命令。主服务器不再使用 `SubServerManager` 主动访问子服务器作为 AASC 节点的连接来源。

主服务器固定入口为 `https://192.168.1.39:8081/`。子服务器仍使用现有启动器进程和服务进程两进程模型，代码更新继续由子服务器主动从主服务器拉取代码包。

## 非目标

- 当前不实现权限认证、节点签名和用户权限。
- 当前不实现局域网自动发现和最近服务器算法。
- 当前不做媒体文件复制或全量同步。
- 当前不改变显示端 `/display` 和控制端 `/control` WebSocket 协议。
- 当前不把所有普通任务强制迁移到子服务器；无显示端能力匹配时仍可由当前主服务器执行。

## 方案

采用持久 WebSocket 控制平面，地址为主服务器的 `wss://<host>:<port>/server`。`/server` 同时支持 HTTP 代码接口和 WebSocket 节点连接：

- HTTP `GET /server`：返回服务器代码版本清单。
- HTTP `GET /server/package`：返回服务器代码包。
- WebSocket `/server`：接受子服务器主动连接。

主服务器和子服务器之间的节点控制、心跳、远程请求和命令响应都经过 WebSocket。子服务器地址只作为显示端、网页和媒体实际访问的 advertised URL，主服务器不使用该地址发起健康检查或控制请求。

## 拓扑与角色

```text
主服务器
  HTTPS server
    ├── GET /server                 代码清单
    ├── GET /server/package         代码包
    ├── WS /server                  子服务器主动连接入口
    ├── WS /display                 显示端连接
    └── WS /control                 控制端连接

子服务器
  启动器进程 server-launcher.js
    └── 服务进程 server-app.js
          └── AascNodeConnector
                └── 主动连接主服务器 WS /server
```

`aasc.role=main` 时只提供主服务器入口和节点接收端；`aasc.role=subserver` 时启动本地服务后创建 `AascNodeConnector`，不登记为 `main-server`，也不启动主服务器专用的远程节点主动检查流程。

## 配置契约

新增 `aasc` 配置对象：

```text
aasc.role                 = main | subserver，默认 main
aasc.mainServerUrl        = https://192.168.1.39:8081
aasc.nodeId               = 持久化子服务器 ID
aasc.nodeName             = 子服务器展示名称
aasc.advertisedUrl        = 子服务器给显示端/网页访问的基础地址
aasc.heartbeatIntervalMs  = 30000
aasc.reconnectMinMs       = 1000
aasc.reconnectMaxMs       = 30000
```

`nodeId` 为空时由子服务器首次启动生成并持久化到节点配置；`advertisedUrl` 不作为主服务器连接地址。主服务器自身固定使用 `nodeId=main-server`，其地址从实际监听协议、局域网地址和端口生成。

## 消息协议

所有消息都是 JSON 对象：

```text
AascNodeMessage {
    type,
    requestId,
    nodeId,
    timestamp,
    payload
}
```

### 注册

```text
子服务器 → 主服务器
    type = node.register
    payload = {
        nodeId,
        name,
        url,
        version,
        capabilities,
        metadata: { role: subserver, platform, arch }
    }

主服务器 → 子服务器
    type = node.registered
    payload = { nodeId, heartbeatIntervalMs, serverTime }
```

主服务器按 `nodeId` 保证幂等。相同节点的新连接接管旧连接，旧连接关闭；注册信息和连接句柄分开保存，快照不能暴露 WebSocket 或内部对象。

### 心跳

```text
子服务器 → 主服务器
    type = node.heartbeat
    payload = { version, capabilities, metadata, stats }

主服务器 → 子服务器
    type = node.heartbeatAck
    payload = { serverTime }
```

心跳间隔默认 30 秒，连续 90 秒没有有效心跳或连接已关闭时标记离线。重连成功后重新注册并恢复在线，不产生重复节点。

### 请求与响应

主服务器通过 `requestId` 向在线子服务器发送 `node.request`，子服务器返回 `node.response`。请求必须有有限超时；超时只结束本次请求，不阻塞心跳和其他节点。

首批请求类型：

- `media.index.local`：请求子服务器返回本地媒体索引。
- `task.execute`：仅用于明确指定服务节点的任务；显示端优先规则不变。
- `server.update`：通知子服务器主动从主服务器拉取 `/server` 清单和代码包，然后运行 Bootstrap 热更新。
- `server.restart`：请求子服务器通知现有双进程启动器重启服务进程；无启动器时交给外部监督器恢复。

子服务器收到更新命令后先返回 `accepted`，再由一次性 Bootstrap 执行更新。服务重启导致 WebSocket 中断时，Bootstrap 完成后由新服务重新连接并在注册元数据中回传当前版本；更新失败由 Bootstrap 负责恢复旧代码并重新连接。

## 主服务器生命周期

```text
启动主服务器
    → 创建 AascServerRegistry
    → 登记 main-server
    → 创建 WS /server 节点入口
    → 接收 node.register
    → 校验并登记节点和连接句柄
    → 回复 node.registered
    → 接收 node.heartbeat 并刷新状态
    → 通过 node.request 向在线节点发起有限时请求

节点连接关闭
    → 从连接索引移除当前连接
    → 将对应节点标记 offline
    → 广播服务器列表变化
    → 不主动 HTTP 重连或健康检查
```

`GET /api/aasc/servers` 只返回主服务器和主动连接注册表中的节点。旧 `/api/subservers` 接口继续保留，供历史配置和兼容调用使用，但旧配置不再注入 AASC 主动连接目录，也不触发主服务器访问子服务器。

## 子服务器生命周期

```text
启动 server-app.js
    → 读取 aasc.role
    → role=subserver 时初始化 AascNodeConnector
    → 服务监听成功后主动连接 mainServerUrl 的 /server
    → 注册节点信息
    → 按间隔发送心跳
    → 收到 node.request 时执行白名单请求
    → 连接断开时按指数退避重连
    → 服务关闭时停止连接和定时器
```

重连延迟从 `reconnectMinMs` 开始，每次失败按两倍增长，最大不超过 `reconnectMaxMs`；连接成功后恢复初始延迟。重连过程不能创建额外常驻 Node 服务进程。

## 媒体索引与任务边界

主服务器聚合媒体索引时改为调用注册表中节点连接的 `media.index.local` 请求，不再调用远程节点 HTTP `/api/aasc/media-index`。索引里的 `ownerUrl` 仍指向媒体所属服务器，显示端或网页播放媒体时可以直接访问该地址。

任务路由保持当前规则：

```text
收到任务
    → 有在线且能力匹配的显示端
        → 通过现有 task:execute 投递显示端
    → 否则任务明确允许服务节点执行
        → 当前主服务器或在线子服务器通过 AASC 请求执行
    → 否则
        → 返回能力不可用
```

显示端优先任务不因子服务器在线而改变执行位置。没有明确服务节点目标时，继续使用当前主服务器回退，避免扩大本次架构迁移范围。

## 错误处理与观测

- 注册字段错误返回结构化 `node.error`，不创建半成品节点。
- 未注册节点不能发送业务请求；主服务器记录协议错误并关闭连接。
- 请求超时返回 `node.response` 的超时错误，不影响同一连接的心跳。
- 重复节点连接由新连接接管，旧连接关闭原因写入日志。
- 主服务器列表中的在线状态以连接和心跳为准，不接受节点自行上报的 `status`。
- 记录连接建立、注册成功、断开、重连次数、请求耗时、更新接受和更新结果。

## 兼容与迁移

1. 主服务器继续提供现有 HTTP `/server` 清单和代码包接口，Termux Bootstrap 的主动下载方式不变。
2. `server-launcher.js` 和 `server-app.js` 的双进程关系不变。
3. 显示端 `/display`、控制端 `/control`、运行时桥 `/runtime-bridge` 不改路径。
4. 网页手动输入服务器地址仍保留，仅用于浏览器跳转到目标 `/control`，不用于登记子服务器。
5. 旧 `SubServerManager` 和 `/api/subservers` 暂不删除，后续确认无调用后再清理。

## 验收标准

- 子服务器不调用主服务器的 HTTP 注册/心跳接口，而是主动建立 `/server` WebSocket。
- 主服务器重启后，子服务器能自动重连、重新注册并在列表中恢复在线。
- 子服务器断开后主服务器不再通过其 `url` 发起健康检查，节点在超时或断开后显示离线。
- 主服务器可以通过连接请求子服务器媒体索引，并能处理单节点超时。
- 主服务器下发更新命令后，子服务器仍以两进程方式完成 Bootstrap 更新和失败回滚。
- `/display`、`/control`、HTTP `/server` 和网页手动地址连接保持兼容。
- 不引入权限认证、自动发现或媒体文件复制。
