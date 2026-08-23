const WebSocket = require('ws');
const ViewBind = require('./ViewBind');
const ViewBindList = require('./ViewBindList');

// 基于 ViewBind 的 WS 服务端管理类 // 替代 WebSocketSystem
class WSViewBindServer {
    constructor() {
        this.displayClients = new ViewBindList([]);  // ViewBindList 管理显示端数据对象
        this._displayMap = new Map();                 // displayId → ViewBind（带 connect 的实例）
        this.controlClients = new Set();              // 控制端 WS 连接集合
        this.handlers = new Map();                    // 消息 type → 处理函数
        this.lifecycleCallbacks = {};                 // 生命周期钩子
        this._listUnbind = null;

        // 绑定列表变化回调：自动广播 displayList 到控制端
        this._listUnbind = this.displayClients.bind(() => {
            this._broadcastDisplayList();
        });
    }

    // 注册消息类型处理函数 // 替代 Actor 注册
    registerHandler(type, handlerFn) {
        if (typeof handlerFn === 'function') {
            this.handlers.set(type, handlerFn);
        }
    }

    // 设置生命周期回调
    setCallbacks(callbacks) {
        this.lifecycleCallbacks = { ...this.lifecycleCallbacks, ...callbacks };
    }

    // 处理显示端连接
    handleDisplayConnect(displayId, clientIP, ws, savedState = null) {
        // 同一 displayId 重连时先移除旧 ViewBind，避免列表重复登记。
        const previous = this._displayMap.get(displayId);
        if (previous) {
            const previousIndex = this._findDisplayIndex(displayId);
            if (previousIndex !== -1) {
                this.displayClients.remove(previousIndex);
            }
            previous.disconnect();
            this._displayMap.delete(displayId);
        }

        const displayData = {
            displayId,
            ws,
            ip: clientIP,
            isSubDisplay: false,
            lastSeen: Date.now(),
            state: {
                currentMedia: null,
                rotation: 0,
                fit: 'contain',
                crop: { x: 0, y: 0, width: 100, height: 100 },
                volume: 100,
                isPlaying: false,
                canvasSize: { width: 1920, height: 1080 },
                browserInfo: null,
                capabilities: null,
                ...savedState
            }
        };

        // 创建带 connect 的 ViewBind // 数据变化自动同步到此显示端
        const viewbind = new ViewBind(displayData);
        this._displayMap.set(displayId, viewbind);

        // ViewBindList 存数据对象 // 避免 ViewBindList 二次包装
        this.displayClients.push(displayData);

        if (this.lifecycleCallbacks.onDisplayConnect) {
            this.lifecycleCallbacks.onDisplayConnect(displayId, clientIP, ws);
        }

        return viewbind;
    }

    // 处理显示端消息
    async handleDisplayMessage(displayId, data, ws) {
        if (data.type === 'heartbeat') return { success: true, dispatched: false };

        const handler = this.handlers.get(data.type);
        if (handler) {
            try {
                const result = await handler(data, { displayId, ws, server: this });
                return result || { success: true, dispatched: false };
            } catch (err) {
                console.error('[WSViewBindServer] 显示端消息处理错误:', err.message);
                return { success: false, error: err.message };
            }
        }

        // 未注册 handler 的消息类型，更新显示端数据
        const vbind = this._displayMap.get(displayId);
        if (vbind) {
            vbind.pauseSync();
            const current = vbind.data;
            current.lastSeen = Date.now();
            Object.assign(current, data);
            vbind.data = current;
            vbind.resumeSync();
        }

        return { success: true, dispatched: false };
    }

    // 处理显示端断连
    handleDisplayDisconnect(displayId, ws = null) {
        const vbind = this._displayMap.get(displayId);
        // 旧 WebSocket 的异步 close 事件不能清理已经接管的新连接。
        if (ws && (!vbind || vbind.data.ws !== ws)) {
            return false;
        }

        if (vbind) {
            vbind.disconnect();
            this._displayMap.delete(displayId);
        }

        // 从 ViewBindList 移除
        const index = this._findDisplayIndex(displayId);
        if (index !== -1) {
            this.displayClients.remove(index);
        }

        if (this.lifecycleCallbacks.onDisplayDisconnect) {
            this.lifecycleCallbacks.onDisplayDisconnect(displayId);
        }

        return true;
    }

    // 处理控制端连接
    handleControlConnect(ws) {
        this.controlClients.add(ws);

        if (this.lifecycleCallbacks.onControlConnect) {
            this.lifecycleCallbacks.onControlConnect(ws);
        }

        return this.controlClients.size;
    }

    // 处理控制端消息
    async handleControlMessage(data, ws) {
        if (data.type === 'updateCapabilities') {
            return { success: true, dispatched: false };
        }

        const handler = this.handlers.get(data.type);
        if (handler) {
            try {
                const result = await handler(data, { ws, server: this });
                return result || { success: true, dispatched: false };
            } catch (err) {
                console.error('[WSViewBindServer] 控制端消息处理错误:', err.message);
                return { success: false, error: err.message };
            }
        }

        return { success: true, dispatched: false };
    }

    // 处理控制端断连
    handleControlDisconnect(ws) {
        this.controlClients.delete(ws);

        if (this.lifecycleCallbacks.onControlDisconnect) {
            this.lifecycleCallbacks.onControlDisconnect(ws);
        }
    }

    // 向指定显示端发送数据
    sendToDisplay(displayId, data) {
        const vbind = this._displayMap.get(displayId);
        if (!vbind) return false;

        const current = vbind.data;
        vbind.data = { ...current, ...data };
        return true;
    }

    // 获取显示端安全列表
    getDisplayList() {
        const list = [];
        for (let i = 0; i < this.displayClients.list.length; i++) {
            const vbind = this.displayClients.get(i);
            if (!vbind) continue;
            const d = vbind.data;
            list.push({
                id: d.displayId,
                ip: d.ip,
                isSubDisplay: d.isSubDisplay || false,
                canvasSize: d.state?.canvasSize,
                rotation: d.state?.rotation || 0,
                browserInfo: d.state?.browserInfo,
                voiceSupported: d.state?.voiceSupported,
                voiceListening: d.state?.voiceListening,
                capabilities: d.state?.capabilities
            });
        }
        return list;
    }

    // 获取统计信息
    getStats() {
        return {
            displayClients: this.displayClients.count,
            controlClients: this.controlClients.size,
            handlers: this.handlers.size
        };
    }

    // 关闭服务，清理所有连接
    shutdown() {
        for (const [id, vbind] of this._displayMap) {
            vbind.disconnect();
        }
        this._displayMap.clear();
        this.displayClients.clear();
        this.controlClients.clear();
        this.handlers.clear();
        if (this._listUnbind) {
            this._listUnbind();
            this._listUnbind = null;
        }
    }

    // 广播 displayList 到所有控制端
    _broadcastDisplayList() {
        const list = this.getDisplayList();
        const message = JSON.stringify({ type: 'displayList', list });
        for (const client of this.controlClients) {
            if (client.readyState === WebSocket.OPEN) {
                try { client.send(message); } catch (_) {}
            }
        }
    }

    // 按 displayId 查找在 ViewBindList 中的索引
    _findDisplayIndex(displayId) {
        if (!displayId) return -1;
        for (let i = 0; i < this.displayClients.list.length; i++) {
            const vbind = this.displayClients.get(i);
            if (!vbind) continue;
            if (vbind.data.displayId === displayId) return i;
        }
        return -1;
    }
}

module.exports = WSViewBindServer;
