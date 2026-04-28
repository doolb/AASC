# 设备列表组件实现文档

## 概述

设备列表组件（DeviceList）是合并了原 DisplayList 和 DeviceTree 的统一组件，支持列表视图和树形视图两种显示模式，提供设备管理、选择模式、设备设置等功能。

## 数据结构

```javascript
const DeviceList = {
    list: [],                    // 显示端列表
    selectionMode: 'single',     // 选择模式：single/all/adaptive
    viewMode: 'tree',            // 视图模式：tree/list
    deviceEvents: {},            // 设备事件配置缓存
    expandedNodes: Set,          // 已展开的节点ID集合
    selectedNodeId: null,        // 当前选中的节点ID
    serverInfo: { ip: '', port: 8081 }  // 服务器信息
}
```

## 核心方法

### 数据管理

#### getDisplays()
```
返回 this.list 或空数组
```

#### getSelectedDisplayIds(mediaRatio)
```
根据选择模式返回目标显示端 ID 列表
switch selectionMode:
    case 'single': 返回 [window.currentDisplayId] 或 []
    case 'all': 返回 this.list 所有 id
    case 'adaptive': 返回 getAdaptiveDisplayIds(mediaRatio)
```

#### getAdaptiveDisplayIds(mediaRatio)
```
根据媒体比例匹配显示端方向
isLandscapeMedia = mediaRatio > 1
isPortraitMedia = mediaRatio < 1
遍历 list:
    isLandscapeDisplay = isDisplayLandscape(display)
    如果是横向媒体: 返回横向显示端
    如果是纵向媒体: 返回纵向显示端
    否则: 返回所有显示端
```

#### isDisplayLandscape(display)
```
获取显示端有效方向（考虑旋转角度）
{ width, height } = display.canvasSize 或默认 1920x1080
rotation = display.rotation 或 0
isLandscape = width >= height
如果 rotation 是 90 或 270: isLandscape = !isLandscape
返回 isLandscape
```

### 选择模式

#### setSelectionMode(mode)
```
验证 mode 是否为 single/all/adaptive 之一
更新 this.selectionMode
调用 render()
如果是 single 模式且无选中设备: 自动选择第一个
```

#### select(id)
```
设置 selectedNodeId 和 window.currentDisplayId
调用 render()
更新 FloatingControl
更新 displayCanvasSize
发送 getState WebSocket 消息
```

### 视图切换

#### setViewMode(mode)
```
验证 mode 是否为 tree/list 之一
更新 this.viewMode
持久化到 localStorage('deviceListViewMode')
调用 render()
```

#### toggleViewMode()
```
在 tree 和 list 之间切换
```

#### toggleNode(nodeId)
```
切换展开/折叠状态
持久化 expandedNodes 到 localStorage('deviceListExpandedNodes')
调用 render()
```

### 渲染方法

#### render()
```
调用 renderToContainer('deviceList')
调用 renderToContainer('mediaDeviceList')
更新 FloatingControl
如果是 single 模式且无选中设备: 自动选择第一个
```

#### renderToContainer(containerId)
```
获取容器元素
如果 list 为空: 显示 "暂无显示端连接"
否则:
    添加 renderHeaderBar() (选择模式按钮 + 视图切换按钮)
    如果 viewMode === 'tree':
        渲染树形视图
    否则:
        渲染列表视图
```

#### renderHeaderBar()
```
创建 header div.device-list-header
创建选择模式按钮栏 (单选/全选/自适应)
创建视图切换按钮 (📋/🌳)
返回 header
```

#### renderListView()
```
遍历 list 渲染每个显示端项:
    根据 selectionMode 决定 isActive 状态
    显示浏览器信息
    显示语音状态
    显示方向指示器
    显示子显示端标识
    显示能力图标
    显示详情按钮和能力设置按钮
返回 HTML 字符串
```

### 树形视图方法

#### buildTree()
```
构建 serverNode:
    id: 'server'
    label: `${serverInfo.ip}:${serverInfo.port}`
    icon: '📡'
    children: []

遍历 displayList:
    获取 eventConfig
    构建 displayNode:
        children: [settings, events, info, capabilities]
    添加到 serverNode.children

返回 serverNode
```

#### buildSettingsChildren(display)
```
返回设置子节点:
    - rotation (旋转角度选择)
    - fit (填充模式选择)
    - volume (音量滑块)
    - canvasSize (画布尺寸，只读)
```

#### buildEventsChildren(display, eventConfig)
```
返回事件子节点:
    - onConnect (连线指令输入)
    - onDisconnect (掉线指令输入)
```

#### buildInfoChildren(display)
```
返回信息子节点:
    - 浏览器信息
    - 屏幕分辨率
```

#### buildCapabilitiesChildren(display)
```
返回能力子节点:
    - mediaRendering (媒体渲染)
    - voicePlayback (语音播放)
    - voiceRecording (语音录音)
    - voiceRecognition (语音识别)
    - displayText (文本显示)
```

#### renderNode(node, depth)
```
创建 wrapper div.tree-node-wrapper
创建 nodeEl div.tree-node
    设置 selected 状态
    设置 paddingLeft
    添加展开/折叠箭头
    添加图标和标签
    根据节点类型渲染控件:
        - setting-item: renderSettingControl()
        - event-item: renderEventControl()
        - capability-item: renderCapabilityControl()
    添加在线状态指示器
    添加点击事件

如果有 children 且 expanded:
    递归渲染子节点

返回 wrapper
```

### 控件渲染

#### renderSettingControl(node)
```
如果 inputType === 'select':
    创建下拉选择框
    绑定 change 事件调用 updateSetting()
如果 inputType === 'range':
    创建滑块和数值显示
    绑定 change 事件调用 updateSetting()
返回 container
```

#### renderEventControl(node)
```
创建文本输入框
创建保存按钮
点击保存时调用 saveDeviceEvent()
返回 container
```

#### renderCapabilityControl(node)
```
创建启用/禁用下拉选择框
绑定 change 事件调用 updateCapability()
返回 container
```

### 更新方法

#### updateSetting(displayId, key, value)
```
发送 WebSocket 控制指令
更新本地 displayList 数据
显示 toast 提示
```

#### updateCapability(nodeId, key, value)
```
解析 displayId
获取当前能力配置
更新指定能力
发送 WebSocket 更新请求
显示 toast 提示
```

### 弹窗方法

#### showFeatureModal(displayId)
```
获取显示端数据
填充浏览器详情
填充功能支持列表
显示弹窗
```

#### showCapabilityEditor(displayId)
```
创建能力设置弹窗
显示各项能力复选框
保存时发送 WebSocket 更新
```

### 初始化

#### init()
```
从 localStorage 恢复 viewMode 和 expandedNodes（页面刷新后保持）
调用 loadDeviceEvents()
绑定 featureModal 点击关闭事件
```

#### setServerInfo(ip, port)
```
更新 serverInfo
```

#### loadDeviceEvents()
```
async fetch GET /api/device-events
如果成功: this.deviceEvents = data.events
```

#### saveDeviceEvent(ip, onConnect, onDisconnect)
```
async fetch PUT /api/device-events/${ip}
更新本地缓存
显示 toast
```

#### setDisplayList(list)
```
更新 this.list
调用 render()
```

## 兼容性

组件同时设置以下全局变量以保持向后兼容：
- `window.DisplayList`
- `window.DeviceList`
- `window.DeviceTree`

## 相关文件

| 文件 | 说明 |
|------|------|
| public/js/device-list.js | 设备列表组件（合并后） |
| public/upload.html | 页面结构 |
| public/css/upload.css | 样式 |
| public/js/websocket.js | WebSocket 消息处理 |
| public/js/main.js | 初始化 |
| docs/spec/display-selection.md | 选择模式文档 |
