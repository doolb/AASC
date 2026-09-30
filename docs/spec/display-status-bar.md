# 显示端状态栏独立开关实现文档

## 状态与消息

```text
默认显示端状态:
    showStatusBar = true

控制端设备卡片:
    设备树和列表行不渲染状态栏复选框

VAD 面板:
    读取当前选中的 displayId
    在当前显示端 VAD 卡片中渲染“显示状态栏”复选框
    缺少 showStatusBar 时将复选框视为选中
    change 时沿用 setDisplayStatusBarConfig

用户修改复选框:
    send({
        type: 'setDisplayStatusBarConfig',
        displayId,
        showStatusBar
    })
```

## 服务端伪代码

```text
显示端连接(displayId):
    savedState = config.getDisplayStateById(displayId)
    showStatusBar = normalize(savedState.showStatusBar, 默认值=true)
    将 showStatusBar 合并到运行状态
    sendToDisplay(displayId, {
        type: 'displayStatusBarConfig',
        displayId,
        showStatusBar
    })
    displayList 中包含 displayId 与 showStatusBar

收到 setDisplayStatusBarConfig:
    根据 data.displayId 查找在线目标显示端
    若目标不存在:
        返回带 displayId 和当前权威值的配置错误
        结束
    若 data.showStatusBar 不是布尔值:
        返回带 displayId 和当前权威值的配置错误
        结束
    showStatusBar = data.showStatusBar
    更新目标运行状态
    config.updateDisplayStateById(displayId, legacyIp, { showStatusBar })
    向目标显示端发送 displayStatusBarConfig(displayId, showStatusBar)
    向所有控制端广播 displayStatusBarConfigChanged(displayId, showStatusBar)
    广播 displayList
```

## 显示端伪代码

```text
showStatusBar = true

收到 displayStatusBarConfig:
    若消息 displayId 与当前显示端一致且 showStatusBar 为布尔值:
        showStatusBar = 消息 showStatusBar
        若 showStatusBar:
            移除状态栏隐藏标记
        否则:
            添加状态栏隐藏标记

状态栏隐藏标记仅作用于:
    connectionStatus
    voiceStatusRow（语音状态、摄像头状态、音频监视器、会话倒计时）

始终显示:
    timeDisplay
    fileNameDisplay
    voiceTextDisplay
    taskStatusDisplay
```

控制端收到权威配置变化时，按 `displayId` 更新对应复选框。配置错误时按返回的权威值恢复复选框。

## 兼容性与边界

- `showStatusBar` 缺失或不是布尔值时，读取端使用 `true`。
- 新增 WebSocket 消息必须带 `type`；服务端只接受布尔值并向客户端回传持久化后的权威值。
- 离线目标不接受实时控制；显示端下次连接时从按 `displayId` 保存的状态恢复。
- 时间和媒体文件名不受状态栏开关影响。
- 不增加配置 HTTP 读写接口。控制端主导航按方向响应式布局：竖屏位于底部，横屏位于左侧。
