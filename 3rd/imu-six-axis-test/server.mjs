import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../..');
const names = ['index.html', 'style.css', 'app.mjs', 'imu-engine.mjs', 'imu-simulator.mjs',
    'imu-simulator-view.mjs', 'imu-phone.mjs', 'imu-room.mjs', 'imu-scene.mjs'];
const staticFiles = new Map(names.map(name => ['/' + name, path.join(root, name)]));
staticFiles.set('/', path.join(root, 'index.html'));
staticFiles.set('/vendor/three.mjs', path.join(repository, 'node_modules/three/build/three.module.js'));
for (const control of ['OrbitControls', 'TransformControls']) staticFiles.set(`/vendor/${control}.js`,
    path.join(repository, `node_modules/three/examples/jsm/controls/${control}.js`));
const array = (value, length, bound) => Array.isArray(value) && value.length === length
    && value.every(number => Number.isFinite(number) && Math.abs(number) <= bound);

/** 服务端仅广播规范化的源端结果，不能让观察端再次积分。 */
export function normalizeFrame(frame) {
    if (!frame || !array(frame.position, 3, 1e5) || !array(frame.velocity, 3, 1e4)
        || !array(frame.quaternion, 4, 1.01) || !Number.isFinite(frame.time) || frame.time < 0) return null;
    const magnitude = Math.hypot(...frame.quaternion);
    if (magnitude < 0.9 || magnitude > 1.1) return null;
    const result = { position: [...frame.position], velocity: [...frame.velocity],
        quaternion: frame.quaternion.map(value => value / magnitude), time: frame.time };
    for (const key of ['gyro', 'linear', 'rawGyro', 'rawAccel', 'gyroBias', 'gyroNoise']) {
        if (!array(frame[key], 3, 1e4)) return null;
        result[key] = [...frame[key]];
    }
    for (const key of ['samples', 'gaps', 'rejected', 'zeroCorrections', 'faces']) result[key] =
        Number.isSafeInteger(frame[key]) && frame[key] >= 0 ? frame[key] : 0;
    for (const key of ['gyroCalibrated', 'accelCalibrated', 'calibrationActive']) result[key] = frame[key] === true;
    result.message = String(frame.message || '').slice(0, 180);
    result.status = String(frame.status || '').slice(0, 24);
    result.kind = frame.kind === 'linear' ? 'linear' : 'gravity';
    return result;
}

export async function createLabServer(options = {}) {
    const rooms = new Map(); let generation = 0;
    const handler = async (request, response) => {
        try {
            if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
            const url = new URL(request.url, 'http://localhost');
            const file = staticFiles.get(url.pathname);
            if (!file) { response.writeHead(404); response.end('未找到'); return; }
            const body = await readFile(file);
            const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
            response.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Content-Length': body.length,
                'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
                'Permissions-Policy': 'accelerometer=(self), gyroscope=(self)' });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch { response.writeHead(500); response.end('测试资源读取失败'); }
    };
    const server = options.tls ? https.createServer(options.tls, handler) : http.createServer(handler);
    const wss = new WebSocketServer({ server, path: '/room', maxPayload: 16 * 1024 });
    const send = (socket, value) => {
        if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(value));
    };
    const broadcast = (room, message) => { for (const client of room.clients) send(client, message); };
    const summary = device => ({ id: device.id, generation: device.generation, label: device.label,
        color: device.color, online: device.online, frame: device.frame });
    const colors = ['#65d8c8', '#ffba70', '#92aaff', '#e991de', '#9de47b', '#79c9ff'];
    wss.on('connection', socket => {
        let room = null, device = null, lastFrame = 0;
        const handshake = setTimeout(() => { if (!room) socket.close(1008, '未加入房间'); }, 10000);
        socket.on('error', () => {});
        socket.on('message', buffer => {
            try {
                const data = JSON.parse(buffer.toString());
                if (data.type === 'room.join') {
                    if (room) { send(socket, { type: 'error', message: '已加入房间' }); return; }
                    const code = String(data.room || '').toUpperCase();
                    if (code && (!/^[A-Z0-9]{8}$/.test(code) || !rooms.has(code))) throw new Error('房间不存在，请使用电脑生成的链接');
                    if (!code && rooms.size >= 64) throw new Error('测试房间已满');
                    const selected = code || randomBytes(4).toString('hex').toUpperCase();
                    room = rooms.get(selected) || { code: selected, clients: new Set(), devices: new Map(), lastActive: Date.now() };
                    if (room.clients.size >= 24) { room = null; throw new Error('房间连接已满'); }
                    if (data.role !== 'viewer' && room.devices.size >= 12) { room = null; throw new Error('房间设备已满'); }
                    rooms.set(selected, room); room.clients.add(socket); room.lastActive = Date.now();
                    if (data.role !== 'viewer') {
                        device = { id: randomUUID(), generation: ++generation, label: String(data.label || '输入设备').slice(0, 32),
                            color: colors[room.devices.size % colors.length], online: true, frame: null, sequence: -1 };
                        room.devices.set(device.id, device);
                    }
                    clearTimeout(handshake);
                    send(socket, { type: 'room.joined', room: selected, device: device && summary(device),
                        devices: [...room.devices.values()].map(summary) });
                    if (device) broadcast(room, { type: 'device.update', device: summary(device) });
                    return;
                }
                if (data.type !== 'imu.frame' || !room || !device) throw new Error('消息类型或输入身份无效');
                if (data.deviceId !== device.id || data.generation !== device.generation) throw new Error('设备会话不匹配');
                if (!Number.isSafeInteger(data.sequence) || data.sequence <= device.sequence) throw new Error('样本顺序无效');
                const frame = normalizeFrame(data.frame);
                if (!frame) throw new Error('位姿或六轴数据无效');
                if (device.frame && frame.time < device.frame.time) throw new Error('源时间回退');
                const now = Date.now();
                // 输入计算频率独立于网络帧率；丢弃过密结果不会损坏源端积分。
                if (now - lastFrame < 15) return;
                device.sequence = data.sequence; device.frame = frame; lastFrame = now; room.lastActive = now;
                broadcast(room, { type: 'device.update', device: summary(device) });
            } catch (error) { send(socket, { type: 'error', message: error.message || '消息处理失败' }); }
        });
        socket.on('close', () => {
            clearTimeout(handshake);
            if (!room) return;
            room.clients.delete(socket); room.lastActive = Date.now();
            if (device) { device.online = false; broadcast(room, { type: 'device.update', device: summary(device) }); }
        });
    });
    const sweep = setInterval(() => {
        for (const [code, room] of rooms) {
            if (!room.clients.size && Date.now() - room.lastActive > 120000) rooms.delete(code);
            for (const [id, device] of room.devices) if (!device.online && Date.now() - room.lastActive > 30000) room.devices.delete(id);
        }
    }, 10000);
    sweep.unref();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 8769, options.host ?? '0.0.0.0', resolve); });
    return { server, rooms, port: server.address().port, async close() {
        clearInterval(sweep); for (const client of wss.clients) client.terminate();
        await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const tls = process.env.IMU_TLS === '1' ? {
            key: await readFile(process.env.IMU_TLS_KEY || path.join(repository, 'res/certs/key.pem')),
            cert: await readFile(process.env.IMU_TLS_CERT || path.join(repository, 'res/certs/cert.pem')) } : null;
        const service = await createLabServer({ port: Number(process.env.IMU_PORT || 8769), host: process.env.IMU_HOST || '0.0.0.0', tls });
        process.stdout.write(`六轴IMU测试页：${tls ? 'https' : 'http'}://localhost:${service.port}/\n`);
        const shutdown = async () => { await service.close(); process.exit(0); };
        process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    } catch (error) { process.stderr.write(`启动失败：${error.message}\n`); process.exitCode = 1; }
}
