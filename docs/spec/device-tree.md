# 树状结构设备列表实现文档

## 概述

将控制端显示端列表从平铺列表改为树状结构，支持展开/收起、设备设置编辑、连线/掉线自定义指令。

## 后端实现

### 配置管理 (core/config.js)

#### 新增 deviceEvents 配置

```
class Config defaults 添加:
  deviceEvents: {}

getDeviceEvents():
  返回 get('deviceEvents', {})

getDeviceEvent(ip):
  events = getDeviceEvents()
  返回 events[ip] 或 events['default'] 或 { onConnect: '', onDisconnect: '' }

setDeviceEvent(ip, eventConfig):
  events = getDeviceEvents()
  events[ip] = {
    onConnect: eventConfig.onConnect !== undefined ? eventConfig.onConnect : '',
    onDisconnect: eventConfig.onDisconnect !== undefined ? eventConfig.onDisconnect : ''
  }
  set('deviceEvents', events)
  返回 events[ip]

removeDeviceEvent(ip):
  events = getDeviceEvents()
  删除 events[ip]
  set('deviceEvents', events)
  返回 true

module.exports 导出:
  getDeviceEvents, getDeviceEvent, setDeviceEvent, removeDeviceEvent
```

### API 端点 (server.js)

#### GET /api/device-events

```
返回:
  { status: 'success', events: config.getDeviceEvents() }
```

#### PUT /api/device-events/:ip

```
请求体: { onConnect: string, onDisconnect: string }
验证: ip 参数存在
调用 config.setDeviceEvent(ip, { onConnect, onDisconnect })
返回: { status: 'success', event: 更新后的配置, message: '设备事件配置已更新' }
错误: { status: 'error', message: '配置更新失败: ...' }
```

#### DELETE /api/device-events/:ip

```
调用 config.removeDeviceEvent(ip)
返回: { status: 'success', message: '设备事件配置已删除' }
```

#### GET /api/device-settings/:displayId

```
从 displayClients 获取指定 displayId 的 displayData
如果设备在线:
  返回 { status: 'success', settings: displayData.state, online: true }
如果设备不在线:
  遍历 config.getAllDisplayStates() 查找 displayId 对应的 IP
  如果找到:
    返回 { status: 'success', settings: config.getDisplayState(savedIp), online: false }
  否则:
    返回 404 { status: 'error', message: '设备不存在' }
```

#### PUT /api/device-settings/:displayId

```
请求体: { rotation, fit, volume, crop 等部分状态 }
从 displayClients 获取 displayData
如果设备在线:
  遍历请求体中的 key-value 对
  如果 key 在 validActions (rotation, fit, volume, crop, isPlaying) 中:
    更新 displayData.state[key] = value
    调用 config.updateDisplayState(displayData.ip, { [key]: value })
    发送控制指令到显示端: sendToDisplay(displayId, { type: 'control', action: key, value })
  返回 { status: 'success', settings: displayData.state, online: true }
如果设备不在线:
  返回 404 { status: 'error', message: '设备不在线，无法修改设置' }
```

### 连线/掉线指令执行 (server.js)

#### handleChatMessage(options)

```
共享函数，处理聊天消息流，用于 chatMessage、voiceCommand、executeDeviceEvent

参数:
  content: 消息内容
  displayContent: 显示内容（可选，默认使用 content）
  displayId: 显示端ID
  displayIds: 多显示端ID列表（可选）
  playOnControl: 是否在控制端播放（可选）
  systemPrompt: 自定义系统提示词（可选）
  templateTarget: 模板目标名称（可选）
  mode: 会话模式，默认 'group'
  target: 私聊目标（可选）
  sendToControl: 回调函数，发送消息给控制端

处理逻辑:
  chat.addMessage({ role: 'control', content })
  
  如果有 templateTarget: 使用模板的 systemPrompt
  否则如果有 systemPrompt: 使用自定义 systemPrompt
  
  await chat.chatStream(content, { displayId, systemPrompt, includeHistory }, {
    onChunk: sendToControl({ type: 'chatChunk', chunk, message })
    onSentence:
      如果 playOnControl: sendToControl({ type: 'playOnControl', audioUrl, text })
      否则如果 displayIds: 遍历 sendToDisplay(tid, { type: 'tts', ... })
      否则: sendToDisplay(displayId, { type: 'tts', ... })
    onComplete: chat.addMessage({ role: 'assistant' }), sendToControl({ type: 'chatResponse', ... })
    onError: sendToControl({ type: 'chatResponse', success: false, error })
  })
```

#### executeDeviceEvent(ip, eventType, displayId)

```
async function executeDeviceEvent(ip, eventType, displayId):
  try:
    eventConfig = config.getDeviceEvent(ip)
    command = eventConfig[eventType]
    
    如果 command 为空:
      defaultConfig = config.getDeviceEvent('default')
      command = defaultConfig[eventType]
    
    如果 command 为空:
      return
    
    打印日志: `[设备事件] ${ip} ${eventType}: ${command}`
    
    sendToControl = (msg) => broadcastToControls(msg)
    
    result = await voiceCommand.processVoiceCommand(command, displayId, null)
    
    如果 result 为空: return
    
    如果 result.type === 'showHelp':
      sendToControl({ type: 'showHelp' })
    如果 result.type === 'commands':
      await voiceCommand.executeCommands(result.actions, displayId, {
        onChat: async (message) =>
          await handleChatMessage({ content: message, displayId, sendToControl })
      })
    如果 result.type === 'chat':
      await handleChatMessage({ content: result.message, displayId, systemPrompt: result.systemPrompt, sendToControl })
    
    broadcastToControls({
      type: 'deviceEventExecuted',
      ip: ip,
      eventType: eventType,
      command: command,
      result: result,
      timestamp: Date.now()
    })
  catch err:
    console.error(`[设备事件] 执行失败 ${ip} ${eventType}:`, err.message)
```

#### 在显示端连接时调用

```
// 显示端 WebSocket 连接处理中
broadcastToControls({ type: 'displayList', list: getDisplayList() })
executeDeviceEvent(clientIP, 'onConnect', displayId)
```

#### 在显示端断开时调用

```
ws.on('close', () => {
  const disconnectedIP = clientIP
  displayClients.delete(displayId)
  ...
  broadcastToControls({ type: 'displayList', list: getDisplayList() })
  executeDeviceEvent(disconnectedIP, 'onDisconnect', displayId)
})
```

## 前端实现

### DeviceTree 模块 (public/js/device-tree.js)

#### 数据结构

```
DeviceTree = {
  displayList: [],          // 显示端列表
  deviceEvents: {},         // 设备事件配置缓存
  expandedNodes: Set,       // 已展开的节点ID集合，默认包含 'server'
  selectedNodeId: null,     // 当前选中的节点ID
  serverInfo: { ip: '', port: 8081 }  // 服务器信息
}
```

#### init()

```
调用 loadDeviceEvents() 加载设备事件配置
```

#### setServerInfo(ip, port)

```
更新 serverInfo
```

#### loadDeviceEvents()

```
async fetch GET /api/device-events
如果成功: this.deviceEvents = data.events || {}
```

#### saveDeviceEvent(ip, onConnect, onDisconnect)

```
async fetch PUT /api/device-events/${encodeURIComponent(ip)}
  body: { onConnect, onDisconnect }
如果成功:
  this.deviceEvents[ip] = data.event
  显示 toast '事件指令已保存'
```

#### buildTree()

```
构建 serverNode:
  id: 'server'
  label: `${serverInfo.ip}:${serverInfo.port}`
  icon: '📡'
  expanded: expandedNodes.has('server')
  children: []

遍历 displayList:
  获取 eventConfig = deviceEvents[display.ip] || { onConnect: '', onDisconnect: '' }
  isSelected = window.currentDisplayId === display.id

  构建 displayNode:
    id: display.id
    label: display.ip || 'unknown'
    icon: display.isSubDisplay ? '🎤' : '🖥️'
    status: 'online'
    selected: isSelected
    expanded: expandedNodes.has(display.id)
    children: [
      settings 节点 (画面设置),
      events 节点 (事件指令),
      info 节点 (浏览器信息)
    ]

  serverNode.children.push(displayNode)

返回 serverNode
```

#### buildSettingsChildren(display)

```
返回:
  [
    { id: `${display.id}-rotation`, label: '旋转', type: 'setting-item',
      settingKey: 'rotation', value: display.rotation || 0,
      editable: true, inputType: 'select',
      options: [{ value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }] },
    { id: `${display.id}-fit`, label: '填充', type: 'setting-item',
      settingKey: 'fit', value: display.fit || 'contain',
      editable: true, inputType: 'select',
      options: [{ value: 'contain', label: '适应' }, { value: 'height', label: '高度铺满' }, { value: 'width', label: '宽度铺满' }, { value: 'crop', label: '裁剪' }] },
    { id: `${display.id}-volume`, label: '音量', type: 'setting-item',
      settingKey: 'volume', value: display.volume !== undefined ? display.volume : 100,
      editable: true, inputType: 'range', min: 0, max: 100 },
    { id: `${display.id}-canvasSize`, label: '画布', type: 'setting-item',
      settingKey: 'canvasSize', value: `${display.canvasSize?.width || 1920}x${display.canvasSize?.height || 1080}`,
      editable: false }
  ]
```

#### buildEventsChildren(display, eventConfig)

```
返回:
  [
    { id: `${display.id}-onConnect`, label: '连线指令', type: 'event-item',
      eventKey: 'onConnect', value: eventConfig.onConnect || '',
      editable: true, inputType: 'text', placeholder: '设备连接时执行的指令' },
    { id: `${display.id}-onDisconnect`, label: '掉线指令', type: 'event-item',
      eventKey: 'onDisconnect', value: eventConfig.onDisconnect || '',
      editable: true, inputType: 'text', placeholder: '设备断开时执行的指令' }
  ]
```

#### buildInfoChildren(display)

```
如果 display.browserInfo 存在:
  返回 [
    { id: `${display.id}-browser`, label: `${browserName} ${browserVersion} | ${os}`, type: 'info-item' },
    { id: `${display.id}-screen`, label: `${screenWidth}x${screenHeight}${devicePixelRatio > 1 ? ` @ ${devicePixelRatio}x` : ''}`, type: 'info-item' }
  ]
否则:
  返回 [{ id: `${display.id}-noInfo`, label: '暂无信息', type: 'info-item' }]
```

#### render()

```
调用 renderToContainer('deviceTree')
调用 renderToContainer('mediaDeviceTree')
```

#### renderToContainer(containerId)

```
获取容器元素
清空容器
如果 displayList 为空:
  显示 "暂无显示端连接"
否则:
  添加选择模式栏 renderSelectionBar()
  构建树 buildTree()
  渲染根节点 renderNode(tree, 0)
```

#### renderSelectionBar()

```
如果 DisplayList 不存在: 返回 null
创建 bar div.tree-selection-bar
遍历选择模式 (single/all/adaptive):
  创建 button.tree-selection-btn
  如果是当前模式: 添加 active class
  点击事件: 切换 DisplayList.selectionMode, 重新渲染
返回 bar
```

#### renderNode(node, depth)

```
创建 wrapper div.tree-node-wrapper
创建 nodeEl div.tree-node
  如果 node.selected 或 node.id === selectedNodeId: 添加 'selected' class
  设置 paddingLeft = depth * 16 + 8

如果有 children:
  创建展开/收起箭头 span.tree-toggle
    文本: expanded ? '▼' : '▶'
  点击事件: toggleNode(node.id)
否则:
  创建 spacer span.tree-toggle-spacer

如果 node.icon: 创建 span.tree-icon
创建 span.tree-label: node.label

如果 type === 'setting-item': 渲染 renderSettingControl(node)
如果 type === 'event-item': 渲染 renderEventControl(node)
如果 status === 'online': 创建 span.tree-status.online
如果 type === 'info-item': 添加 'tree-info-item' class
如果 displayData 且 type === undefined: 添加点击事件 selectDisplay(node.id)

如果 expanded 且有 children:
  创建 div.tree-children
  递归渲染 children, depth + 1

返回 wrapper
```

#### renderSettingControl(node)

```
如果 inputType === 'select':
  创建 select.tree-setting-select
  遍历 options 创建 option 元素
  change 事件: updateSetting(displayId, settingKey, value)
  click 事件: stopPropagation

如果 inputType === 'range':
  创建 rangeWrap div.tree-setting-range-wrap
  创建 input[type=range].tree-setting-range
  创建 valueLabel span.tree-setting-range-value
  input 事件: 更新 valueLabel 文本
  change 事件: updateSetting(displayId, settingKey, value)
  click 事件: stopPropagation

返回 container
```

#### renderEventControl(node)

```
创建 container div.tree-event-control
创建 input[type=text].tree-event-input
  value: node.value
  placeholder: node.placeholder
  click/change 事件: stopPropagation

创建 button.tree-event-save
  文本: '保存'
  点击事件:
    获取 displayId (从 node.id 解析)
    获取 display 的 IP
    获取当前事件配置
    更新对应 eventKey 的值
    调用 saveDeviceEvent(ip, onConnect, onDisconnect)

返回 container
```

#### toggleNode(nodeId)

```
如果 expandedNodes 包含 nodeId: 删除
否则: 添加
调用 render() 重新渲染
```

#### selectDisplay(displayId)

```
设置 selectedNodeId = displayId
设置 window.currentDisplayId = displayId
调用 DisplayList.select(displayId) 保持兼容
调用 render() 重新渲染
```

#### updateSetting(displayId, key, value)

```
通过 WebSocket 发送控制指令:
  { type: 'control', displayId, action: key, value }
更新本地 displayList 中对应 display 的值
显示 toast 提示
```

#### setDisplayList(list)

```
更新 displayList = list || []
调用 render()
```

### WebSocket 消息处理扩展 (public/js/websocket.js)

```
onopen 中:
  如果 DeviceTree 存在:
    设置服务器信息 DeviceTree.setServerInfo(hostname, port)

handleMessage 中新增:
  if data.type === 'displayList':
    如果 DeviceTree 存在:
      DeviceTree.setDisplayList(data.list)
  
  if data.type === 'deviceEventExecuted':
    eventLabel = data.eventType === 'onConnect' ? '连线' : '掉线'
    显示 toast: `设备 ${data.ip} ${eventLabel}指令已执行: ${data.command}`
```

### HTML 变更 (public/upload.html)

```
在 panel-media 中:
  替换 <div class="display-list" id="mediaDisplayList"> 为
  <div class="device-tree" id="mediaDeviceTree">

在 panel-display 中:
  替换 <div class="display-list" id="displayList"> 为
  <div class="device-tree" id="deviceTree">

添加 script 引用:
  <script src="js/device-tree.js"></script>
```

### CSS 样式 (public/css/upload.css)

```
.device-tree:
  background: rgba(0,0,0,0.2), border-radius: 8px, padding: 8px
  max-height: 400px, overflow-y: auto

.tree-node:
  display: flex, align-items: center, padding: 5px 8px
  cursor: pointer, border-radius: 4px, transition: background 0.2s
  gap: 4px, min-height: 28px

.tree-node:hover: background: rgba(255,255,255,0.05)
.tree-node.selected: background: rgba(0,210,255,0.15)

.tree-toggle: width: 16px, font-size: 10px, color: rgba(255,255,255,0.5)
.tree-toggle-spacer: width: 16px
.tree-icon: font-size: 14px
.tree-label: font-size: 13px, color: rgba(255,255,255,0.85)

.tree-status: width: 8px, height: 8px, border-radius: 50%, margin-left: auto
.tree-status.online: background: #2ecc71, box-shadow: 0 0 4px rgba(46,204,113,0.5)

.tree-info-item: opacity: 0.7, cursor: default
.tree-info-item .tree-label: font-size: 11px, color: rgba(255,255,255,0.5)

.tree-children: margin-left: 0

.tree-setting-control: margin-left: auto
.tree-setting-select: padding: 2px 6px, font-size: 11px, background: rgba(255,255,255,0.1)
.tree-setting-range: width: 80px, height: 4px
.tree-setting-range-value: font-size: 11px, min-width: 30px

.tree-event-control: display: flex, align-items: center, gap: 6px, margin-left: auto
.tree-event-input: width: 120px, padding: 3px 8px, font-size: 11px
.tree-event-save: padding: 2px 8px, font-size: 11px, background: rgba(0,210,255,0.3)

.tree-selection-bar: display: flex, gap: 4px, margin-bottom: 8px, padding: 4px
.tree-selection-btn: flex: 1, font-size: 12px
.tree-selection-btn.active: background: linear-gradient(135deg, #667eea, #764ba2)
```

## 相关文件

| 文件 | 说明 |
|------|------|
| core/config.js | 配置管理添加 deviceEvents（修改） |
| server.js | API 端点和连线/掉线指令执行（修改） |
| public/js/device-tree.js | 树状设备列表前端组件（新增） |
| public/js/websocket.js | WebSocket 消息处理扩展（修改） |
| public/js/main.js | 初始化 DeviceTree（修改） |
| public/upload.html | 页面结构替换（修改） |
| public/css/upload.css | 树状列表样式（修改） |
| config/config.json | 设备事件配置存储（自动生成） |
| docs/design/device-tree.md | 设计文档 |
