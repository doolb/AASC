export class RoomClient {
    constructor(onDevices, onStatus) { this.onDevices = onDevices; this.onStatus = onStatus; this.sequence = 0; this.generation = 0; }
    connect(room, label, viewer = false) {
        this.socket?.close(); const generation = ++this.generation;
        this.device = null; this.sequence = 0;
        const url = new URL('room', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.search = ''; url.hash = '';
        const socket = new WebSocket(url); this.socket = socket;
        socket.addEventListener('open', () => { if (generation === this.generation) socket.send(JSON.stringify({ type: 'room.join', room, label, role: viewer ? 'viewer' : 'source' })); });
        socket.addEventListener('message', event => {
            if (generation !== this.generation) return;
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'room.joined') { this.room = data.room; this.device = data.device;
                    this.onStatus(`已加入 ${data.room}`, data); this.onDevices(data.devices); }
                if (data.type === 'device.update') this.onDevices([data.device]);
                if (data.type === 'error') this.onStatus(data.message);
            } catch { this.onStatus('房间消息不可读取'); }
        });
        socket.addEventListener('close', () => { if (generation === this.generation) {
            this.device = null; this.onStatus('房间断开，输入仍在本地运行；点击连接可重新加入'); } });
        socket.addEventListener('error', () => { if (generation === this.generation) this.onStatus('房间连接失败'); });
    }
    publish(frame) {
        if (!this.device || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 128 * 1024) return;
        this.socket.send(JSON.stringify({ type: 'imu.frame', deviceId: this.device.id, generation: this.device.generation,
            sequence: ++this.sequence, frame }));
    }
    close() { this.generation += 1; this.socket?.close(); this.device = null; }
}
