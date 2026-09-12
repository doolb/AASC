# 显示端代码变化检测远端配置实现文档

## 配置规范化

```text
DEFAULT_DISPLAY_VERSION_INTERVAL_MS = 30000
MIN_DISPLAY_VERSION_INTERVAL_MS = 5000
MAX_DISPLAY_VERSION_INTERVAL_MS = 300000

normalizeDisplayVersionInterval(value):
    number = Number(value)
    if number 不是有限数字:
        return DEFAULT_DISPLAY_VERSION_INTERVAL_MS
    return 四舍五入后限制在 [MIN, MAX] 的 number

getDisplayVersionConfig():
    return {
        intervalMs: normalizeDisplayVersionInterval(
            config.get('display.versionCheckIntervalMs')
        )
    }
```

## AASC 远端配置消息流程

```text
控制端连接 /control:
    服务端发送 { type: 'displayVersionConfig', intervalMs }

控制端保存设置:
    send({
        type: 'updateDisplayVersionConfig',
        intervalMs: seconds * 1000
    })

服务端收到 updateDisplayVersionConfig:
    intervalMs = normalizeDisplayVersionInterval(data.intervalMs)
    config.set('display.versionCheckIntervalMs', intervalMs)
    message = { type: 'displayVersionConfig', intervalMs }
    broadcastToControls(message)
    displayClients.forEach(display => sendToDisplay(display.id, message))
    当前控制端再次发送 message
```

服务端显示端连接初始化时发送同一个 `displayVersionConfig` 消息。除既有 `/api/display-version` 版本查询外，不提供配置读取和保存 HTTP 接口。

## 控制端伪代码

```text
Settings.init():
    updateUI()

Settings.handleDisplayVersionConfig(config):
    displayVersionIntervalMs = normalize(config.intervalMs)
    input.value = displayVersionIntervalMs / 1000

Settings.saveDisplayVersionConfig():
    seconds = Number(input.value)
    if seconds 不在 5..300:
        显示错误并返回
    WebSocketManager.send({
        type: 'updateDisplayVersionConfig',
        intervalMs: seconds * 1000
    })
```

## 显示端伪代码

```text
displayVersionIntervalMs = 30000
displayVersionWatchTimer = null

scheduleDisplayVersionWatch():
    清理 displayVersionWatchTimer
    displayVersionWatchTimer = setTimeout(watchDisplayVersion, displayVersionIntervalMs)

watchDisplayVersion():
    请求 /api/display-version
    如果 version 第一次返回:
        保存 version
    如果 version 变化:
        location.reload()
    否则:
        scheduleDisplayVersionWatch()
    请求失败:
        scheduleDisplayVersionWatch()

收到 displayVersionConfig:
    displayVersionIntervalMs = normalize(intervalMs)
    scheduleDisplayVersionWatch()
```

## 兼容性

- 没有新配置的旧 `config.json` 使用 30 秒。
- 显示端 WebSocket 尚未收到配置时使用 30 秒。
- 既有 `/api/display-version` 响应格式 `{ version }` 不变。
- 控制端不执行文件版本查询，也不产生独立轮询。
