'use strict';

const get = id => document.getElementById(id);
const hostInput = get('host');
const portInput = get('port');
const status = get('status');
const countOutput = get('count');
const gyroOutput = get('gyro');
const accelOutput = get('accel');
const MIN_SEND_INTERVAL_MS = 20;
const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_PENDING_SAMPLES = 128;
const MAX_SAMPLES_PER_PACKET = 8;
let socket = null;
let device = null;
let sequence = 0;
let sampleCount = 0;
let droppedSampleCount = 0;
let socketGeneration = 0;
let collecting = false;
const pendingSamples = [];
let pendingGap = false;
let lastSentBatchSize = 0;
let sendTimer = null;
let lastSendAt = 0;
let sendIntervalMs = MIN_SEND_INTERVAL_MS;

function setStatus(message) { status.textContent = message; }
function updateCount() {
    countOutput.textContent = `已发送 ${sampleCount} 个样本 · 自动丢弃旧样本 ${droppedSampleCount} 个`;
}
function clearPendingSend() {
    if (sendTimer !== null) window.clearTimeout(sendTimer);
    sendTimer = null; pendingSamples.length = 0; pendingGap = false; lastSentBatchSize = 0;
}
function markNextGap() {
    if (pendingSamples.length) pendingSamples[0].gap = true;
    else pendingGap = true;
}
function scheduleBatchSend() {
    if (!pendingSamples.length || sendTimer !== null) return;
    const delay = Math.max(0, sendIntervalMs - (performance.now() - lastSendAt));
    sendTimer = window.setTimeout(sendBatch, delay);
}
function sendBatch() {
    sendTimer = null;
    if (!collecting || !device || !socket || socket.readyState !== WebSocket.OPEN) { clearPendingSend(); return; }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        sendTimer = window.setTimeout(sendBatch, sendIntervalMs); return;
    }
    const samples = pendingSamples.splice(0, MAX_SAMPLES_PER_PACKET);
    if (!samples.length) return;
    socket.send(JSON.stringify({ type: 'imu.samples', deviceId: device.id, generation: device.generation,
        sequence: ++sequence, samples }));
    lastSentBatchSize = samples.length;
    sampleCount += samples.length; lastSendAt = performance.now(); updateCount();
    scheduleBatchSend();
}
function setButtons() {
    get('connect').disabled = Boolean(socket && socket.readyState < WebSocket.CLOSING);
    get('disconnect').disabled = !socket || socket.readyState === WebSocket.CLOSED;
    get('start').disabled = !device || collecting;
    get('stop').disabled = !collecting;
}
function stopNative() {
    if (collecting && window.NativeImu) window.NativeImu.stopSensors();
    collecting = false; clearPendingSend();
    setButtons();
}

get('connect').addEventListener('click', () => {
    const host = hostInput.value.trim().replace(/^\[|\]$/g, '');
    const port = Number(portInput.value);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) { setStatus('请输入有效的电脑地址和端口'); return; }
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    device = null; sequence = 0; sampleCount = 0; droppedSampleCount = 0; updateCount(); clearPendingSend();
    const generation = ++socketGeneration;
    const address = host.includes(':') ? `[${host}]` : host;
    try { socket = new WebSocket(`ws://${address}:${port}/room`); }
    catch (error) { setStatus(`地址无效：${error.message}`); setButtons(); return; }
    const activeSocket = socket;
    setStatus('正在连接电脑测试服务…'); setButtons();
    activeSocket.addEventListener('open', () => {
        if (generation !== socketGeneration) return;
        activeSocket.send(JSON.stringify({ type: 'room.join', room: 'AASCIMU1', role: 'sensor', label: 'Android原生六轴' }));
    });
    activeSocket.addEventListener('message', event => {
        if (generation !== socketGeneration) return;
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'room.joined') {
                if (!message.device) { setStatus('服务端未分配传感器设备身份'); return; }
                device = message.device; setStatus('已连接 AASCIMU1，可以开始采集'); setButtons();
            } else if (message.type === 'error') {
                if (String(message.message || '').includes('采样频率超过服务端限制')) {
                    if (sendTimer !== null) window.clearTimeout(sendTimer);
                    sendTimer = null; lastSendAt = performance.now(); sendIntervalMs = Math.min(200, sendIntervalMs + 20);
                    droppedSampleCount += lastSentBatchSize; markNextGap(); updateCount();
                    setStatus(`服务端限流，已丢弃旧样本并降至约${Math.round(1000 / sendIntervalMs)}Hz`);
                    scheduleBatchSend();
                } else {
                    setStatus(message.message || '服务端拒绝了连接'); stopNative();
                }
            }
        } catch { setStatus('无法读取服务端消息'); }
    });
    activeSocket.addEventListener('close', () => {
        if (generation !== socketGeneration) return;
        stopNative(); device = null; setStatus('连接已断开'); setButtons();
    });
    activeSocket.addEventListener('error', () => {
        if (generation === socketGeneration) setStatus('连接失败，请检查地址、端口和电脑防火墙');
    });
});

get('disconnect').addEventListener('click', () => {
    stopNative(); device = null; socketGeneration += 1; socket?.close(); socket = null;
    setStatus('已断开'); setButtons();
});

get('start').addEventListener('click', () => {
    if (!device || !socket || socket.readyState !== WebSocket.OPEN) { setStatus('请先连接电脑'); return; }
    if (!window.NativeImu || !window.NativeImu.startSensors()) { setStatus('设备无法启动六轴传感器'); return; }
    clearPendingSend(); sampleCount = 0; droppedSampleCount = 0; lastSendAt = 0;
    sendIntervalMs = MIN_SEND_INTERVAL_MS; updateCount();
    collecting = true; setStatus('正在采集并回传原生六轴数据'); setButtons();
});

get('stop').addEventListener('click', () => { stopNative(); setStatus('采集已停止'); });

window.onNativeImuSamples = samples => {
    if (!collecting || !device || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (!Array.isArray(samples) || !samples.length) return;
    for (const sample of samples) {
        if (pendingGap) { sample.gap = true; pendingGap = false; }
        if (pendingSamples.length >= MAX_PENDING_SAMPLES) {
            pendingSamples.shift(); droppedSampleCount += 1;
            (pendingSamples[0] || sample).gap = true;
        }
        pendingSamples.push(sample);
    }
    const latest = samples.at(-1);
    gyroOutput.textContent = `角速度 / rad·s⁻¹：${latest.gyro.map(value => value.toFixed(3)).join(' / ')}`;
    accelOutput.textContent = `加速度 / m·s⁻²：${latest.accel.map(value => value.toFixed(3)).join(' / ')}`;
    updateCount(); scheduleBatchSend();
};
window.onNativeImuSample = sample => window.onNativeImuSamples([sample]);

window.onNativeSensorStatus = message => {
    if (message === '原生传感器已停止' && !collecting) return;
    setStatus(message);
};

window.onNativePause = () => {
    collecting = false; clearPendingSend();
    if (socket) {
        socketGeneration += 1; device = null; socket.close(); socket = null;
    }
    setButtons(); setStatus('应用进入后台，已断开服务器并停止采集');
};

window.addEventListener('pagehide', stopNative, { once: true });
setButtons();
