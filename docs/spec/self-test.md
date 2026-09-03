# 自测功能实现文档

## 概述

自测功能用于验证系统各模块是否正常工作，包括基础功能测试、播放控制测试、画面控制测试等。

## 数据结构

### 测试结果

```javascript
{
    testResults: {
        passed: number,     // 通过数量
        failed: number,     // 失败数量
        skipped: number,    // 跳过数量
        total: number       // 总数量
    },
    results: [{
        id: string,         // 测试ID
        name: string,       // 测试名称
        category: string,   // 测试分类
        description: string,// 测试描述
        success: boolean,   // 是否成功
        message: string,    // 结果消息
        details: string,    // 详细信息
        timestamp: string   // 时间戳
    }],
    lastRun: string         // 最后运行时间 (ISO格式)
}
```

### 待确认消息

```javascript
{
    pendingAcks: Map<string, {
        resolve: Function,      // Promise resolve 函数
        timer: number,          // 超时定时器ID
        commandType: string,    // 命令类型
        displayId: string       // 显示端ID
    }>,
    ackTimeout: 5000            // 超时时间 (毫秒)
}
```

## 核心函数

### waitForAck(commandType, displayId, timeout)

等待显示端确认命令：

```
waitForAck(commandType, displayId, timeout):
    返回 Promise:
        生成 key = displayId_commandType
        设置超时定时器:
            超时后:
                从 pendingAcks 删除 key
                resolve({ success: false, message: '等待确认超时', details: ... })
        
        将 { resolve, timer, commandType, displayId } 存入 pendingAcks
```

### handleAck(data)

处理显示端确认消息：

```
handleAck(data):
    生成 key = data.displayId_data.commandType
    从 pendingAcks 获取 pending
    
    如果 pending 存在:
        清除超时定时器
        从 pendingAcks 删除 key
        resolve({
            success: data.success,
            message: data.success ? '显示端已确认' : '显示端处理失败',
            details: ...
        })
```

## 测试用例

### 基础功能测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| display_connection | 显示端连接测试 | 检查是否有显示端连接 | DisplayList.getDisplays().length > 0 |
| websocket_connection | WebSocket连接测试 | 检查WebSocket连接状态 | ws.readyState === WebSocket.OPEN |

### 播放控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| play_command | 播放命令测试 | 测试播放命令发送并等待显示端确认 | 发送 play 命令，等待 commandAck |
| pause_command | 暂停命令测试 | 测试暂停命令发送并等待显示端确认 | 发送 pause 命令，等待 commandAck |
| volume_control | 音量控制测试 | 测试音量调节 | 发送 volume 命令 |

### 画面控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| fit_mode_contain | 画面填充-适应测试 | 测试适应模式 | 发送 fit: contain |
| fit_mode_height | 画面填充-高度铺满测试 | 测试高度铺满模式 | 发送 fit: height |
| fit_mode_width | 画面填充-宽度铺满测试 | 测试宽度铺满模式 | 发送 fit: width |
| fit_mode_crop | 画面填充-裁剪测试 | 测试裁剪模式 | 发送 fit: crop |
| rotation_0 | 旋转-0度测试 | 测试0度旋转 | 发送 rotation: 0 |
| rotation_90 | 旋转-90度测试 | 测试90度旋转 | 发送 rotation: 90 |

## 命令确认流程

### 显示端发送确认

**public/display.html**:

```
function sendCommandAck(commandType, success, details):
    如果 WebSocket 已连接:
        发送 {
            type: 'commandAck',
            commandType: commandType,
            success: success,
            details: details || '',
            timestamp: Date.now()
        }

消息处理:
    如果 type === 'control':
        handleControl(data)
        sendCommandAck('control', true, data.action)
    
    如果 type === 'tts':
        handleTTS(data)
        sendCommandAck('tts', true, data.action)
    
    如果 type === 'media':
        showMedia(data)
        sendCommandAck('media', true, data.type)
    
    如果 type === 'voiceCommand':
        handleVoiceCommand(data)
        sendCommandAck('voiceCommand', true, data.action)
    
    如果 type === 'reminder':
        handleReminder(data)
        sendCommandAck('reminder', true, data.action)
    
    如果 type === 'restoreState':
        handleRestoreState(data.state)
        sendCommandAck('restoreState', true, 'state restored')
```

### 服务端转发确认

**server.js**:

```
显示端消息处理:
    如果 type === 'commandAck':
        广播到控制端 {
            type: 'commandAck',
            displayId: displayId,
            commandType: data.commandType,
            success: data.success,
            details: data.details,
            timestamp: data.timestamp
        }
```

### 控制端接收确认

**public/js/websocket.js**:

```
handleMessage(data):
    ...
    如果 type === 'commandAck':
        如果 window.SelfTest 存在:
            调用 SelfTest.handleAck(data)
```

## 测试运行流程

```
runAllTests():
    设置 isRunning = true
    重置结果
    
    显示进度界面
    
    遍历所有测试:
        更新进度显示
        执行测试 run()
        记录结果
        更新统计
        
    保存结果到 localStorage
    显示结果界面
    导出 JSON 文件
    
    设置 isRunning = false
```

### 源码契约回归测试同步（2026-09-03）

```
runSourceContractRegressionTests():
    检查 Android ASR 测试 APK 的路由变量按查询字符串拆分
    检查 ASR 网页通过带查询参数的 /api/asr 路由提交音频

    检查正式显示 APK 不复制 GTCRN 资源
    检查 DenoiseModelManager 使用 speech-enhancement 清单和模型下载路由
    检查服务器提供 GTCRN 清单与文件白名单路由

    检查网页 TTS 使用 recoverTtsPlayback 恢复自身 audio 元素
    检查聊天删除单轮按后端选择对应的 runtimeManager 重置会话
    检查 repairMode.password 为字符串且 repairMode.role 为 mainfront
    检查搜索频道按 pi 或 codex Agent 会话设置 ephemeral
    检查语音指令帮助文本传入当前命令集和 topic

    保留 display-native-bridge.test.js 的 DeX 原生触摸/滚轮旧契约失败
    直到明确 DeX 多屏输入桥接的后续处理方案
```

上述契约测试只验证源码中对外可观察的稳定行为和路由，不绑定已经重命名或抽取的内部局部变量。

## 结果存储

测试结果保存在两个地方：

1. **localStorage**: `selfTestResults` 键
2. **JSON 文件**: 自动下载 `self-test-results-{timestamp}.json`

## 消息类型

### commandAck 消息

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 'commandAck' |
| displayId | string | 显示端ID |
| commandType | string | 命令类型 (control/tts/media/voiceCommand/reminder/restoreState) |
| success | boolean | 是否成功 |
| details | string | 详细信息 |
| timestamp | number | 时间戳 |
