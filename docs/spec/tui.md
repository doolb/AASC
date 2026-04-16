# TUI 界面实现文档

## 概述

使用 blessed 库为服务端和子显示端实现 TUI 界面，替代 console.log 输出。

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

    构造函数(选项):
        如果 选项.enabled === false:
            this.enabled = false
            返回
        this.enabled = true
        this.maxLogLines = 选项.maxLogLines || 500
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
            顶部: 1, 左边: 0, 宽度: '30%', 高度: '40%',
            标签: ' 系统状态 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'cyan' } },
            滚动: true
        })

        this.deviceTable = blessed.table({
            顶部: 1, 左边: '30%', 宽度: '70%', 高度: '40%',
            标签: ' 设备列表 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'green' } },
            表头: ['ID', 'IP', '类型', '能力'],
            数据: []
        })

        this.logBox = blessed.log({
            顶部: '40%+1', 左边: 0, 宽度: '100%', 高度: '60%-2',
            标签: ' 事件日志 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'yellow' } },
            滚动: true,
            缓冲区长度: this.maxLogLines
        })

        screen.append(headerBox)
        screen.append(statusBox)
        screen.append(deviceTable)
        screen.append(logBox)

        screen.key(['q', 'C-c'], () => process.exit(0))
        screen.render()

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
        this.statusBox.setContent(内容.join('\n'))
        this.screen.render()

    方法 更新设备列表(设备数组):
        如果 !this.enabled: 返回
        行数据 = 设备数组.map(设备 => [
            设备.id,
            设备.ip,
            设备.类型,
            格式化能力(设备.能力)
        ])
        this.deviceTable.setData({
            表头: ['ID', 'IP', '类型', '能力'],
            数据: 行数据
        })
        this.screen.render()

    方法 添加日志(类别, 消息):
        如果 !this.enabled: 返回
        时间戳 = 获取当前时间字符串()
        颜色 = 获取类别颜色(类别)
        标签 = `[${类别}]`
        this.logBox.log(`{${颜色}-fg}${时间戳} ${标签}{/${颜色}-fg} ${消息}`)
        this.screen.render()

    方法 启动定时刷新(获取状态回调, 获取设备回调):
        如果 !this.enabled: 返回
        this.refreshTimer = setInterval(() => {
            this.更新系统状态(获取状态回调())
            this.更新设备列表(获取设备回调())
        }, 2000)

    方法 销毁():
        如果 !this.enabled: 返回
        如果 this.refreshTimer: clearInterval(this.refreshTimer)
        this.screen.destroy()
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
    图标 = []
    如果 能力对象.mediaRendering: 图标.push('🖥')
    如果 能力对象.voicePlayback: 图标.push('🔊')
    如果 能力对象.voiceRecording: 图标.push('🎙')
    如果 能力对象.voiceRecognition: 图标.push('🧠')
    如果 能力对象.displayText: 图标.push('📝')
    返回 图标.join('') || '—'
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
        logBox: 事件日志组件
        maxLogLines: 最大日志行数 = 300
        enabled: 是否启用TUI

    构造函数(选项):
        如果 选项.enabled === false:
            this.enabled = false
            返回
        this.enabled = true
        this.maxLogLines = 选项.maxLogLines || 300
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
            顶部: 1, 左边: 0, 宽度: '50%', 高度: '40%',
            标签: ' 连接状态 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'cyan' } }
        })

        this.recordingBox = blessed.box({
            顶部: 1, 左边: '50%', 宽度: '50%', 高度: '40%',
            标签: ' 录音状态 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'magenta' } }
        })

        this.logBox = blessed.log({
            顶部: '40%+1', 左边: 0, 宽度: '100%', 高度: '60%-2',
            标签: ' 事件日志 ',
            边框: { type: 'line' },
            样式: { border: { fg: 'yellow' } },
            滚动: true,
            缓冲区长度: this.maxLogLines
        })

        screen.append(headerBox)
        screen.append(connectionBox)
        screen.append(recordingBox)
        screen.append(logBox)

        screen.key(['q', 'C-c'], () => process.exit(0))
        screen.render()

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

    方法 添加日志(类别, 消息):
        如果 !this.enabled: 返回
        时间戳 = 获取当前时间字符串()
        颜色 = 获取类别颜色(类别)
        标签 = `[${类别}]`
        this.logBox.log(`{${颜色}-fg}${时间戳} ${标签}{/${颜色}-fg} ${消息}`)
        this.screen.render()

    方法 销毁():
        如果 !this.enabled: 返回
        this.screen.destroy()
```

## 集成方式

### 服务端集成 (server.js)

```
在 server.js 顶部:
    const ServerTUI = require('./core/tui')
    const useTUI = !process.argv.includes('--no-tui')
    const tui = new ServerTUI({ enabled: useTUI })

    function log(category, message):
        如果 useTUI:
            tui.addLog(category, message)
        否则:
            console.log(`${timestamp} [${category}] ${message}`)

    function logError(category, message):
        如果 useTUI:
            tui.addLog(category, message)
        console.error(`[${category}] ${message}`)

替换所有 console.log 为 log():
    显示端连接 → log('连接', `显示端 ${id} (${ip}) 已连接`)
    显示端断开 → log('断开', `显示端 ${id} 已断开`)
    语音输入 → log('语音', `识别结果: ${text}`)
    TTS播报 → log('TTS', `播报: ${text}`)
    提醒触发 → log('提醒', `触发: ${content}`)
    设备事件 → log('设备', `${ip} ${eventType}: ${command}`)
    错误 → logError('错误', `${message}`)

启动定时刷新:
    tui.startRefresh(
        () => ({ 运行时间, 内存, 协议, 静音, 显示端数, 控制端数 }),
        () => getDisplayList()
    )
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
        console.error(`[${category}] ${message}`)

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
        tui.updateConnectionState({ 初始状态 })
```
