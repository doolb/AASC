export class RoomClient {
    constructor(onDevices, onStatus, onSample = () => {}) {
        this.onDevices = onDevices; this.onStatus = onStatus; this.onSample = onSample;
        this.sequence = 0; this.generation = 0;
    }
    connect(room, label, role = 'source') {
        this.socket?.close(); const generation = ++this.generation;
        this.device = null; this.sequence = 0; this.role = role;
        const url = new URL('room', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.search = ''; url.hash = '';
        const socket = new WebSocket(url); this.socket = socket;
        socket.addEventListener('open', () => { if (generation === this.generation) socket.send(JSON.stringify({ type: 'room.join', room, label, role })); });
        socket.addEventListener('message', event => {
            if (generation !== this.generation) return;
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'room.joined') { this.room = data.room; this.device = data.device;
                    this.onStatus(`已加入 ${data.room}`, data); this.onDevices(data.devices); }
                if (data.type === 'device.update') this.onDevices([data.device]);
                if (data.type === 'sensor.sample' || data.type === 'sensor.samples') {
                    this.onDevices([data.device]);
                    this.onSample({ ...data, samples: data.samples || [data.sample] });
                }
                if (data.type === 'error') this.onStatus(data.message);
            } catch { this.onStatus('房间消息不可读取'); }
        });
        socket.addEventListener('close', () => { if (generation === this.generation) {
            this.device = null; this.onStatus(role === 'viewer'
                ? '房间断开，远程传感器数据已停止；点击连接可重新加入'
                : '房间断开，输入仍在本地运行；点击连接可重新加入'); } });
        socket.addEventListener('error', () => { if (generation === this.generation) this.onStatus('房间连接失败'); });
    }
    /** 页面重新加入房间时上传当前已显示的两条轨迹，供诊断接口恢复现场。 */
    publishTrajectorySnapshot(estimatedTrail, referenceTrail, clearHistory = false) {
        if (!this.device || this.role === 'viewer' || this.socket?.readyState !== WebSocket.OPEN
            || this.socket.bufferedAmount > 128 * 1024) return false;
        this.socket.send(JSON.stringify({ type: 'imu.trajectory.snapshot', deviceId: this.device.id,
            generation: this.device.generation, sequence: ++this.sequence, estimatedTrail, referenceTrail, clearHistory }));
        return true;
    }
    publish(frame, referencePosition = null, trajectoryDelta = null) {
        if (!this.device || this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 128 * 1024) return false;
        const message = { type: 'imu.frame', deviceId: this.device.id, generation: this.device.generation,
            sequence: ++this.sequence, frame };
        if (referencePosition) message.referencePosition = referencePosition;
        if (trajectoryDelta?.estimated) message.estimatedTrailDelta = trajectoryDelta.estimated;
        if (trajectoryDelta?.reference) message.referenceTrailDelta = trajectoryDelta.reference;
        this.socket.send(JSON.stringify(message));
        return true;
    }
    close() { this.generation += 1; this.socket?.close(); this.device = null; }
}
