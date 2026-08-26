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
| 90度 | 向右 | 整体 rotate(90deg)，汉字字形随画面顺时针旋转 |
| 180度 | 向上 | 水平，翻转180度 |
| 270度 | 向左 | 整体 rotate(270deg)，汉字字形随画面逆时针旋转 |

### 播报文本字号与旋转

`voiceTextDisplay` 同时承载 TTS 播报文本、语音识别结果和语音模型状态提示，必须复用显示端旋转状态：

- 0°：水平，从左到右；
- 90°：整体 `rotate(90deg)`，汉字字形随显示器顺时针旋转；
- 180°：水平并 `rotate(180deg)`；
- 270°：整体 `rotate(270deg)`，汉字字形随显示器逆时针旋转；
- 基础字号从 24px 增加 50% 到 36px；移动端从 18px 增加 50% 到 27px。
- 媒体名 `fileNameDisplay` 使用桌面端 48px、移动端 32px，旋转时仍按实际包围盒重新适配位置。
- 旋转时同步调整长文本最大宽度，避免放大字号后覆盖整个显示区；不使用 `text-orientation: mixed`，避免汉字保持正立而未随画面旋转。
- 播报文本淡入动画只改变透明度，不写入 `transform`，避免覆盖旋转分支设置的方向变换。

### 旋转后逻辑画布布局

90°/270°不能继续直接使用未旋转视口的物理宽高定位文本元素。显示端先生成旋转后的逻辑画布尺寸，再使用该尺寸计算文本的最大可用区域和边距：

- 0°/180°：`layoutWidth = viewportWidth`，`layoutHeight = viewportHeight`；
- 90°/270°：`layoutWidth = viewportHeight`，`layoutHeight = viewportWidth`；
- 文本元素的位置基于旋转后的逻辑画布重新映射到物理四角；
- 90°/270°的文本可用宽度不超过 `layoutWidth - 2 * margin`，可用高度不超过 `layoutHeight - 2 * margin`；
- 旋转变换和逻辑画布位置必须同时更新，不能只设置 `transform` 而保留旧的物理边缘坐标。
- 设置约束后读取每个可见文本元素的 `getBoundingClientRect()`；按照当前固定定位的 `left/right/top/bottom` 锚点，将旋转后的实际包围盒对应边缘对齐到物理视口边距，避免只满足“不越界”却向屏幕内部偏移。
- 连接状态、媒体名或播报文本异步更新后由 `MutationObserver` 触发下一帧重算；窗口 resize 同样重新执行旋转布局。
- 固定文本的 CSS transition 不包含尺寸、位置和 transform，避免布局校正期间产生越界中间态。

## 伪代码

```
函数 applyRotation():
    // 1. 旋转媒体元素
    mediaImage.transform = rotate(currentRotation deg)
    mediaVideo.transform = rotate(currentRotation deg)

    viewportWidth = 读取视口宽度
    viewportHeight = 读取视口高度
    如果 currentRotation === 90 或 270:
        layoutWidth = viewportHeight
        layoutHeight = viewportWidth
    否则:
        layoutWidth = viewportWidth
        layoutHeight = viewportHeight
    设置所有旋转文本元素的逻辑可用宽度和高度约束

    // 2. 重置所有UI元素样式
    对于每个 uiElement 在 [connectionStatus, timeDisplay, fileNameDisplay, voiceStatus, voiceTextDisplay, monitorWrapper]:
        重置 transform, transformOrigin, left, top, right, bottom, maxWidth, writingMode, textOrientation

    // 3. 根据旋转角度设置UI位置和整体文字旋转
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
        // 重力向右，固定文本整体顺时针旋转90°，汉字字形不单独保持正立
        // 连接状态 - 0度左上 → 90度右上
        connectionStatus: top=20px, right=20px, transform=rotate(90deg)
        // 时间 - 0度右上 → 90度右下
        timeDisplay: bottom=20px, right=20px, transform=rotate(90deg)
        // 文件名 - 0度左下 → 90度左上
        fileNameDisplay: top=20px, left=20px, transform=rotate(90deg)
        // 音频可视化 - 0度右下 → 90度左下
        monitorWrapper: bottom=20px, left=20px
        // 语音状态 - 0度右下 → 90度左下
        voiceStatus: bottom=80px, left=20px, transform=rotate(90deg)
        voiceTextDisplay: bottom=140px, left=20px, transform=rotate(90deg)

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
        voiceStatus: top=80px, left=20px, transform=rotate(180deg)
        voiceTextDisplay: top=140px, left=20px, transform=rotate(180deg)

    否则如果 currentRotation === 270:
        // 重力向左，固定文本整体逆时针旋转90°，汉字字形随画面旋转
        // 连接状态 - 0度左上 → 270度左下
        connectionStatus: bottom=20px, left=20px, transform=rotate(270deg)
        // 时间 - 0度右上 → 270度左上
        timeDisplay: top=20px, left=20px, transform=rotate(270deg)
        // 文件名 - 0度左下 → 270度右下
        fileNameDisplay: bottom=20px, right=20px, transform=rotate(270deg)
        // 音频可视化 - 0度右下 → 270度右上
        monitorWrapper: top=20px, right=20px
        // 语音状态 - 0度右下 → 270度右上
        voiceStatus: top=80px, right=20px, transform=rotate(270deg)
        voiceTextDisplay: top=140px, right=20px, transform=rotate(270deg)

    // 4. 以实际变换后的包围盒对齐固定定位锚点
    对于每个可见旋转文本元素:
        rect = element.getBoundingClientRect()
        如果 element 使用 left:
            沿 x 轴移动 margin - rect.left
        如果 element 使用 right:
            沿 x 轴移动 viewportWidth - margin - rect.right
        如果 element 使用 top:
            沿 y 轴移动 margin - rect.top
        如果 element 使用 bottom:
            沿 y 轴移动 viewportHeight - margin - rect.bottom

    // 5. 内容或视口变化后重新适配
    监听文本元素的 MutationObserver，在下一帧重新执行包围盒校正
    监听 window.resize，重新执行 applyRotation()
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
