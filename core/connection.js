const WebSocket = require('ws');

let displayClients = new Map();
let controlClients = new Set();
let serverStartTime = Date.now();
let wss = null;

function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

function createDisplayState() {
    return {
        currentMedia: null,
        rotation: 0,
        fit: 'contain',
        crop: { x: 0, y: 0, width: 100, height: 100 },
        canvasSize: { width: 1920, height: 1080 },
        userAgent: null
    };
}

function initWebSocket(server, messageHandler) {
    wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws, req) => {
        const url = req.url || '/';
        
        if (url === '/display' || url.startsWith('/display')) {
            handleDisplayConnection(ws, req, messageHandler);
        } else if (url === '/control' || url.startsWith('/control')) {
            handleControlConnection(ws, req, messageHandler);
        }
        
        ws.on('error', (error) => {
            console.error('WebSocket错误:', error.message);
        });
    });
    
    return wss;
}

function handleDisplayConnection(ws, req, messageHandler) {
    const displayId = generateId();
    const clientIP = getClientIP(req);
    
    displayClients.set(displayId, {
        ws: ws,
        ip: clientIP,
        state: createDisplayState()
    });
    
    console.log(`显示端 ${displayId} (${clientIP}) 已连接，当前连接数: ${displayClients.size}`);
    
    ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
    ws.send(JSON.stringify({ type: 'displayId', id: displayId }));
    broadcastToControls({ type: 'displayList', list: getDisplayList() });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const displayData = displayClients.get(displayId);
            
            if (data.type === 'canvasSize' && displayData) {
                displayData.state.canvasSize = { width: data.width, height: data.height };
                broadcastToControls({ type: 'displayList', list: getDisplayList() });
            } else if (data.type === 'userAgent' && displayData) {
                displayData.state.userAgent = data.userAgent;
                broadcastToControls({ type: 'displayList', list: getDisplayList() });
            }
            
            if (messageHandler) {
                messageHandler('display', displayId, data);
            }
        } catch (e) {
            console.error('解析显示端消息失败:', e);
        }
    });
    
    ws.on('close', () => {
        displayClients.delete(displayId);
        console.log(`显示端 ${displayId} 已断开，当前连接数: ${displayClients.size}`);
        broadcastToControls({ type: 'displayList', list: getDisplayList() });
    });
}

function handleControlConnection(ws, req, messageHandler) {
    controlClients.add(ws);
    console.log(`控制端已连接，当前连接数: ${controlClients.size}`);
    
    ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));
    ws.send(JSON.stringify({ type: 'displayList', list: getDisplayList() }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (messageHandler) {
                messageHandler('control', null, data, ws);
            }
            
            const displayId = data.displayId;
            const displayData = displayClients.get(displayId);
            
            if (!displayData) return;
            
            if (data.type === 'getState') {
                const stateToSend = { ...displayData.state };
                if (stateToSend.currentMedia) {
                    stateToSend.currentMediaUrl = stateToSend.currentMedia.url;
                    stateToSend.currentMediaType = stateToSend.currentMedia.mediaType;
                }
                ws.send(JSON.stringify({
                    type: 'displayState',
                    displayId: displayId,
                    state: stateToSend
                }));
            } else if (data.type === 'media') {
                displayData.state.currentMedia = data.media;
                sendToDisplay(displayId, data.media);
            } else if (data.type === 'control') {
                if (data.action === 'rotate') {
                    displayData.state.rotation = data.value;
                } else if (data.action === 'fit') {
                    displayData.state.fit = data.value;
                } else if (data.action === 'crop') {
                    displayData.state.crop = data.value;
                }
                sendToDisplay(displayId, data);
            }
        } catch (e) {
            console.error('解析控制端消息失败:', e);
        }
    });
    
    ws.on('close', () => {
        controlClients.delete(ws);
        console.log(`控制端已断开，当前连接数: ${controlClients.size}`);
    });
}

function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

function getDisplayList() {
    const list = [];
    displayClients.forEach((data, id) => {
        list.push({
            id: id,
            ip: data.ip,
            canvasSize: data.state.canvasSize,
            userAgent: data.state.userAgent
        });
    });
    return list;
}

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

function getDisplayState(displayId) {
    const displayData = displayClients.get(displayId);
    return displayData ? displayData.state : null;
}

function setDisplayState(displayId, state) {
    const displayData = displayClients.get(displayId);
    if (displayData) {
        displayData.state = { ...displayData.state, ...state };
    }
}

function getServerStartTime() {
    return serverStartTime;
}

module.exports = {
    initWebSocket,
    getDisplayList,
    broadcastToControls,
    sendToDisplay,
    getDisplayState,
    setDisplayState,
    getServerStartTime,
    displayClients,
    controlClients
};
