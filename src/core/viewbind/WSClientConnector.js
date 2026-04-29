const WebSocket = require('ws');

// WS 客户端传输连接器 // 实现 TransportConnector 接口，可接入 ViewBind.connect
class WSClientConnector {
    constructor(url, options = {}) {
        this._url = url;
        this._ws = null;
        this._onReceiveCallback = null;
        this._reconnect = options.reconnect !== false;
        this._reconnectInterval = options.reconnectInterval || 3000;
        this._maxReconnects = options.maxReconnects || 5;
        this._reconnectCount = 0;
        this._destroyed = false;
    }

    // 建立连接 // 创建 WebSocket 并注册事件
    connect() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) return;
        this._destroyed = false;
        try {
            this._ws = new WebSocket(this._url);
            this._ws.on('message', (raw) => {
                try {
                    const data = JSON.parse(raw.toString());
                    if (typeof this._onReceiveCallback === 'function') {
                        this._onReceiveCallback(data);
                    }
                } catch (_) {}
            });
            this._ws.on('close', () => {
                if (!this._destroyed && this._reconnect) {
                    this._tryReconnect();
                }
            });
            this._ws.on('error', () => {});
            this._ws.on('open', () => {
                this._reconnectCount = 0;
            });
        } catch (_) {}
    }

    // 发送数据到远端 // 序列化为 JSON 发送
    send(data) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(data));
        }
    }

    // 注册收到数据的回调 // 返回取消函数
    onReceive(callback) {
        this._onReceiveCallback = callback;
        return () => {
            this._onReceiveCallback = null;
        };
    }

    // 关闭连接，清理资源
    close() {
        this._destroyed = true;
        this._onReceiveCallback = null;
        if (this._ws) {
            try { this._ws.close(); } catch (_) {}
            this._ws = null;
        }
    }

    _tryReconnect() {
        if (this._destroyed) return;
        if (this._reconnectCount >= this._maxReconnects) return;
        this._reconnectCount++;
        setTimeout(() => {
            if (!this._destroyed) {
                this.connect();
            }
        }, this._reconnectInterval);
    }
}

module.exports = WSClientConnector;
