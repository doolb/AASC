# WebSocket 实现文档

## 连接处理

### 显示端连接 (/display)

**server.js 实现**:
```javascript
wss.on('connection', (ws, req) => {
    if (url === '/display' || url.startsWith('/display')) {
        const displayId = generateId();
        const clientIP = getClientIP(req);
        const savedState = config.getDisplayState(clientIP);
        
        displayClients.set(displayId, {
            ws: ws,
            ip: clientIP,
            state: { ...createDisplayState(), ...savedState }
        });
        
        ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
        ws.send(JSON.stringify({ type: 'displayId', id: displayId, ip: clientIP }));
        
        if (savedState && savedState.currentMedia) {
            ws.send(JSON.stringify({ type: 'restoreState', state: savedState }));
        }
    }
});
```

### 控制端连接 (/control)

**server.js 实现**:
```javascript
if (url === '/control' || url.startsWith('/control')) {
    controlClients.add(ws);
    ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
    ws.send(JSON.stringify({ type: 'displayList', list: getDisplayList() }));
}
```

## 消息处理

### 显示端状态 (DisplayState)

```javascript
{
    currentMedia: null,
    rotation: 0,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 100, height: 100 },
    volume: 100,
    isPlaying: false,
    canvasSize: { width: 1920, height: 1080 },
    browserInfo: null
}
```

### 控制端发送消息

**public/js/websocket.js 实现**:
```javascript
sendControl(action, value) {
    this.ws.send(JSON.stringify({
        type: 'control',
        displayId: window.currentDisplayId,
        action: action,
        value: value
    }));
}

sendMedia(mediaData) {
    this.ws.send(JSON.stringify({
        type: 'media',
        displayId: window.currentDisplayId,
        media: mediaData
    }));
}
```

### 服务端处理控制消息

```javascript
if (data.type === 'control') {
    const displayData = displayClients.get(data.displayId);
    if (displayData) {
        if (data.action === 'rotate') displayData.state.rotation = data.value;
        if (data.action === 'fit') displayData.state.fit = data.value;
        if (data.action === 'crop') displayData.state.crop = data.value;
        if (data.action === 'volume') displayData.state.volume = data.value;
        if (data.action === 'play') displayData.state.isPlaying = data.value;
        
        sendToDisplay(data.displayId, { type: 'control', action: data.action, value: data.value });
        config.saveDisplayState(displayData.ip, displayData.state);
    }
}
```

## 广播函数

```javascript
function broadcastToControls(data) {
    const message = JSON.stringify(data);
    controlClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function sendToDisplay(displayId, data) {
    const displayData = displayClients.get(displayId);
    if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
        displayData.ws.send(JSON.stringify(data));
        return true;
    }
    return false;
}
```

## 相关文件

| 文件 | 说明 |
|------|------|
| server.js | 服务端 WebSocket 处理 |
| core/connection.js | 连接管理模块 |
| public/js/websocket.js | 控制端 WebSocket 客户端 |
