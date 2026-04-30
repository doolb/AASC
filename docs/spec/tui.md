# TUI 界面实现文档

## 概述

使用 blessed 库为服务端和子显示端实现 TUI 界面，替代 console.log 输出。

### blessed 补丁

```
const _origGetShrinkContent = blessed.Element.prototype._getShrinkContent;
blessed.Element.prototype._getShrinkContent = function(xi, xl, yi, yl) {
    if (!this._clines) {
        return { xi: xi, xl: xl, yi: yi, yl: yl };
    }
    return _origGetShrinkContent.call(this, xi, xl, yi, yl);
};

在加载 blessed 后，monkey-patch _getShrinkContent 方法：
    保存原始 _getShrinkContent 到 _origGetShrinkContent
    替换为:
        如果 this._clines 为 undefined:
            返回原始坐标 { xi, xl, yi, yl }
        否则:
            调用原始 _origGetShrinkContent

原因：blessed Table 组件 attach 时调用 setContent('')，
触发 clearPos → _getShrinkContent，但 _clines 尚未初始化，
导致 TypeError: Cannot read properties of undefined (reading 'length')
```


## 服务端 TUI - ServerTUI

### 伪代码

```
类 ServerTUI:
    属性:
        screen: blessed.Screen 实例
        headerBox: 标题栏组件
        statusBox: 系统状态组件
        deviceTable: 设备列表表格组件
        logBox: 事件日志组件
        maxLogLines: 最大日志行数 = 500
        refreshTimer: 刷新定时器
        enabled: 是否启用TUI
        logFilter: 当前日志筛选级别 = 'all'
        logFilterOptions: 筛选选项 = ['all', 'error', 'warn', 'info', 'debug']
        logFilterLabels: 筛选标签 = { all: '全部', error: '错误', warn: '警告', info: '信息', debug: '调试' }
        logBuffer: 日志缓冲区 = []
        maxLogBuffer: 最大缓冲区大小 = 2000
        systemStats: 系统监控数据 = null
        filterMode: 当前筛选维度 = 'level' (可选 'level' 或 'category')
        filterModes: 筛选维度列表 = ['level', 'category']
        levelFilter: 级别筛选值 = 'all'
        levelFilterOptions: 级别筛选选项 = ['all', 'error', 'warn', 'info', 'debug']
        levelFilterLabels: 级别筛选标签 = { all: '全部', error: '错误', warn: '警告', info: '信息', debug: '调试' }
        categoryFilter: 类别筛选值 = 'all'
        categoryFilterOptions: 类别筛选选项 = ['all'] (动态扩展)
        categoryFilterLabels: 类别筛选标签 = { all: '全部' } (动态扩展)
        knownCategories: 已知类别集合 = new Set()
        _logCount: 日志计数器 = 0
        _trimTimer: 定时清理定时器 = null

    构造函数(选项):
        如果 选项.enabled === false:
            this.enabled = false
            返回
        this.enabled = true
        this.maxLogLines = 选项.maxLogLines || 500
        this._logCount = 0
        this._trimTimer = null
        this.初始化界面()

    方法 初始化界面():
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Web MediaCenter Server',
            fullUnicode: true
        })

        this.headerBox = blessed.box({
            顶部: 0, 左边: 0, 宽度: '100%', 高度: 1,
            样式: { bg: 'blue', fg: 'white', bold: true },
            内容: 'Web MediaCenter Server'
        })

        this.statusBox = blessed.box({
            顶部: 1, 左边: 0, 宽度: '30%', 高度: '50%',
            标签: ' 系统状态 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'cyan' } },
            滚动: true
        })

        this.deviceTable = blessed.table({
            顶部: 1, 左边: '30%', 宽度: '70%', 高度: '50%',
            标签: ' 设备列表 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'green' } },
            表头: ['ID', 'IP', '类型', '能力'],
            数据: []
        })

        this.logBox = blessed.log({
            顶部: '50%+1', 左边: 0, 宽度: '100%', 高度: '50%-2',
            标签: ' 事件日志 [级别:全部] ',
            边框: { type: 'line' },
            样式: { border: { fg: 'yellow' } },
            滚动: true,
            可聚焦: true,
            缓冲区长度: this.maxLogLines
        })

        screen.append(headerBox)
        screen.append(statusBox)
        screen.append(deviceTable)
        screen.append(logBox)

        logBox.focus()

        screen.key(['q', 'C-c'], () => process.exit(0))
        screen.key(['left'], () => {
            如果 this.filterMode === 'level':
                idx = this.levelFilterOptions.indexOf(this.levelFilter)
                newIdx = (idx - 1 + this.levelFilterOptions.length) % this.levelFilterOptions.length
                this.setLevelFilter(this.levelFilterOptions[newIdx])
            否则:
                idx = this.categoryFilterOptions.indexOf(this.categoryFilter)
                newIdx = (idx - 1 + this.categoryFilterOptions.length) % this.categoryFilterOptions.length
                this.setCategoryFilter(this.categoryFilterOptions[newIdx])
        })
        screen.key(['right'], () => {
            如果 this.filterMode === 'level':
                idx = this.levelFilterOptions.indexOf(this.levelFilter)
                newIdx = (idx + 1) % this.levelFilterOptions.length
                this.setLevelFilter(this.levelFilterOptions[newIdx])
            否则:
                idx = this.categoryFilterOptions.indexOf(this.categoryFilter)
                newIdx = (idx + 1) % this.categoryFilterOptions.length
                this.setCategoryFilter(this.categoryFilterOptions[newIdx])
        })
        screen.key(['tab'], () => {
            idx = this.filterModes.indexOf(this.filterMode)
            this.filterMode = this.filterModes[(idx + 1) % this.filterModes.length]
            this._updateLogLabel()
        })
        this._bindScrollKeys()
        screen.render()
        this._startTrimTimer()

    方法 绑定滚动键():
        screen.key(['up'], () => {
            logBox.scroll(-1)
            this._scheduleRender()
        })
        screen.key(['down'], () => {
            logBox.scroll(1)
            this._scheduleRender()
        })
        screen.key(['pageup'], () => {
            logBox.scroll(-(logBox.height - 2))
            this._scheduleRender()
        })
        screen.key(['pagedown'], () => {
            logBox.scroll(logBox.height - 2)
            this._scheduleRender()
        })
        screen.key(['home'], () => {
            logBox.scrollTo(0)
            this._scheduleRender()
        })
        screen.key(['end'], () => {
            logBox.scrollTo(logBox.getScrollHeight())
            this._scheduleRender()
        })

    方法 设置标题(协议, IP, 端口):
        如果 !this.enabled: 返回
        this.headerBox.setContent(
            ` Web MediaCenter Server - ${协议}://${IP}:${端口} `
        )
        this.screen.render()

    方法 更新系统状态(状态数据):
        如果 !this.enabled: 返回
        内容 = [
            ` 运行时间: ${格式化运行时间(状态数据.运行时间)}`,
            ` 内存 RSS: ${状态数据.内存RSS}`,
            ` 内存 Heap: ${状态数据.内存HeapUsed}/${状态数据.内存HeapTotal}`,
            ` 协议: ${状态数据.协议}`,
            ` 静音: ${状态数据.静音 ? '是 🔇' : '否 🔊'}`,
            ` 显示端: ${状态数据.显示端数量}`,
            ` 控制端: ${状态数据.控制端数量}`
        ]
        如果 this.systemStats 存在:
            cpu = this.systemStats.cpu || {}
            mem = this.systemStats.memory || {}
            cpuUsage = parseFloat(cpu.usage || 0)
            memUsage = parseFloat(mem.usagePercent || 0)
            cpuColor = cpuUsage > 80 ? 'red' : cpuUsage > 50 ? 'yellow' : 'green'
            memColor = memUsage > 80 ? 'red' : memUsage > 50 ? 'yellow' : 'green'
            内容.push('')
            内容.push('── 系统监控 ──')
            内容.push(` CPU: ${cpuUsage}% (${cpu.count || '-'}核)`)
            内容.push(` 内存: ${memUsage}% (${格式化内存(mem.used)}/${格式化内存(mem.total)})`)
            内容.push(` 系统运行: ${格式化运行时间(this.systemStats.uptime?.system || 0)}`)
            内容.push(` 负载: ${cpu.loadAvg?.['1m']} ${cpu.loadAvg?.['5m']} ${cpu.loadAvg?.['15m']}`)
        this.statusBox.setContent(内容.join('\n'))
        this.screen.render()

    方法 更新系统监控数据(监控数据):
        如果 !this.enabled: 返回
        this.systemStats = 监控数据

    方法 更新设备列表(设备数组):
        如果 !this.enabled: 返回
        表头 = ' ID         IP              类型       能力'
        行数据 = 设备数组.map(设备 => [
            按显示宽度填充(设备.id || '-', 10),
            按显示宽度填充(设备.ip || '-', 15),
            按显示宽度填充(设备.类型, 10),
            格式化能力(设备.能力)
        ].join(' '))
        this.deviceTable.setContent([表头, ...行数据].join('\n'))
        this._scheduleRender()

    方法 添加日志(类别, 消息):
        如果 !this.enabled: 返回
        时间戳 = 获取当前时间字符串()
        颜色 = 获取类别颜色(类别)
        标签 = `[${类别}]`
        级别 = LEVEL_MAP[类别] || 'info'
        this.logBuffer.push({ 时间戳, 类别, 消息, 级别, 颜色, 标签 })
        如果 this.logBuffer.length > this.maxLogBuffer:
            this.logBuffer.splice(0, this.logBuffer.length - this.maxLogBuffer)
        如果 类别 不在 this.knownCategories 中:
            this.knownCategories.add(类别)
            this.categoryFilterOptions = ['全部', ...Array.from(this.knownCategories).sort()]
            this.categoryFilterLabels = { all: '全部' }
            遍历 this.categoryFilterOptions:
                如果 c !== 'all': this.categoryFilterLabels[c] = c
        如果 this._matchesFilter(级别, 类别):
            this.logBox.log(`{${颜色}-fg}${时间戳} ${标签}{/${颜色}-fg} ${消息}`)
            this._scheduleRender()
        this._logCount++
        如果 this._logCount % 200 === 0:
            this._trimLogBox()

    方法 _matchesFilter(级别, 类别):
        如果 this.levelFilter !== 'all' 且 this.levelFilter !== 级别: 返回 false
        如果 this.categoryFilter !== 'all' 且 this.categoryFilter !== 类别: 返回 false
        返回 true

    方法 setLevelFilter(筛选级别):
        如果 !this.enabled: 返回
        如果 筛选级别 不在 this.levelFilterOptions 中: 返回
        this.levelFilter = 筛选级别
        this._reapplyFilter()

    方法 setCategoryFilter(筛选类别):
        如果 !this.enabled: 返回
        如果 筛选类别 不在 this.categoryFilterOptions 中: 返回
        this.categoryFilter = 筛选类别
        this._reapplyFilter()

    方法 _reapplyFilter():
        this.logBox.setContent('')
        最近缓冲 = this.logBuffer.slice(-this.maxLogLines)
        筛选后日志 = 最近缓冲.filter(条目 => this._matchesFilter(条目.级别, 条目.类别))
        遍历 筛选后日志:
            this.logBox.log(`{${条目.颜色}-fg}${条目.时间戳} ${条目.标签}{/${条目.颜色}-fg} ${条目.消息}`)
        this._updateLogLabel()
        this._scheduleRender()

    方法 _updateLogLabel():
        维度标签 = this.filterMode === 'level' ? '级别' : '类别'
        如果 this.filterMode === 'level':
            值标签 = this.levelFilterLabels[this.levelFilter] || '全部'
        否则:
            值标签 = this.categoryFilterLabels[this.categoryFilter] || '全部'
        this.logBox.setLabel(` 事件日志 [${维度标签}:${值标签}] `)
        this._scheduleRender()

    方法 启动定时刷新(获取状态回调, 获取设备回调):
        如果 !this.enabled: 返回
        this.refreshTimer = setInterval(() => {
            this.更新系统状态(获取状态回调())
            this.更新设备列表(获取设备回调())
        }, 2000)

    方法 _trimLogBox():
        如果 !this.enabled 或 !this.logBox: 返回
        行数 = this.logBox._clines ? this.logBox._clines.length : 0
        阈值 = Math.floor(this.maxLogLines * 1.5)
        如果 行数 <= 阈值: 返回
        this.logBox.setContent('')
        最近缓冲 = this.logBuffer.slice(-this.maxLogLines)
        遍历 最近缓冲:
            如果 this._matchesFilter(条目.级别, 条目.类别):
                this.logBox.log(`{${条目.颜色}-fg}${条目.时间戳} ${条目.标签}{/${条目.颜色}-fg} ${条目.消息}`)
        this._scheduleRender()

    方法 _startTrimTimer():
        this._trimTimer = setInterval(() => {
            this._trimLogBox()
        }, 60000)

    方法 销毁():
        如果 !this.enabled: 返回
        如果 this.refreshTimer: clearInterval(this.refreshTimer)
        如果 this._trimTimer: clearInterval(this._trimTimer)
        this.screen.destroy()
        this.logBuffer = []
        this.systemStats = null
        this.headerBox = null
        this.statusBox = null
        this.deviceTable = null
        this.logBox = null
        this.screen = null
```

### 日志类别颜色映射

```
函数 获取类别颜色(类别):
    映射 = {
        '连接': 'green',
        '断开': 'red',
        '语音': 'cyan',
        'TTS': 'yellow',
        '提醒': 'magenta',
        '设备': 'blue',
        '能力': 'blue',
        '错误': 'red',
        '系统': 'white',
        '静音': 'yellow',
        '子显示端': 'blue',
        'AASC': 'green'
    }
    返回 映射[类别] || 'white'
```

### 格式化辅助函数

```
函数 计算显示宽度(字符串):
    宽度 = 0
    遍历字符串中每个字符:
        如果字符是CJK/全角/Emoji字符:
            宽度 += 2
        否则:
            宽度 += 1
    返回 宽度

函数 按显示宽度填充(字符串, 目标宽度):
    当前宽度 = 计算显示宽度(字符串)
    填充空格数 = Math.max(0, 目标宽度 - 当前宽度)
    返回 字符串 + ' '.repeat(填充空格数)

函数 格式化运行时间(秒数):
    天 = Math.floor(秒数 / 86400)
    时 = Math.floor((秒数 % 86400) / 3600)
    分 = Math.floor((秒数 % 3600) / 60)
    秒 = 秒数 % 60
    部分 = []
    如果 天 > 0: 部分.push(`${天}d`)
    如果 时 > 0: 部分.push(`${时}h`)
    如果 分 > 0: 部分.push(`${分}m`)
    部分.push(`${秒}s`)
    返回 部分.join(' ')

函数 格式化能力(能力对象):
    标签 = []
    如果 能力对象.mediaRendering: 标签.push('媒体')
    如果 能力对象.voicePlayback: 标签.push('播放')
    如果 能力对象.voiceRecording: 标签.push('录音')
    如果 能力对象.voiceRecognition: 标签.push('识别')
    如果 能力对象.displayText: 标签.push('文字')
    返回 标签.join(',') || '-'
```

## 子显示端 TUI - SubDisplayTUI

### 伪代码

```
类 SubDisplayTUI:
    属性:
        screen: blessed.Screen 实例
        headerBox: 标题栏组件
        connectionBox: 连接状态组件
        recordingBox: 录音状态组件
        monitorBox: 系统监控组件
        logBox: 事件日志组件
        maxLogLines: 最大日志行数 = 300
        enabled: 是否启用TUI
        logBuffer: 日志缓冲区 = []
        maxLogBuffer: 最大缓冲区大小 = 1000
        _logCount: 日志计数器 = 0
        _trimTimer: 定时清理定时器 = null
        systemStats: 系统监控数据 = null

    构造函数(选项):
        如果 选项.enabled === false:
            this.enabled = false
            返回
        this.enabled = true
        this.maxLogLines = 选项.maxLogLines || 300
        this.logBuffer = []
        this.maxLogBuffer = 1000
        this._logCount = 0
        this._trimTimer = null
        this.systemStats = null
        this.初始化界面(选项.displayId)

    方法 初始化界面(displayId):
        this.screen = blessed.screen({
            smartCSR: true,
            title: `Voice Display - ${displayId}`,
            fullUnicode: true
        })

        this.headerBox = blessed.box({
            顶部: 0, 左边: 0, 宽度: '100%', 高度: 1,
            样式: { bg: 'green', fg: 'black', bold: true },
            内容: ` Voice Display Node - ${displayId} `
        })

        this.connectionBox = blessed.box({
            顶部: 1, 左边: 0, 宽度: '34%', 高度: '35%',
            标签: ' 连接状态 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'cyan' } }
        })

        this.recordingBox = blessed.box({
            顶部: 1, 左边: '34%', 宽度: '33%', 高度: '35%',
            标签: ' 录音状态 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'magenta' } }
        })

        this.monitorBox = blessed.box({
            顶部: 1, 左边: '67%', 宽度: '33%', 高度: '35%',
            标签: ' 系统监控 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'yellow' } }
        })

        this.logBox = blessed.log({
            顶部: '35%+1', 左边: 0, 宽度: '100%', 高度: '65%-2',
            标签: ' 事件日志 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'yellow' } },
            滚动: true,
            可聚焦: true,
            缓冲区长度: this.maxLogLines
        })

        screen.append(headerBox)
        screen.append(connectionBox)
        screen.append(recordingBox)
        screen.append(monitorBox)
        screen.append(logBox)

        logBox.focus()

        screen.key(['q', 'C-c'], () => process.exit(0))
        this._bindScrollKeys()
        screen.render()
        this._startTrimTimer()

    方法 绑定滚动键():
        screen.key(['up'], () => {
            logBox.scroll(-1)
            this._scheduleRender()
        })
        screen.key(['down'], () => {
            logBox.scroll(1)
            this._scheduleRender()
        })
        screen.key(['pageup'], () => {
            logBox.scroll(-(logBox.height - 2))
            this._scheduleRender()
        })
        screen.key(['pagedown'], () => {
            logBox.scroll(logBox.height - 2)
            this._scheduleRender()
        })
        screen.key(['home'], () => {
            logBox.scrollTo(0)
            this._scheduleRender()
        })
        screen.key(['end'], () => {
            logBox.scrollTo(logBox.getScrollHeight())
            this._scheduleRender()
        })

    方法 更新连接状态(状态):
        如果 !this.enabled: 返回
        连接图标 = 状态.已连接 ? '✅' : '❌'
        内容 = [
            ` 服务器: ${状态.已连接 ? '已连接' : '未连接'} ${连接图标}`,
            ` 地址: ${状态.服务器地址 || '—'}`,
            ` 显示端ID: ${状态.显示端ID || '—'}`,
            ` 心跳: ${状态.心跳状态 || '—'}`,
            ` 重连: ${状态.重连次数}/${状态.最大重连次数}`
        ]
        this.connectionBox.setContent(内容.join('\n'))
        this.screen.render()

    方法 更新录音状态(状态):
        如果 !this.enabled: 返回
        录音图标 = 状态.录音开启 ? '✅' : '⏸'
        ASR图标 = 状态.ASR就绪 ? '✅' : '❌'
        内容 = [
            ` 录音: ${状态.录音开启 ? '开启' : '暂停'} ${录音图标}`,
            ` ASR: ${状态.ASR就绪 ? '就绪' : '不可用'} ${ASR图标}`,
            ` VAD: ${状态.VAD状态 || '—'}`,
            ` 播放队列: ${状态.播放队列长度 || 0}`,
            ` 最近识别: ${状态.最近识别结果 || '—'}`
        ]
        this.recordingBox.setContent(内容.join('\n'))
        this.screen.render()

    方法 更新系统监控数据(监控数据):
        如果 !this.enabled: 返回
        this.systemStats = 监控数据
        cpu = 监控数据.cpu || {}
        mem = 监控数据.memory || {}
        uptime = 监控数据.uptime || {}
        cpuUsage = parseFloat(cpu.usage || 0)
        memUsage = parseFloat(mem.usagePercent || 0)
        cpuColor = cpuUsage > 80 ? 'red' : cpuUsage > 50 ? 'yellow' : 'green'
        memColor = memUsage > 80 ? 'red' : memUsage > 50 ? 'yellow' : 'green'
        内容 = [
            ` CPU: ${cpuUsage}% (颜色=${cpuColor})`,
            ` 核心: ${cpu.count || '—'}`,
            ` 负载: ${(cpu.loadAvg?.['1m'] || 0).toFixed(2)}`,
            ` 内存: ${memUsage}% (颜色=${memColor})`,
            ` 已用: ${格式化内存(mem.used)}/${格式化内存(mem.total)}`,
            ` 进程RSS: ${格式化内存(mem.process?.rss || 0)}`,
            ` 堆内存: ${格式化内存(mem.process?.heapUsed || 0)}/${格式化内存(mem.process?.heapTotal || 0)}`,
            ` 系统运行: ${格式化运行时间(uptime.system || 0)}`,
            ` 进程运行: ${格式化运行时间(uptime.process || 0)}`
        ]
        this.monitorBox.setContent(内容.join('\n'))
        this._scheduleRender()

    方法 添加日志(类别, 消息):
        如果 !this.enabled: 返回
        时间戳 = 获取当前时间字符串()
        颜色 = 获取类别颜色(类别)
        标签 = `[${类别}]`
        this.logBuffer.push({ 时间戳, 类别, 消息, 颜色, 标签 })
        如果 this.logBuffer.length > this.maxLogBuffer:
            this.logBuffer.splice(0, this.logBuffer.length - this.maxLogBuffer)
        this.logBox.log(`{${颜色}-fg}${时间戳} ${标签}{/${颜色}-fg} ${消息}`)
        this._scheduleRender()
        this._logCount++
        如果 this._logCount % 200 === 0:
            this._trimLogBox()

    方法 _trimLogBox():
        如果 !this.enabled 或 !this.logBox: 返回
        行数 = this.logBox._clines ? this.logBox._clines.length : 0
        阈值 = Math.floor(this.maxLogLines * 1.5)
        如果 行数 <= 阈值: 返回
        this.logBox.setContent('')
        最近缓冲 = this.logBuffer.slice(-this.maxLogLines)
        遍历 最近缓冲:
            this.logBox.log(`{${条目.颜色}-fg}${条目.时间戳} ${条目.标签}{/${条目.颜色}-fg} ${条目.消息}`)
        this._scheduleRender()

    方法 _startTrimTimer():
        this._trimTimer = setInterval(() => {
            this._trimLogBox()
        }, 60000)

    方法 销毁():
        如果 !this.enabled: 返回
        如果 this._trimTimer: clearInterval(this._trimTimer)
        this.screen.destroy()
        this.logBuffer = []
        this.systemStats = null
        this.headerBox = null
        this.connectionBox = null
        this.recordingBox = null
        this.monitorBox = null
        this.logBox = null
        this.screen = null
```

## 集成方式

### 服务端集成 (server-app.js)

```
在 server-app.js 顶部 require 块末尾追加:
    const ServerTUI = require('../../../framework/observability/server-tui')
    const { installConsoleRedirect } = require('../../../framework/observability/console-redirect')
    const useTUI = !process.argv.includes('--no-tui')
    const tui = new ServerTUI({ enabled: useTUI })

改造 log(category, message, extra):
    entry = logBuffer.add(category, message, extra)  // 始终写入缓冲区
    logBrain.ingest(entry)  // 始终输入分析引擎
    如果 useTUI:
        tui.addLog(category, message)
    否则:
        console.log(`${timestamp} [${category}] ${message}`)

改造 logError(category, message, extra):
    entry = logBuffer.add(category, message, extra)
    logBrain.ingest(entry)
    如果 useTUI:
        tui.addLog(category, message)
    否则:
        console.error(`${timestamp} [${category}] ${message}`)

在 log/logError 定义后追加 TUI 模式下重定向 console.*:
    installConsoleRedirect({
        enabled: useTUI,
        writeLog: (level, message) => {
            category = (level === 'error') ? '错误' : '系统'
            tui.addLog(category, message)
        }
    })

在 server.listen 回调内、log 输出之后:
    tui.setHeader(protocol, localIP, PORT)

在 WS 系统初始化成功后、systemMonitor.start 之后:
    tui.startRefresh(
        () => ({
            uptime: Math.floor((Date.now() - serverStartTime) / 1000),
            memoryRSS: process.memoryUsage().rss,
            memoryHeapUsed: process.memoryUsage().heapUsed,
            memoryHeapTotal: process.memoryUsage().heapTotal,
            protocol: useHttps ? 'https' : 'http',
            isMuted: muteState.isMuted,
            displayCount: displayClients.size,
            controlCount: controlClients.size
        }),
        () => getDisplayList()
    )

在现有的 systemMonitor.onStats 回调中追加:
    systemMonitor.onStats((stats) => {
        tui.updateSystemStats(stats)  // 新增行
        if (controlClients.size > 0) {
            broadcastToControls({ type: 'systemStats', stats })
        }
    })

日志筛选键盘操作:
    Tab: 切换筛选维度（级别 ↔ 类别）
    ← 方向键: 在当前维度中切换到上一个选项
    → 方向键: 在当前维度中切换到下一个选项
    级别筛选: 全部 → 错误 → 警告 → 信息 → 调试 → 全部（循环）
    类别筛选: 全部 → AASC → Chat → Commands → TTS → ... → 全部（循环，动态收集）
    级别和类别筛选同时生效（AND 逻辑）
    当前筛选维度和值显示在日志面板标签中，如 "事件日志 [级别:错误]" 或 "事件日志 [类别:语音]"
```

### 子显示端集成 (voice-display-node/main.js)

```
在 main.js 顶部:
    const SubDisplayTUI = require('./tui')
    const useTUI = !process.argv.includes('--no-tui')
    const tui = new SubDisplayTUI({ enabled: useTUI })

    function log(category, message):
        如果 useTUI:
            tui.addLog(category, message)
        否则:
            console.log(`${timestamp} [${category}] ${message}`)

    function logError(category, message):
        如果 useTUI:
            tui.addLog(category, message)
            return  // TUI 模式下禁止直接写 stdout/stderr
        console.error(`[${category}] ${message}`)

    // TUI 模式下重定向 console.*，避免第三方库/遗留代码破坏 blessed 渲染
    installConsoleRedirect({
        enabled: useTUI,
        writeLog: (level, message) => {
            category = (level === 'error') ? '错误' : '系统'
            tui.addLog(category, message)
        }
    })

在 VoiceDisplay 类中:
    属性 lastRecognition = ''

    方法 updateTUIConnectionState():
        如果 !useTUI: 返回
        tui.updateConnectionState({
            connected, serverUrl, displayId,
            heartbeatStatus, reconnectAttempts, maxReconnectAttempts
        })

    方法 updateTUIRecordingState():
        如果 !useTUI: 返回
        tui.updateRecordingState({
            recordingEnabled, asrReady, vadStatus,
            playQueueSize, lastRecognition
        })

替换所有 console.log 为 log():
    连接成功 → log('连接', '已连接到服务器')
    语音识别 → log('语音', `识别结果: ${text}`)
    TTS播放 → log('TTS', `播报: ${text}`)
    提醒 → log('提醒', `${content}`)
    错误 → logError('错误', `${message}`)

更新状态面板:
    连接/断开时 → this.updateTUIConnectionState()
    录音开关/识别结果 → this.updateTUIRecordingState()

在 main() 函数中配置加载后:
    如果 useTUI:
        tui.displayId = config.displayId
        tui.headerBox.setContent(`Voice Display Node - ${config.displayId}`)

        systemMonitor = new SystemMonitor({ intervalMs: 5000 })
        systemMonitor.onStats((stats) => {
            tui.updateSystemStats(stats)
        })
        systemMonitor.start()
        tui.updateSystemStats(systemMonitor.getStats())

    退出信号处理:
        如果 systemMonitor: systemMonitor.stop()
        voiceDisplay.stop()
        tui.updateConnectionState({ 初始状态 })
```
