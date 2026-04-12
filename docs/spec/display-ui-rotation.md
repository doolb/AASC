# 显示端UI旋转功能实现文档

## 功能概述

显示端UI元素在画面旋转后，根据新的重力方向调整垂直方向和位置，保持在以0度为基准的画面四角。

## UI四角布局（0度基准）

| 位置 | UI元素 | 说明 |
|------|--------|------|
| 左上 | connectionStatus | 连接状态 |
| 右上 | timeDisplay | 时间显示 |
| 左下 | fileNameDisplay | 文件名 |
| 右下 | monitor-wrapper + voiceStatus | 音频可视化 + 语音状态 |

## 旋转后位置映射

旋转后，UI元素保持在0度基准的物理位置（即物理屏幕的同一个角），但CSS定位需要根据旋转角度重新计算。

### 位置映射表

| 0度基准位置 | 0度CSS | 90度CSS | 180度CSS | 270度CSS |
|------------|--------|---------|----------|----------|
| 左上(连接状态) | top+left | top+right | bottom+right | bottom+left |
| 右上(时间) | top+right | bottom+right | bottom+left | top+left |
| 左下(文件名) | bottom+left | top+left | top+right | bottom+right |
| 右下(音频/语音) | bottom+right | bottom+left | top+left | top+right |

## 重力方向与文字方向

旋转后，重力方向改变，文字的垂直方向需要根据新重力方向调整：

| 旋转角度 | 重力方向(相对0度) | 文字方向 |
|----------|-------------------|----------|
| 0度 | 向下 | 水平，从左到右 |
| 90度 | 向右 | 竖向，从上到下（writingMode: vertical-rl） |
| 180度 | 向上 | 水平，翻转180度 |
| 270度 | 向左 | 竖向，从下到上（writingMode: vertical-rl + rotate(180deg)） |

## 伪代码

```
函数 applyRotation():
    // 1. 旋转媒体元素
    mediaImage.transform = rotate(currentRotation deg)
    mediaVideo.transform = rotate(currentRotation deg)

    // 2. 重置所有UI元素样式
    对于每个 uiElement 在 [connectionStatus, timeDisplay, fileNameDisplay, voiceStatus, voiceTextDisplay, monitorWrapper]:
        重置 transform, transformOrigin, left, top, right, bottom, maxWidth, writingMode, textOrientation

    // 3. 根据旋转角度设置UI位置和文字方向
    如果 currentRotation === 0:
        // 连接状态 - 左上
        connectionStatus: top=20px, left=20px
        // 时间 - 右上
        timeDisplay: top=20px, right=20px
        // 文件名 - 左下
        fileNameDisplay: bottom=20px, left=20px
        // 音频可视化 - 右下
        monitorWrapper: bottom=20px, right=20px
        // 语音状态 - 右下（在音频可视化上方）
        voiceStatus: bottom=80px, right=20px
        voiceTextDisplay: bottom=140px, right=20px

    否则如果 currentRotation === 90:
        // 重力向右，文字竖向从上到下（writingMode: vertical-rl，字符顶部朝左=物理上方）
        // 连接状态 - 0度左上 → 90度右上
        connectionStatus: top=20px, right=20px, writingMode=vertical-rl
        // 时间 - 0度右上 → 90度右下
        timeDisplay: bottom=20px, right=20px, writingMode=vertical-rl
        // 文件名 - 0度左下 → 90度左上
        fileNameDisplay: top=20px, left=20px, writingMode=vertical-rl
        // 音频可视化 - 0度右下 → 90度左下
        monitorWrapper: bottom=20px, left=20px
        // 语音状态 - 0度右下 → 90度左下
        voiceStatus: bottom=80px, left=20px
        voiceTextDisplay: bottom=140px, left=20px, maxWidth=50vh

    否则如果 currentRotation === 180:
        // 重力向上，文字翻转180度
        // 连接状态 - 0度左上 → 180度右下
        connectionStatus: bottom=20px, right=20px, transform=rotate(180deg)
        // 时间 - 0度右上 → 180度左下
        timeDisplay: bottom=20px, left=20px, transform=rotate(180deg)
        // 文件名 - 0度左下 → 180度右上
        fileNameDisplay: top=20px, right=20px, transform=rotate(180deg)
        // 音频可视化 - 0度右下 → 180度左上
        monitorWrapper: top=20px, left=20px
        // 语音状态 - 0度右下 → 180度左上
        voiceStatus: top=80px, left=20px
        voiceTextDisplay: top=140px, left=20px

    否则如果 currentRotation === 270:
        // 重力向左，文字竖向从下到上（writingMode: vertical-rl + rotate(180deg)，字符顶部朝右=物理上方）
        // 连接状态 - 0度左上 → 270度左下
        connectionStatus: bottom=20px, left=20px, writingMode=vertical-rl, transform=rotate(180deg)
        // 时间 - 0度右上 → 270度左上
        timeDisplay: top=20px, left=20px, writingMode=vertical-rl, transform=rotate(180deg)
        // 文件名 - 0度左下 → 270度右下
        fileNameDisplay: bottom=20px, right=20px, writingMode=vertical-rl, transform=rotate(180deg)
        // 音频可视化 - 0度右下 → 270度右上
        monitorWrapper: top=20px, right=20px
        // 语音状态 - 0度右下 → 270度右上
        voiceStatus: top=80px, right=20px
        voiceTextDisplay: top=140px, right=20px, maxWidth=50vh
```

## 设备连线指令TTS防抖

### 问题

设备连线时触发 `executeDeviceEvent(ip, 'onConnect', displayId)`，如果组合指令（如"早上好"）包含多个生成TTS的子指令，会导致多次TTS播放。另外，如果显示端频繁重连，也会重复触发连线指令。

### 解决方案

在 `executeDeviceEvent` 中添加防抖机制：

```
// 防抖映射表：ip + eventType → 上次执行时间
const deviceEventDebounce = new Map()
const DEVICE_EVENT_DEBOUNCE_MS = 30000  // 30秒内同一IP同一事件不重复执行

异步函数 executeDeviceEvent(ip, eventType, displayId):
    // 防抖检查
    debounceKey = ip + '_' + eventType
    lastTime = deviceEventDebounce.get(debounceKey) 或 0
    如果 Date.now() - lastTime < DEVICE_EVENT_DEBOUNCE_MS:
        console.log('[设备事件] 防抖跳过:', ip, eventType)
        返回

    deviceEventDebounce.set(debounceKey, Date.now())

    // 原有逻辑...
    eventConfig = config.getDeviceEvent(ip)
    command = eventConfig[eventType]
    如果 !command:
        defaultConfig = config.getDeviceEvent('default')
        command = defaultConfig[eventType]
    如果 !command: 返回

    // ... 执行指令
```

## 相关文件

| 文件 | 说明 |
|------|------|
| public/display.html | 显示端页面，applyRotation 函数 |
| public/css/display.css | 显示端样式，UI元素定位 |
| server.js | executeDeviceEvent 函数，设备事件防抖 |
