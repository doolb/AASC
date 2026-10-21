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
export const FIXED_SENSOR_ROOM = 'AASCIMU1';
const SAMPLE_RING_LIMIT = 500;
const SAMPLE_BATCH_LIMIT = 8;
const TRAJECTORY_RING_LIMIT = 600;
const TRAJECTORY_STALE_MS = 1000;
const staticFiles = new Map(names.map(name => ['/' + name, path.join(root, name)]));
staticFiles.set('/', path.join(root, 'index.html'));
staticFiles.set('/vendor/three.mjs', path.join(repository, 'node_modules/three/build/three.module.js'));
for (const control of ['OrbitControls', 'TransformControls']) staticFiles.set(`/vendor/${control}.js`,
    path.join(repository, `node_modules/three/examples/jsm/controls/${control}.js`));
const array = (value, length, bound) => Array.isArray(value) && value.length === length
    && value.every(number => Number.isFinite(number) && Math.abs(number) <= bound);
const normalizeTrail = value => Array.isArray(value) && value.length <= TRAJECTORY_RING_LIMIT
    && value.every(point => array(point, 3, 1e5)) ? value.map(point => [...point]) : null;
const moved = (previous, next) => !previous || next.reduce((sum, value, index) =>
    sum + (value - previous[index]) ** 2, 0) > 0.0001;
const appendTrail = (trail, points) => {
    for (const point of points) {
        trail.push(point);
        if (trail.length > TRAJECTORY_RING_LIMIT) trail.shift();
    }
};

/** 平均每20毫秒获得一个消息令牌；三个令牌的短时余量吸收系统定时抖动。 */
export function createMessageBudget(initialAt = Date.now()) {
    let tokens = 3, lastAt = initialAt;
    return now => {
        tokens = Math.min(3, tokens + Math.max(0, now - lastAt) / 20);
        lastAt = now;
        if (tokens < 1) return false;
        tokens -= 1; return true;
    };
}

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

/** 原生传感器只上传可校验的原始六轴测量，不接受客户端位姿作为样本。 */
export function normalizeSample(sample) {
    if (!sample || !Number.isFinite(sample.time) || sample.time < 0 || sample.time > 86400
        || !array(sample.gyro, 3, 100) || !array(sample.accel, 3, 200)
        || !['gravity', 'linear'].includes(sample.kind)) return null;
    if (sample.gap !== undefined && typeof sample.gap !== 'boolean') return null;
    const result = { time: sample.time, gyro: [...sample.gyro], accel: [...sample.accel], kind: sample.kind };
    if (sample.gap === true) result.gap = true;
    const hasBefore = sample.accelBeforeTime !== undefined;
    const hasAfter = sample.accelAfterTime !== undefined;
    if (hasBefore !== hasAfter) return null;
    if (hasBefore) {
        const before = sample.accelBeforeTime, after = sample.accelAfterTime;
        if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after > 86400
            || after < before || before > sample.time + 1e-6
            || after + 1e-6 < sample.time || after - before > 0.100001) return null;
        result.accelBeforeTime = before; result.accelAfterTime = after;
    }
    return result;
}

export async function createLabServer(options = {}) {
    const rooms = new Map(); let generation = 0;
    const debugSamples = [];
    const debug = { received: 0, invalid: 0, rejected: 0, recentReceiveAt: [], recentMessageAt: [],
        lastReceiveAt: null, lastError: null };
    const isLoopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    const json = (request, response, status, value) => {
        const body = Buffer.from(JSON.stringify(value));
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : body);
    };
    const handler = async (request, response) => {
        try {
            const url = new URL(request.url, 'http://localhost');
            if (['/api/imu/status', '/api/imu/samples', '/api/imu/trajectory'].includes(url.pathname)) {
                if (!isLoopback(request.socket.remoteAddress)) { json(request, response, 403, { error: '仅允许本机读取' }); return; }
                if (!['GET', 'HEAD'].includes(request.method)) { json(request, response, 405, { error: '只允许GET' }); return; }
                if (url.pathname === '/api/imu/status') {
                    const room = rooms.get(FIXED_SENSOR_ROOM);
                    const sensors = room ? [...room.devices.values()].filter(device => device.role === 'sensor').map(summary) : [];
                    const now = Date.now();
                    const recent = debug.recentReceiveAt.filter(time => now - time <= 1000);
                    const messages = debug.recentMessageAt.filter(time => now - time <= 1000);
                    json(request, response, 200, { room: FIXED_SENSOR_ROOM, roomExists: Boolean(room),
                        online: sensors.some(device => device.online), sensors, sampleCount: debug.received,
                        bufferedSamples: debugSamples.length, sampleRateHz: recent.length,
                        sampleMessageRateHz: messages.length,
                        invalidSamples: debug.invalid, rejectedMessages: debug.rejected,
                        lastReceiveAt: debug.lastReceiveAt, lastError: debug.lastError });
                    return;
                }
                if (url.pathname === '/api/imu/samples') {
                    const rawLimit = url.searchParams.get('limit');
                    const requested = rawLimit === null ? 120 : Number(rawLimit);
                    const limit = Number.isFinite(requested)
                        ? Math.max(1, Math.min(SAMPLE_RING_LIMIT, Math.trunc(requested))) : 120;
                    json(request, response, 200, { room: FIXED_SENSOR_ROOM, samples: debugSamples.slice(-limit) });
                    return;
                }
                // 轨迹读取沿用本机诊断访问限制，避免把模拟参考位置开放到局域网。
                const roomCode = (url.searchParams.get('room') || FIXED_SENSOR_ROOM).trim().toUpperCase();
                if (!/^[A-Z0-9]{8}$/.test(roomCode)) { json(request, response, 400, { error: '房间码须为8位英数字' }); return; }
                const trajectoryLimit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : TRAJECTORY_RING_LIMIT;
                const pointLimit = Number.isFinite(trajectoryLimit)
                    ? Math.max(1, Math.min(TRAJECTORY_RING_LIMIT, Math.trunc(trajectoryLimit))) : TRAJECTORY_RING_LIMIT;
                const deviceId = url.searchParams.get('deviceId');
                const room = rooms.get(roomCode);
                const devices = room ? [...room.devices.values()]
                    .filter(device => !deviceId || device.id === deviceId)
                    .map(device => {
                        const now = Date.now();
                        const frameAgeMs = device.lastFrameAt === null || device.lastFrameAt === undefined
                            ? null : Math.max(0, now - device.lastFrameAt);
                        return { id: device.id, label: device.label, role: device.role, online: device.online,
                            current: device.current || null, lastFrameAt: device.lastFrameAt, frameAgeMs,
                            frameRateHz: (device.realtime || []).filter(point => now - point.receivedAt <= 1000).length,
                            stale: frameAgeMs === null || frameAgeMs > TRAJECTORY_STALE_MS,
                            points: (device.realtime || []).slice(-pointLimit),
                            estimatedTrail: (device.estimatedTrail || []).slice(-pointLimit),
                            referenceTrail: (device.referenceTrail || []).slice(-pointLimit) };
                    }) : [];
                json(request, response, 200, { room: roomCode, roomExists: Boolean(room), limit: pointLimit, devices });
                return;
            }
            if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
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
    const wss = new WebSocketServer({ server, path: '/room', maxPayload: 256 * 1024 });
    const send = (socket, value) => {
        if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256 * 1024) socket.send(JSON.stringify(value));
    };
    const broadcast = (room, message) => { for (const client of room.clients) send(client, message); };
    const summary = device => ({ id: device.id, generation: device.generation, label: device.label,
        role: device.role, color: device.color, online: device.online, frame: device.frame });
    const colors = ['#0f766e', '#ea580c', '#2563eb', '#a21caf', '#4d7c0f', '#0369a1'];
    wss.on('connection', socket => {
        let room = null, device = null;
        const consumeMessageBudget = createMessageBudget();
        const handshake = setTimeout(() => { if (!room) socket.close(1008, '未加入房间'); }, 10000);
        socket.on('error', () => {});
        socket.on('message', buffer => {
            try {
                const data = JSON.parse(buffer.toString());
                if (data.type === 'room.join') {
                    if (room) { send(socket, { type: 'error', message: '已加入房间' }); return; }
                    const code = String(data.room || '').toUpperCase();
                    const role = ['viewer', 'sensor'].includes(data.role) ? data.role : 'source';
                    if (code && (!/^[A-Z0-9]{8}$/.test(code)
                        || (code !== FIXED_SENSOR_ROOM && !rooms.has(code)))) throw new Error('房间不存在，请使用电脑生成的链接');
                    if (role === 'sensor' && code !== FIXED_SENSOR_ROOM) throw new Error('原生传感器只能加入固定房间');
                    const selected = code || randomBytes(4).toString('hex').toUpperCase();
                    if (!rooms.has(selected) && rooms.size >= 64) throw new Error('测试房间已满');
                    room = rooms.get(selected) || { code: selected, clients: new Set(), devices: new Map(), lastActive: Date.now() };
                    if (room.clients.size >= 24) { room = null; throw new Error('房间连接已满'); }
                    if (role === 'sensor' && [...room.devices.values()].some(item => item.role === 'sensor' && item.online)) {
                        room = null; throw new Error('固定房间已有在线原生传感器');
                    }
                    if (role !== 'viewer' && room.devices.size >= 12) { room = null; throw new Error('房间设备已满'); }
                    rooms.set(selected, room); room.clients.add(socket); room.lastActive = Date.now();
                    if (role !== 'viewer') {
                        device = { id: randomUUID(), generation: ++generation, role, label: String(data.label || '输入设备').slice(0, 32),
                            color: colors[room.devices.size % colors.length], online: true, frame: null, sample: null, realtime: [],
                            estimatedTrail: [], referenceTrail: [], current: null, lastFrameAt: null,
                            sequence: -1, lastActive: Date.now() };
                        room.devices.set(device.id, device);
                    }
                    clearTimeout(handshake);
                    send(socket, { type: 'room.joined', room: selected, device: device && summary(device),
                        devices: [...room.devices.values()].map(summary) });
                    if (device) broadcast(room, { type: 'device.update', device: summary(device) });
                    return;
                }
                if (!room || !device) throw new Error('消息类型或输入身份无效');
                if (data.deviceId !== device.id || data.generation !== device.generation) throw new Error('设备会话不匹配');
                if (!Number.isSafeInteger(data.sequence) || data.sequence <= device.sequence) throw new Error('样本顺序无效');
                if (data.type === 'imu.trajectory.snapshot' && device.role === 'source') {
                    const estimatedTrail = normalizeTrail(data.estimatedTrail);
                    const referenceTrail = normalizeTrail(data.referenceTrail);
                    if (!estimatedTrail || !referenceTrail || (data.clearHistory !== undefined && typeof data.clearHistory !== 'boolean')) {
                        throw new Error('轨迹快照无效');
                    }
                    const now = Date.now();
                    device.sequence = data.sequence; device.lastActive = now; room.lastActive = now;
                    device.estimatedTrail = estimatedTrail; device.referenceTrail = referenceTrail;
                    if (data.clearHistory === true) device.realtime = [];
                    return;
                }
                if (['imu.sample', 'imu.samples'].includes(data.type) && device.role === 'sensor') {
                    const incoming = data.type === 'imu.sample' ? [data.sample] : data.samples;
                    if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > SAMPLE_BATCH_LIMIT) {
                        debug.invalid += 1; throw new Error('六轴样本批次无效');
                    }
                    const samples = incoming.map(normalizeSample);
                    if (samples.some(sample => !sample)) { debug.invalid += 1; throw new Error('六轴样本无效'); }
                    let previousTime = device.sample?.time ?? -1;
                    for (const sample of samples) {
                        if (sample.time <= previousTime) throw new Error('源时间未递增');
                        previousTime = sample.time;
                    }
                    const now = Date.now();
                    if (!consumeMessageBudget(now)) throw new Error('采样频率超过服务端限制');
                    device.sequence = data.sequence; device.sample = samples.at(-1); device.lastActive = now;
                    room.lastActive = now; debug.received += samples.length; debug.lastReceiveAt = now;
                    debug.recentMessageAt.push(now);
                    for (const [sampleIndex, sample] of samples.entries()) {
                        debug.recentReceiveAt.push(now);
                        debugSamples.push({ receivedAt: now, deviceId: device.id,
                            sequence: data.sequence, sampleIndex, sample });
                    }
                    while (debug.recentReceiveAt.length > 250) debug.recentReceiveAt.shift();
                    while (debug.recentMessageAt.length > 150) debug.recentMessageAt.shift();
                    while (debugSamples.length > SAMPLE_RING_LIMIT) debugSamples.shift();
                    debug.lastError = null;
                    const payload = { type: data.type === 'imu.sample' ? 'sensor.sample' : 'sensor.samples',
                        room: room.code, device: summary(device), sequence: data.sequence };
                    if (data.type === 'imu.sample') payload.sample = samples[0];
                    else payload.samples = samples;
                    broadcast(room, payload);
                    return;
                }
                if (data.type !== 'imu.frame' || device.role !== 'source') throw new Error('消息类型或输入身份无效');
                const frame = normalizeFrame(data.frame);
                if (!frame) throw new Error('位姿或六轴数据无效');
                if (device.frame && frame.time < device.frame.time) throw new Error('源时间回退');
                const hasEstimatedTrailDelta = Object.hasOwn(data, 'estimatedTrailDelta');
                const hasReferenceTrailDelta = Object.hasOwn(data, 'referenceTrailDelta');
                const estimatedTrailDelta = hasEstimatedTrailDelta ? normalizeTrail(data.estimatedTrailDelta) : null;
                const referenceTrailDelta = hasReferenceTrailDelta ? normalizeTrail(data.referenceTrailDelta) : null;
                if (hasEstimatedTrailDelta && !estimatedTrailDelta || hasReferenceTrailDelta && !referenceTrailDelta) {
                    throw new Error('轨迹增量无效');
                }
                let referencePosition = null;
                if (data.referencePosition !== undefined && data.referencePosition !== null) {
                    if (!array(data.referencePosition, 3, 1e5)) throw new Error('模拟参考位置无效');
                    referencePosition = [...data.referencePosition];
                }
                const now = Date.now();
                // 位姿帧按同一50Hz平均预算接受；短时定时抖动由令牌余量吸收。
                if (!consumeMessageBudget(now)) return;
                const point = { receivedAt: now, sequence: data.sequence, time: frame.time, position: frame.position,
                    velocity: frame.velocity, quaternion: frame.quaternion };
                // 保存同一帧的测量及处理状态，回看反向运动时可检查加速度与零速修正，不能用最新帧替代历史值。
                for (const key of ['rawGyro', 'rawAccel', 'gyro', 'linear', 'gyroBias',
                    'gyroCalibrated', 'accelCalibrated', 'calibrationActive', 'faces', 'zeroCorrections', 'status', 'message']) {
                    point[key] = Array.isArray(frame[key]) ? [...frame[key]] : frame[key];
                }
                // 模拟参考位置只进入本机诊断轨迹，不能混入设备位姿或房间广播。
                if (referencePosition) {
                    const positionError = frame.position.map((value, index) => value - referencePosition[index]);
                    point.referencePosition = referencePosition;
                    point.positionError = positionError;
                    point.positionErrorTotal = Math.hypot(...positionError);
                }
                device.sequence = data.sequence; device.frame = frame; device.current = point; device.lastFrameAt = now;
                device.lastActive = now; room.lastActive = now;
                if (estimatedTrailDelta) appendTrail(device.estimatedTrail, estimatedTrailDelta);
                else if (moved(device.estimatedTrail.at(-1), frame.position)) appendTrail(device.estimatedTrail, [frame.position]);
                if (referenceTrailDelta) appendTrail(device.referenceTrail, referenceTrailDelta);
                else if (referencePosition && moved(device.referenceTrail.at(-1), referencePosition)) {
                    appendTrail(device.referenceTrail, [referencePosition]);
                }
                device.realtime.push(point);
                if (device.realtime.length > TRAJECTORY_RING_LIMIT) device.realtime.shift();
                broadcast(room, { type: 'device.update', device: summary(device) });
            } catch (error) {
                if (device?.role === 'sensor') { debug.rejected += 1; debug.lastError = String(error.message || '消息处理失败').slice(0, 120); }
                send(socket, { type: 'error', message: error.message || '消息处理失败' });
            }
        });
        socket.on('close', () => {
            clearTimeout(handshake);
            if (!room) return;
            room.clients.delete(socket); room.lastActive = Date.now();
            if (device) { device.online = false; device.lastActive = Date.now(); broadcast(room, { type: 'device.update', device: summary(device) }); }
        });
    });
    const sweep = setInterval(() => {
        for (const [code, room] of rooms) {
            if (!room.clients.size && Date.now() - room.lastActive > 120000) rooms.delete(code);
            for (const [id, device] of room.devices) if (!device.online && Date.now() - device.lastActive > 30000) room.devices.delete(id);
        }
    }, 10000);
    sweep.unref();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 8769, options.host ?? '0.0.0.0', resolve); });
    return { server, rooms, debugSamples, debug, port: server.address().port, async close() {
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
