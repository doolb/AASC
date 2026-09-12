# 显示端代码变化检测远端配置设计

## 需求

显示端页面继续检测 `public` 目录文件的最新修改时间，检测周期从固定 30 秒改为可由控制端配置。配置必须沿用 AASC 的远端配置流程，不增加独立的配置读取或保存 HTTP 接口。

## 设计原则

- 控制端是配置操作入口，但服务端是配置权威和持久化责任方。
- 控制端通过 `/control` WebSocket 发送配置更新；服务端使用现有 `config.set` 保存到主配置。
- 服务端通过显示端 WebSocket 在连接初始化时下发配置，更新时广播到所有在线显示端。
- `/api/display-version` 只查询静态文件版本时间戳，不承担配置读写。
- 显示端配置未及时收到时使用 30 秒默认值，保证旧页面、断线重连和服务端升级期间兼容。

## 配置和消息

| 项目 | 值 |
|------|----|
| 配置键 | `display.versionCheckIntervalMs` |
| 默认值 | `30000` 毫秒 |
| 最小值 | `5000` 毫秒 |
| 最大值 | `300000` 毫秒 |
| 控制端更新消息 | `updateDisplayVersionConfig` |
| 服务端同步消息 | `displayVersionConfig` |
| 消息字段 | `intervalMs` |

控制端以秒显示和输入，发送前换算为毫秒。服务端对非有限值、非整数和范围外输入统一规范化到合法值；服务端回复规范化后的值，避免多个控制端显示不一致。

## 数据流

```text
控制端 Settings
    -- updateDisplayVersionConfig(intervalMs) -->
服务端 WebSocket 控制连接
    -- normalize + config.set('display.versionCheckIntervalMs', value) -->
主配置文件
    -- displayVersionConfig(intervalMs) --> 控制端
    -- displayVersionConfig(intervalMs) --> 所有在线显示端
```

显示端连接成功时，服务端直接发送当前 `displayVersionConfig`。显示端收到新值后取消已有版本检查定时器，并使用新间隔重新调度；文件版本改变时仍执行 `location.reload()`，HTTP 查询失败时仍按当前间隔重试。

## 非目标

- 不新增 `/api/display-version-config` 或其他独立配置 GET/POST 接口。
- 不改变文件版本计算方式，不增加服务端常驻文件监听器。
- 不为控制端增加文件版本轮询。
