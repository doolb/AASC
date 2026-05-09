# 日志筛选与系统监控实现文档

## 概述

服务端结构化日志缓冲区，支持多维度筛选；系统 CPU 和内存监控数据采集；客户端日志查看器组件。

## 服务端 - LogBuffer

### 伪代码

```
常量 CATEGORY_LEVEL_MAP = {
    '错误': 'error',
    '断开': 'warn',
    '静音': 'warn',
    '连接': 'info',
    '语音': 'info',
    'TTS': 'info',
    '提醒': 'info',
    '设备': 'info',
    '能力': 'info',
    '系统': 'info',
    '子显示端': 'info',
    'AASC': 'info',
    '媒体库': 'info',
    '配置': 'info',
    '启动': 'info',
    'ASR': 'info',
    '录音': 'info'
}

常量 CATEGORY_DEVICE_MAP = {
    '语音': 'display',
    'TTS': 'display',
    '录音': 'display',
    'ASR': 'display',
    '子显示端': 'display'
}

类 LogBuffer:
    属性:
        maxSize: 最大缓冲区大小 = 1000
        buffer: 日志条目数组 = []
        listeners: 监听器集合 = new Set()

    构造函数(选项):
        this.maxSize = 选项.maxSize || 1000

    方法 add(类别, 消息, 附加信息):
        条目 = {
            id: Date.now() + '-' + 随机字符串,
            timestamp: Date.now(),
            time: 当前时间字符串(HH:MM:SS),
            category: 类别,
            level: CATEGORY_LEVEL_MAP[类别] || 'info',
            device: 附加信息.device || CATEGORY_DEVICE_MAP[类别] || 'server',
            message: 消息,
            displayId: 附加信息.displayId || null
        }
        this.buffer.push(条目)
        如果 this.buffer.length > this.maxSize:
            this.buffer.shift()
        this._notify(条目)
        返回 条目

    方法 getEntries(筛选条件):
        结果 = [...this.buffer]
        如果 筛选条件.search:
            搜索词 = 筛选条件.search.toLowerCase()
            结果 = 结果.filter(条目 =>
                条目.message.toLowerCase().includes(搜索词) ||
                条目.category.toLowerCase().includes(搜索词)
            )
        如果 筛选条件.levels 非空:
            结果 = 结果.filter(条目 => 筛选条件.levels.includes(条目.level))
        如果 筛选条件.devices 非空:
            结果 = 结果.filter(条目 => 筛选条件.devices.includes(条目.device))
        如果 筛选条件.categories 非空:
            结果 = 结果.filter(条目 => 筛选条件.categories.includes(条目.category))
        如果 筛选条件.timeRange !== 'all':
            截止时间 = 计算时间范围截止时间(筛选条件.timeRange)
            结果 = 结果.filter(条目 => 条目.timestamp >= 截止时间)
        如果 筛选条件.limit:
            结果 = 结果.slice(-筛选条件.limit)
        返回 结果

    方法 getCategories():
        返回 [...new Set(this.buffer.map(条目 => 条目.category))].sort()

    方法 onLogEntry(回调):
        this.listeners.add(回调)

    方法 removeLogEntryListener(回调):
        this.listeners.delete(回调)

    方法 _notify(条目):
        this.listeners.forEach(回调 => {
            try { 回调(条目) } catch(e) { 忽略 }
        })

    方法 clear():
        this.buffer = []

    属性 size:
        返回 this.buffer.length
```

## 服务端 - SystemMonitor

### 伪代码

```
类 SystemMonitor:
    属性:
        intervalMs: 采集间隔 = 5000
        timer: 定时器 = null
        lastCpuInfo: 上次CPU信息 = null
        listeners: 监听器集合 = new Set()
        currentStats: 当前统计数据 = null

    构造函数(选项):
        this.intervalMs = 选项.intervalMs || 5000

    方法 start():
        this.lastCpuInfo = os.cpus()
        this.lastCpuTime = process.hrtime()
        this.currentStats = this._collectStats()
        this.timer = setInterval(() => {
            this.currentStats = this._collectStats()
            this._notify(this.currentStats)
        }, this.intervalMs)

    方法 stop():
        如果 this.timer: clearInterval(this.timer)

    方法 getStats():
        返回 this.currentStats

    方法 onStats(回调):
        this.listeners.add(回调)

    方法 _collectStats():
        内存使用 = process.memoryUsage()
        总内存 = os.totalmem()
        空闲内存 = os.freemem()
        已用内存 = 总内存 - 空闲内存
        CPU使用率 = this._calculateCpuUsage()
        返回 {
            timestamp: Date.now(),
            cpu: { usage, count, model, loadAvg },
            memory: { total, used, free, usagePercent, process: { rss, heapTotal, heapUsed, external } },
            uptime: { system: os.uptime(), process: process.uptime() }
        }

    方法 _calculateCpuUsage():
        如果 !this.lastCpuInfo: 返回 0
        旧CPU = this.lastCpuInfo
        新CPU = os.cpus()
        总空闲差 = 0, 总使用差 = 0
        遍历每个CPU核心:
            旧 = 旧CPU[i], 新 = 新CPU[i]
            空闲差 = 新.times.idle - 旧.times.idle
            使用差 = (新.times.user + new.times.sys + new.times.nice) -
                     (旧.times.user + old.times.sys + old.times.nice)
            总空闲差 += 空闲差
            总使用差 += 使用差
        总计 = 总空闲差 + 总使用差
        返回 总计 > 0 ? (总使用差 / 总计 * 100).toFixed(1) : 0

    方法 _notify(统计数据):
        this.listeners.forEach(回调 => {
            try { 回调(统计数据) } catch(e) { 忽略 }
        })
```

## 服务端集成 (server.js)

### 伪代码

```
在 server.js 顶部:
    const LogBuffer = require('./core/log-buffer')
    const SystemMonitor = require('./core/system-monitor')

    const logBuffer = new LogBuffer({ maxSize: 1000 })
    const systemMonitor = new SystemMonitor({ intervalMs: 5000 })

修改 log() 函数:
    function log(category, message, extra):
        如果 useTUI:
            tui.addLog(category, message)
        否则:
            console.log(`${timestamp} [${category}] ${message}`)
        logBuffer.add(category, message, extra)

添加 API 端点:
    GET /api/logs:
        筛选条件 = {
            search: req.query.search,
            levels: req.query.levels?.split(','),
            devices: req.query.devices?.split(','),
            categories: req.query.categories?.split(','),
            timeRange: req.query.timeRange,
            limit: parseInt(req.query.limit) || 200
        }
        返回 { status: 'ok', total, filtered, entries, categories }

    GET /api/system-stats:
        返回 { status: 'ok', stats: systemMonitor.getStats() }

在服务器启动后:
    systemMonitor.start()

    logBuffer.onLogEntry((条目) => {
        broadcastToControls({ type: 'serverLog', entry: 条目 })
    })

    systemMonitor.onStats((统计数据) => {
        broadcastToControls({ type: 'systemStats', stats: 统计数据 })
    })

在控制端连接时:
    发送日志历史: { type: 'logHistory', entries, categories }
```

## 客户端 - LogViewer

### 伪代码

```
常量 LogViewer = {
    entries: [],           // 所有日志条目
    filteredEntries: [],   // 筛选后的条目
    categories: [],        // 已知标签列表
    autoScroll: true,      // 自动滚动
    maxDisplayEntries: 500, // 最大显示条目数

    filters: {
        search: '',
        levels: [],
        devices: [],
        categories: [],
        timeRange: 'all'
    },

    LEVEL_OPTIONS: [
        { value: 'error', label: '错误', color: '#ef4444' },
        { value: 'warn', label: '警告', color: '#f59e0b' },
        { value: 'info', label: '信息', color: '#3b82f6' },
        { value: 'debug', label: '调试', color: '#6b7280' }
    ],

    DEVICE_OPTIONS: [
        { value: 'server', label: '服务端' },
        { value: 'display', label: '显示端' },
        { value: 'control', label: '控制端' }
    ],

    TIME_RANGE_OPTIONS: [
        { value: 'all', label: '全部' },
        { value: '10s', label: '10秒' },
        { value: '30s', label: '30秒' },
        { value: '1m', label: '1分钟' },
        { value: '5m', label: '5分钟' },
        { value: '15m', label: '15分钟' },
        { value: '30m', label: '30分钟' },
        { value: '1h', label: '1小时' }
    ],

    方法 init():
        this._bindEvents()
        this._renderLevelFilters()
        this._renderDeviceFilters()
        this._renderTimeRangeOptions()

    方法 addEntry(条目):
        this.entries.push(条目)
        如果 this.entries.length > this.maxDisplayEntries * 2:
            this.entries = this.entries.slice(-this.maxDisplayEntries)
        如果 条目.category 不在 this.categories 中:
            this.categories.push(条目.category)
            this.categories.sort()
            this._renderCategoryFilters()
        如果 this._matchesFilters(条目):
            this.filteredEntries.push(条目)
            this._appendEntry(条目)
        this._updateCount()

    方法 addHistory(条目数组, 标签数组):
        this.entries = 条目数组.slice(-this.maxDisplayEntries)
        如果 标签数组: this.categories = 标签数组
        this.applyFilters()

    方法 applyFilters():
        this.filteredEntries = this.entries.filter(条目 => this._matchesFilters(条目))
        this._renderEntries()
        this._updateCount()

    方法 clearFilters():
        this.filters = { search: '', levels: [], devices: [], categories: [], timeRange: 'all' }
        更新UI控件状态
        this.applyFilters()

    方法 clearLogs():
        this.entries = []
        this.filteredEntries = []
        this._renderEntries()
        this._updateCount()

    方法 toggleAutoScroll():
        this.autoScroll = !this.autoScroll
        更新按钮状态

    方法 updateSystemStats(统计数据):
        更新系统状态面板（CPU、内存、进程内存、堆内存、运行时间）

    方法 _matchesFilters(条目):
        如果 this.filters.search 非空:
            如果 条目消息和类别都不包含搜索词: 返回 false
        如果 this.filters.levels 非空:
            如果 条目级别不在筛选级别中: 返回 false
        如果 this.filters.devices 非空:
            如果 条目设备不在筛选设备中: 返回 false
        如果 this.filters.categories 非空:
            如果 条目标签不在筛选标签中: 返回 false
        如果 this.filters.timeRange !== 'all':
            计算截止时间
            如果 条目时间戳 < 截止时间: 返回 false
        返回 true

    方法 _renderEntries():
        渲染所有筛选后的日志条目到日志容器

    方法 _appendEntry(条目):
        追加单条日志到日志容器末尾
        如果 autoScroll: 滚动到底部

    方法 _updateCount():
        更新计数显示 "筛选数/总数"

    方法 _formatBytes(字节数):
        格式化字节数为 B/KB/MB/GB

    方法 _formatUptime(秒数):
        格式化运行时间为 Xd Xh Xm Xs
}
```

## 日志上报控制（新增）

### 服务端

```
// 日志上报配置存储（内存）：
logReportConfig = {
    display: {            // 显示端默认配置
        enabled: false,
        level: 'error'    // 最低级别阈值：error|warn|info|debug
    },
    displayOverrides: Map<displayId, { enabled, level }>,  // 单设备覆盖
    control: {            // 控制端默认配置
        enabled: false,
        level: 'error'
    }
}

// 级别阈值检查：
函数 isLevelEnabled(配置级别, 日志级别):
    级别权重 = { error: 4, warn: 3, info: 2, debug: 1 }
    返回 级别权重[日志级别] >= 级别权重[配置级别]

// setLogReport handler（控制端→服务器）：
接收 { targetType, targetId, config: { enabled, level } }
如果 targetType === 'display':
    如果 targetId === 'all':
        logReportConfig.display = { enabled, level }
        遍历所有显示端 → 发送 { type: 'logReportConfig', enabled, level }
    否则:
        logReportConfig.displayOverrides.set(targetId, { enabled, level })
        发送到对应显示端 → { type: 'logReportConfig', enabled, level }
否则 targetType === 'control':
    logReportConfig.control = { enabled, level }
    发送到控制端自身 → { type: 'logReportConfig', enabled, level }
返回控制端 → { type: 'logReportConfigApplied', targetType, targetId, config }

// clientLog handler（显示端/控制端→服务器）：
接收 { level, category, message, deviceType, deviceId, timestamp }
logBuffer.add(category, message, {
    level: level,
    device: deviceType === 'display' ? displayId : 'control',
    source: deviceType,
    targetId: deviceId
})

// 显示端连接时：
发送初始 logReportConfig 给显示端

// 控制端连接时（新增）：
发送当前 logReportConfig 给控制端
```

### 显示端 (voice-display-node main.js)

```
// 新增 handler：
handleMessage: 新增 'logReportConfig' 分支：
    存储 this.logReportConfig = { enabled, level }

// 修改 log()/logError()：
function log(category, message):
    原有本地输出逻辑...
    如果 this.logReportConfig?.enabled:
        如果 isLevelEnabled(this.logReportConfig.level, 日志级别):
            sendClientLog(级别, category, message)

function sendClientLog(level, category, message):
    sendJSON({
        type: 'clientLog',
        level: level,
        category: category,
        message: message,
        deviceType: 'display',
        deviceId: this.config.displayId,
        timestamp: Date.now()
    })
```

### 控制端 (Web UI)

```
// LogViewer 新增方法：

// 日志上报配置UI：
renderLogReportControls():
    显示端上报: checkbox + 级别下拉框
    控制端上报: checkbox + 级别下拉框

handleLogReportConfig(config):
    this.logReportConfig = config
    // 启用/停用 console 拦截

// console 直接拦截：
常量 原始控制台 = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
常量 控制台日志级别权重 = { error: 4, warn: 3, info: 2, debug: 1 }

函数 isConsoleLogEnabled(级别):
    如果 !LogViewer.logReportConfig?.enabled: 返回 false
    返回 控制台日志级别权重[级别] >= 控制台日志级别权重[LogViewer.logReportConfig.level]

// 替换 console 方法：
console.log = function(...args) {
    原始控制台.log.apply(console, args)
    如果 isConsoleLogEnabled('info'):
        sendClientLog('info', args)
}
console.info = function(...args) {
    原始控制台.info.apply(console, args)
    如果 isConsoleLogEnabled('info'):
        sendClientLog('info', args)
}
console.warn = function(...args) {
    原始控制台.warn.apply(console, args)
    如果 isConsoleLogEnabled('warn'):
        sendClientLog('warn', args)
}
console.error = function(...args) {
    原始控制台.error.apply(console, args)
    如果 isConsoleLogEnabled('error'):
        sendClientLog('error', args)
}
console.debug = function(...args) {
    原始控制台.debug.apply(console, args)
    如果 isConsoleLogEnabled('debug'):
        sendClientLog('debug', args)
}

// 控制端发送 clientLog：
sendClientLog(level, args):
    如果 this.ws?.readyState === OPEN:
        this.ws.send({
            type: 'clientLog',
            level: levelMap[level],
            category: '控制端',
            message: util.format(...args),
            deviceType: 'control',
            deviceId: 'web-control',
            timestamp: Date.now()
        })
```

## 消息链路追踪（新增）

### 服务端

```
// correlationId 生成：
函数 generateCorrelationId(type):
    返回 `${type}-${Date.now()}-${Math.random(36).substring(2,6)}`

// sendToDisplay（增强）：
    如果 data 没有 correlationId:
        data.correlationId = generateCorrelationId(data.type)
    记录日志: { source: 'server', targetId: displayId, correlationId: data.correlationId }
    发送到显示端

// broadcastToControls（增强）：
    如果 data.correlationId 存在:
        记录日志附带 { correlationId }

// 控制端消息入口（增强）：
    如果消息有 displayId 或属于 display 操作类型:
        data.correlationId = generateCorrelationId(data.type)
    记录日志附带 { source: 'control', targetId: data.displayId, correlationId }

// commandAck 处理（增强）：
    ackCorrelationId = data.correlationId || generateCorrelationId('ack')
    记录日志: { source: displayId, targetId: 'server', correlationId: ackCorrelationId }
    广播到控制端时携带 correlationId
```

### 显示端 (display.html)

```
变量 _lastCorrelationId = null

函数 setCorrelationId(cid):
    如果 cid: _lastCorrelationId = cid

// 在 onmessage 入口调用：
setCorrelationId(data.correlationId)

// sendCommandAck 增强：
    如果 _lastCorrelationId:
        ack.correlationId = _lastCorrelationId
        _lastCorrelationId = null  // 使用后清空
```

### 客户端 LogViewer

```
// _getIndentClass 改为序号深度：
如果条目有 correlationId:
    depth = stack.length  // 同 correlationId 出现次数
    stack.push(条目)
    返回 indent-{depth}   // 0→无缩进, 1+→递增缩进

// _getArrowHtml 不变：
    有 source + targetId → "${src} ⇒ ${tgt}: message"
    只有 source → "[${src}] message"
    只有 targetId → "→ ${tgt}: message"
```

## 消息链示例

```
控制端 ⇒ display-1: media play "music"              ← 控制端发出（同correlationId, indent 0）
  服务端 ⇒ display-1: media action=play               ← 服务器转发（indent 1）
    display-1 ⇒ 服务端: ACK media ✓ success           ← 显示端确认（indent 2）
```

## WebSocket 消息类型

### 服务端 → 控制端

```
serverLog:
    type: 'serverLog'
    entry: { id, timestamp, time, category, level, device, message, displayId, correlationId, source, targetId }

logHistory:
    type: 'logHistory'
    entries: [日志条目数组]
    categories: [标签字符串数组]

systemStats:
    type: 'systemStats'
    stats: { timestamp, cpu, memory, uptime }

commandAck（增强）:
    type: 'commandAck'
    displayId: string
    commandType: string
    success: boolean
    details: string
    timestamp: number
    correlationId: string   // 新增：关联原始命令
    extraData: object

// 新增：
logReportConfig:
    type: 'logReportConfig'
    target: string       // 'display'|'control' 配置归属（仅控制端收到的消息含此字段）
    enabled: boolean
    level: string       // 'error'|'warn'|'info'|'debug'

logReportConfigApplied:
    type: 'logReportConfigApplied'
    targetType: string  // 'display'|'control'
    targetId: string    // 设备ID 或 'all'
    config: { enabled, level }
```

### 控制端 → 服务端（新增）

```
setLogReport:
    type: 'setLogReport'
    targetType: string    // 'display'|'control'
    targetId: string      // 设备ID 或 'all'
    config: {
        enabled: boolean,
        level: string     // 'error'|'warn'|'info'|'debug'
    }
```

### 显示端 ←→ 服务端（新增）

```
服务端→显示端:
    type: 'logReportConfig'
    enabled: boolean
    level: string

显示端→服务端:
    type: 'clientLog'
    level: string
    category: string
    message: string
    deviceType: 'display'
    deviceId: string
    timestamp: number

// 控制端→服务端（也可通过控制端WS发送 clientLog）:
    type: 'clientLog'
    level: string
    category: string
    message: string
    deviceType: 'control'
    deviceId: string
    timestamp: number
```

## HTML 结构（新增）

```
div.section "日志上报":
    div.log-report-row:
        span "显示端上报:"
        select.display-level (error/warn/info/debug)
    div.log-report-row:
        span "控制端上报:"
        select.control-level (error/warn/info/debug)
```

## HTML 结构

```
section#panel-logs:
    h1 "日志查看"

    div.section "系统状态":
        div.system-stats-grid:
            div.stat-item * 6 (CPU/内存/进程内存/堆内存/系统运行/进程运行)

    div.section "日志筛选":
        div.log-filter-bar:
            div.log-search-row:
                input#logSearchInput (搜索框)
                select#logTimeRange (时间范围)
                button "自动滚动"
                button "清除筛选"
                button "清空"
                span.log-count
            div.log-filter-row "级别":
                div#logLevelFilters (级别筛选按钮组)
            div.log-filter-row "设备":
                div#logDeviceFilters (设备筛选按钮组)
            div.log-filter-row "标签":
                div#logCategoryFilters (标签筛选按钮组)

    div.section.log-section:
        div#logEntries (日志条目容器)
```
