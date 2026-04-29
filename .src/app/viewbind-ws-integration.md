#skill: ai-code-translation

# ViewBind WS 应用集成 - 替换 AASC 消息系统

## 模块
app

## 目标文件清单

- `src/apps/server/boot/server-app.js` // 6 个 aascSystem 调用点替换 + handler 注册
- `src/framework/aasc/init.js` // 替换，不再需要

## 范围约束

- 只替换 AASC 编排层，不动业务服务代码
- 不动 server-app.js 中 WS 连接创建与路径分发逻辑（/display /control 判断）
- 不动 server-app.js 中显示端初始消息发送（serverStartTime, displayId, configUpdate 等）
- 不动控制端/显示端前端代码
- 不动 runtimeBridge 逻辑（line 1860-1913）

## 已有声明

### server-app.js 真实结构（关键行号）

- `const { initializeAASCSystem }` // line 20
- `let aascSystem = null` // line 152
- `displayClients = new Map()` // line 144
- `controlClients = new Set()` // line 145
- `function createDisplayState()` // line 336
- `function getDisplayList()` // line 1652
- `function broadcastDisplayList()` // line 1707，带 setImmediate 防抖
- `function broadcastToControls(data)` // line 1698
- `function sendToDisplay(displayId, data)` // line 1749

### 6 个 aascSystem 调用点

| 行号 | 代码 | 说明 |
|------|------|------|
| 264 | `aascSystem = await initializeAASCSystem({...})` | 初始化，传入 voiceCommand, chat, tts, reminder, timeAnnounce, config 等 |
| 1944 | `aascSystem.handleDisplayConnect(displayId, clientIP, ws, savedState)` | 显示端连接 |
| 2006 | `aascSystem.handleDisplayMessage(displayId, data, ws)` | 显示端消息 |
| 2024 | `aascSystem.handleDisplayDisconnect(displayId)` | 显示端断连 |
| 2033 | `aascSystem.handleControlConnect(ws)` | 控制端连接 |
| 2077 | `aascSystem.handleControlMessage(data, ws)` | 控制端消息 |
| 2093 | `aascSystem.handleControlDisconnect(ws)` | 控制端断连 |

### 现有 fallback 函数（直接使用，不需 Actor 路由）

`handleDisplayMessageFallback` (line 2104-2163) 处理的消息类型：
- heartbeat, canvasSize, browserInfo, voiceInput, voiceStatus, capabilities, commandAck

`handleControlMessageFallback` (line 2165-2649) 处理的消息类型：
- voiceCommand, confirmVoiceCommand, getSearchHistory, clearSearchHistory, deleteSearchHistory
- getAssistantConfig, setAssistantConfig, timeAnnounce, getReminders
- chatHistory, clearChatHistory, getChatSession, setChatSession
- getChatCommands, setChatCommands
- mute, unmute, todayReminders

### 业务服务真实路径

- `src/external/tts/tts-service.js`
- `src/external/llm/llm-service.js`
- `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js`
- `src/apps/web-mediacenter/modules/reminder/reminder-app-service.js`
- `src/apps/web-mediacenter/modules/time/time-announce-app-service.js`
- `src/apps/web-mediacenter/modules/time/time-listener-app-service.js`
- `src/apps/web-mediacenter/modules/media/media-library-app-service.js`

## 新增定义

无  // 不新增独立文件，只在 server-app.js 中注册 handler

## 操作流程

### 替换路径说明

关键发现：`handleDisplayMessageFallback` 和 `handleControlMessageFallback` 已经包含不依赖 AASC 的完整业务逻辑。
AASC Actor 的 `AgentActorAdapter.actionMap` 中的 action 路由与 fallback 中的 if-else 分支功能重叠。
替换后不再需要两套路由（Actor 与 fallback 并存），统一通过 WSViewBindServer handlers。

### 替换方案

#### 1) 修改 import（line 20）

移除：
```
const { initializeAASCSystem } = require('../../../framework/aasc/init');
```

增加：
```
const { WSViewBindServer } = require('../../core/viewbind');
```

#### 2) 替换初始化代码（line 263-287）

移除：
```
aascSystem = await initializeAASCSystem({ localIP, port, voiceCommand, chat, tts, reminder, timeAnnounce, config, sendToDisplay, broadcastToControls, ... });
```

新增：
```
wsServer = new WSViewBindServer();
wsServer.setCallbacks({
  onDisplayConnect: (id, ip, ws) => log('WS', `显示端连接: ${id} (${ip})`),
  onDisplayDisconnect: (id) => log('WS', `显示端断开: ${id}`),
  onControlConnect: () => log('WS', '控制端连接'),
  onControlDisconnect: () => log('WS', '控制端断开')
});
```

#### 3) 注册显示端消息 handler（替代 handleDisplayMessageFallback）

```
wsServer.registerHandler('canvasSize', (data, ctx) => {
  const vbind = wsServer._displayMap.get(ctx.displayId);
  if (vbind) { vbind.data.state.canvasSize = { width: data.width, height: data.height }; }
});
wsServer.registerHandler('browserInfo', (data, ctx) => {
  // 更新显示端 browserInfo
});
wsServer.registerHandler('voiceInput', (data, ctx) => {
  broadcastToControls({ type: 'voiceInput', displayId: ctx.displayId, text: data.text, ... });
});
wsServer.registerHandler('voiceStatus', (data, ctx) => {
  // 更新 voiceSupported / voiceListening
});
wsServer.registerHandler('capabilities', (data, ctx) => {
  // 更新能力 + 合并 userCapabilities
});
wsServer.registerHandler('commandAck', (data, ctx) => {
  broadcastToControls({ type: 'commandAck', displayId: ctx.displayId, ... });
});
```

#### 4) 注册控制端消息 handler（替代 handleControlMessageFallback）

```
wsServer.registerHandler('voiceCommand', handleVoiceCommand);     // 调 voiceCommand.processVoiceCommand
wsServer.registerHandler('confirmVoiceCommand', (data, ctx) => voiceCommand.confirmCommand(data));
wsServer.registerHandler('getSearchHistory', (data, ctx) => voiceCommand.getSearchHistory());
wsServer.registerHandler('timeAnnounce', handleTimeAnnounce);     // 调 timeAnnounce.checkAndAnnounce
wsServer.registerHandler('getReminders', (data, ctx) => reminder.getReminders(data.displayId));
wsServer.registerHandler('chatHistory', handleChatHistory);
wsServer.registerHandler('mute', (data, ctx) => muteAllDisplays());
wsServer.registerHandler('unmute', (data, ctx) => unmuteAllDisplays());
wsServer.registerHandler('todayReminders', handleTodayReminders);

// 媒体控制
wsServer.registerHandler('media', (data, ctx) => {
  sendToDisplay(data.displayId, { type: data.media?.mediaType, ...data.media });
});
wsServer.registerHandler('control', (data, ctx) => {
  sendToDisplay(data.displayId, { type: 'control', action: data.action, value: data.value });
});
```

#### 5) 替换 6 个调用点

| 行号 | 旧代码 | 新代码 |
|------|--------|--------|
| 1944 | `aascSystem.handleDisplayConnect(id, ip, ws, saved)` | `wsServer.handleDisplayConnect(id, ip, ws, saved)` |
| 2006 | `aascSystem.handleDisplayMessage(id, data, ws)` | `wsServer.handleDisplayMessage(id, data, ws)` 或走 handler |
| 2024 | `aascSystem.handleDisplayDisconnect(id)` | `wsServer.handleDisplayDisconnect(id)` |
| 2033 | `aascSystem.handleControlConnect(ws)` | `wsServer.handleControlConnect(ws)` |
| 2077 | `aascSystem.handleControlMessage(data, ws)` | `wsServer.handleControlMessage(data, ws)` |
| 2093 | `aascSystem.handleControlDisconnect(ws)` | `wsServer.handleControlDisconnect(ws)` |

#### 6) if (aascSystem) 检查替换

现有 pattern：
```
if (aascSystem) { aascSystem.handleXxx(); } else { fallback(); }
```

替换为：
```
if (wsServer) { wsServer.handleXxx(); }
// fallback 逻辑已 inline 在 handler 注册中，不再需要单独的 if-else
```

#### 7) 移除 aascSystem 变量声明（line 152）

`let aascSystem = null` → `let wsServer = null`

### 保持不变的部分

- displayClients Map 和 controlClients Set 的创建和使用 // WSViewBindServer 内部另有 displayClients ViewBindList，但 server-app.js 原有的 Map/Set 仍用于其他业务（mute, timeAnnounce, reminder 等直接引用）
- broadcastToControls, sendToDisplay 函数 // 控制端广播和显示端发送仍使用原函数
- runtimeBridge 逻辑 (line 1860-1913)
- updateCapabilities 的处理（line 2053-2075）// 仍直接在 ws.on('message') 中处理
- 控制端初始消息发送（serverStartTime, displayList, logHistory, systemStats）
- 显示端初始消息发送（serverStartTime, displayId, asrConfig, restoreState）
- config 持久化逻辑

### 验证方式

- 显示端连接/断开 → handleDisplayConnect/Disconnect 被调用
- 显示端上报 canvasSize → handler 更新 ViewBind.data → ViewBindList 回调广播
- 控制端发 media → handler 调 sendToDisplay → 显示端收到
- 控制端发 voiceCommand → handler 调 voiceCommand.processVoiceCommand
- 控制端断连 → handleControlDisconnect 清理
- 全部通过后，可删除 `src/framework/aasc/init.js` 和 `src/framework/aasc/system/websocket-system.js`
