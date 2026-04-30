#skill: ai-code-translation

# 服务端 TUI 界面重新集成

## 目标文件清单

- `src/apps/server/boot/server-app.js` // 增加 import、改造 log/logError、添加 TUI 集成点
- `package.json` // dependencies 添加 blessed

## 范围约束

- 只改 server-app.js 和 root package.json
- 不修改 ServerTUI 模块本身（`src/framework/observability/server-tui.js`）
- 不修改 console-redirect 模块（`src/framework/observability/console-redirect.js`）
- 不修改 system-monitor 模块（`src/framework/observability/system-monitor.js`）
- blessed 版本固定为 `^0.1.81`（与 `3rd/voice-display-node/package.json` 一致）

## 已有声明

- `ServerTUI` { `enabled`, `screen`, `headerBox`, `statusBox`, `deviceTable`, `logBox` }
- `ServerTUI.setHeader(protocol, ip, port)` — 设置标题栏，显示协议/IP/端口
- `ServerTUI.addLog(category, message)` — 添加彩色日志到 TUI 日志框
- `ServerTUI.startRefresh(getStatusFn, getDevicesFn)` — 启动 2s 定时刷新面板
- `ServerTUI.updateSystemStats(stats)` — 推入系统监控数据到状态面板
- `ServerTUI.destroy()` — 销毁 TUI 资源，清理定时器
- `installConsoleRedirect({ enabled, writeLog })` — 重定向 console.* 到 TUI 日志，避免破坏 blessed 渲染
- `LogBuffer.add(category, message, extra)` — 日志缓冲区，始终写入
- `LogBrain.ingest(entry)` — 日志分析引擎，始终调用
- `SystemMonitor.onStats(callback)` — 系统监控数据产生回调，已有 broadcaster 使用
- `getLocalIP()` — 获取本机 IP（位于 `src/apps/server/boot/server-app.js:2783`）
- `getDisplayList()` — 获取显示端列表数组（位于 `src/apps/server/boot/server-app.js:1776`）
- `displayClients` — `Map<id, { ip, state, ... }>` 显示端集合（位于 line 144）
- `controlClients` — `Set<ws>` 控制端集合（位于 line 145）
- `useHttps` — boolean，由 ssl 证书文件存在性决定（位于 line 120）
- `muteState.isMuted` — 静音状态（位于 line 148）
- `serverStartTime` — `Date.now()` 启动时间（位于 line 146）
- `process.argv.includes('--no-tui')` — 命令行关闭 TUI 的标志检测

## 新增定义

- `useTUI` { `boolean` } — `!process.argv.includes('--no-tui')`
- `tui` { `ServerTUI` } — `new ServerTUI({ enabled: useTUI })`

## 操作流程

### 流程 1：模块引入

```
在 server-app.js 顶部 require 块的最后（Line 24 之后）追加:

    const ServerTUI = require('../../../framework/observability/server-tui')
    const { installConsoleRedirect } = require('../../../framework/observability/console-redirect')
    const useTUI = !process.argv.includes('--no-tui')
    const tui = new ServerTUI({ enabled: useTUI })
```

### 流程 2：日志函数改造

```
改造 log(category, message, extra)（现有 Line 42-47）:

    时间戳 = new Date().toTimeString().split(' ')[0]
    entry = logBuffer.add(category, message, extra)  // 始终写入缓冲区
    logBrain.ingest(entry)  // 始终输入分析引擎
    如果 useTUI:
        tui.addLog(category, message)  // TUI 模式下日志写入 TUI 而非 console
    否则:
        console.log(`${时间戳} [${category}] ${message}`)  // 纯文本模式输出

改造 logError(category, message, extra)（现有 Line 49-54）:

    时间戳 = new Date().toTimeString().split(' ')[0]
    entry = logBuffer.add(category, message, extra)
    logBrain.ingest(entry)
    如果 useTUI:
        tui.addLog(category, message)  // TUI 模式下错误日志也写入 TUI
    否则:
        console.error(`${时间戳} [${category}] ${message}`)
```

### 流程 3：控制台输出重定向

```
在 log/logError 定义之后（Line 55 后，formatFileSize 之前）追加:

    installConsoleRedirect({
        enabled: useTUI,
        writeLog: (level, message) => {
            category = (level === 'error') ? '错误' : '系统'
            tui.addLog(category, message)
        }
    })
// 原因：TUI 模式下第三方库或遗留代码的 console.log/error 会破坏 blessed 渲染
```

### 流程 4：标题栏设置

```
在 server.listen 回调内部（现有 Line 246-250，三条 log 输出之后）追加:

    tui.setHeader(protocol, localIP, PORT)
// 原因：此时 protocol、localIP、PORT 均已确定，标题栏才能显示正确地址
```

### 流程 5：定时刷新启动

```
在 server.listen 回调内部、wsServer 初始化成功之后（Line 404 附近）追加:

    tui.startRefresh(
        () => ({
            uptime: Math.floor((Date.now() - serverStartTime) / 1000),  // 秒
            memoryRSS: process.memoryUsage().rss,
            memoryHeapUsed: process.memoryUsage().heapUsed,
            memoryHeapTotal: process.memoryUsage().heapTotal,
            protocol: useHttps ? 'https' : 'http',  // 与 server 选择一致
            isMuted: muteState.isMuted,
            displayCount: displayClients.size,
            controlCount: controlClients.size
        }),
        () => getDisplayList()
    )
```

### 流程 6：系统监控数据接入

```
在现有 systemMonitor.onStats 回调内部（现有 Line 395-402）追加 tui 调用:

    systemMonitor.onStats((stats) => {
        tui.updateSystemStats(stats)  // 新增：推入 TUI 状态面板
        if (controlClients.size > 0) {
            broadcastToControls({ type: 'systemStats', stats })
        }
    })
// 原因：复用已有的 systemMonitor 实例和 onStats 回调，不新增订阅
```

### 流程 7：清理退出

```
无需新增信号处理器。

ServerTUI 构造函数已注册 'q' 和 'C-c' 按键监听（server-tui.js:230-233），
按下后自动调用 tui.destroy() + process.exit(0)。

其余 process.exit(0) 调用点（如重启流程 Line 1760/1764）不受影响，
因为进程退出时操作系统会回收资源，blessed screen 无需额外清理。
```

### 流程 8：依赖添加

```
在 root package.json 的 dependencies 中添加:

    "blessed": "^0.1.81"
```
