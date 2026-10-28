'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

function client(port) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/room`), queue = [], waiting = [];
    socket.on('message', bytes => { const message = JSON.parse(bytes); const index = waiting.findIndex(entry => entry.type === message.type);
        if (index < 0) queue.push(message); else { const [entry] = waiting.splice(index, 1); clearTimeout(entry.timer); entry.resolve(message); } });
    return { socket, ready: new Promise(resolve => socket.once('open', resolve)), send: data => socket.send(JSON.stringify(data)),
        take(type) { const index = queue.findIndex(message => message.type === type); if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
            return new Promise((resolve, reject) => { const entry = { type, resolve, timer: setTimeout(() => {
                waiting.splice(waiting.indexOf(entry), 1); reject(new Error(`等待 ${type} 超时`)); }, 4000) }; waiting.push(entry); }); } };
}

test('真实WebSocket多设备同房间广播、晚加入快照、所有权、顺序和断线', async t => {
    const { createLabServer } = await import('../3rd/imu-six-axis-test/server.mjs');
    const { ImuEngine } = await import('../3rd/imu-six-axis-test/imu-engine.mjs');
    const service = await createLabServer({ port: 0, host: '127.0.0.1' }); t.after(() => service.close());
    const first = client(service.port), second = client(service.port); await Promise.all([first.ready, second.ready]);
    first.send({ type: 'room.join', label: '模拟器' }); const joined = await first.take('room.joined');
    await first.take('device.update');
    second.send({ type: 'room.join', room: joined.room, label: '手机' }); const phone = await second.take('room.joined');
    await first.take('device.update'); await second.take('device.update');
    const frame = new ImuEngine().snapshot();
    first.send({ type: 'imu.frame', deviceId: joined.device.id, generation: joined.device.generation, sequence: 1, frame });
    const remote = await second.take('device.update'); await first.take('device.update');
    assert.equal(remote.device.id, joined.device.id); assert.deepEqual(remote.device.frame.position, frame.position);
    // 两个不同诊断帧应按时间保存，最新值不能覆盖上一帧。
    await new Promise(resolve => setTimeout(resolve, 20));
    const next = { ...frame, time: 1, rawAccel: [1, 2, 3], linear: [-1, 0, 0], zeroCorrections: 7 };
    first.send({ type: 'imu.frame', deviceId: joined.device.id, generation: joined.device.generation, sequence: 2, frame: next });
    await first.take('device.update'); await second.take('device.update');
    const history = await (await fetch(`http://127.0.0.1:${service.port}/api/imu/trajectory?room=${joined.room}`)).json();
    const recorded = history.devices.find(device => device.id === joined.device.id);
    assert.equal(recorded.points.length, 2);
    assert.deepEqual(recorded.points[0].rawAccel, frame.rawAccel);
    assert.deepEqual(recorded.points[1].rawAccel, next.rawAccel);
    assert.deepEqual(recorded.current.linear, next.linear);
    assert.equal(recorded.current.zeroCorrections, 7);
    assert.deepEqual(recorded.current.magnetic, frame.magnetic);
    assert.deepEqual(recorded.points[0].magnetic, frame.magnetic);
    assert.equal(Object.hasOwn(recorded.current, 'platformLinear'), false);
    second.send({ type: 'imu.frame', deviceId: joined.device.id, generation: phone.device.generation, sequence: 1, frame });
    assert.match((await second.take('error')).message, /会话/);
    first.send({ type: 'imu.frame', deviceId: joined.device.id, generation: joined.device.generation, sequence: 1, frame });
    assert.match((await first.take('error')).message, /顺序/);
    const observer = client(service.port); await observer.ready;
    observer.send({ type: 'room.join', room: joined.room, role: 'viewer' }); const snapshot = await observer.take('room.joined');
    assert.equal(snapshot.device, null); assert.deepEqual(snapshot.devices.find(device => device.id === joined.device.id).frame.position, frame.position);
    second.socket.close(); const offline = await observer.take('device.update'); assert.equal(offline.device.online, false);
    const response = await fetch(`http://127.0.0.1:${service.port}/vendor/TransformControls.js`); assert.equal(response.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/server.mjs`)).status, 404);
});

test('服务端接受旧APK附带的平台线性加速度但不回传或保存', async () => {
    const { normalizeFrame, normalizeSample } = await import('../3rd/imu-six-axis-test/server.mjs');
    const { ImuEngine } = await import('../3rd/imu-six-axis-test/imu-engine.mjs');
    const sample = normalizeSample({ time: 1, gyro: [0, 0, 0], accel: [0, 0, 9.8],
        kind: 'gravity', linearAccel: [0, 0, 0] });
    assert.ok(sample);
    assert.equal(Object.hasOwn(sample, 'linearAccel'), false);
    const frame = normalizeFrame({ ...new ImuEngine().snapshot(), platformLinear: [0, 0, 0] });
    assert.ok(frame);
    assert.equal(Object.hasOwn(frame, 'platformLinear'), false);
    const rounded = normalizeSample({ time: 10.25, gyro: [0, 0, 0], accel: [0, 0, 9.8],
        kind: 'gravity', accelBeforeTime: 10.2, accelAfterTime: 10.3 });
    assert.ok(rounded, '100ms硬件时间差不能因浮点舍入而被拒绝');
});

test('50Hz消息预算吸收短时抖动但限制长期平均速率', async () => {
    const { createMessageBudget } = await import('../3rd/imu-six-axis-test/server.mjs');
    const take = createMessageBudget(0);
    assert.deepEqual([take(0), take(0), take(0), take(0)], [true, true, true, false]);
    assert.equal(take(19), false);
    assert.equal(take(20), true);
    assert.equal(take(40), true);
    assert.equal(take(60), true);
    assert.equal(take(60), false);
});

test('原生六轴批次保留顺序和双传感器时间，非法批次不写入历史', async t => {
    const { createLabServer } = await import('../3rd/imu-six-axis-test/server.mjs');
    const service = await createLabServer({ port: 0, host: '127.0.0.1' }); t.after(() => service.close());
    const sensor = client(service.port), observer = client(service.port);
    await Promise.all([sensor.ready, observer.ready]);
    sensor.send({ type: 'room.join', room: 'AASCIMU1', role: 'sensor', label: '测试传感器' });
    const joined = await sensor.take('room.joined');
    observer.send({ type: 'room.join', room: 'AASCIMU1', role: 'viewer' });
    await observer.take('room.joined');
    const samples = [0, 1, 2].map(index => ({ time: 1 + index * 0.02,
        gyro: [index, 0, 0], accel: [0, 0, 9.8], kind: 'gravity',
        accelBeforeTime: 0.99 + index * 0.02, accelAfterTime: 1.01 + index * 0.02,
        ...(index === 2 ? { gap: true } : {}) }));
    sensor.send({ type: 'imu.samples', deviceId: joined.device.id,
        generation: joined.device.generation, sequence: 1, samples });
    const broadcast = await observer.take('sensor.samples');
    assert.deepEqual(broadcast.samples, samples);
    const response = await fetch(`http://127.0.0.1:${service.port}/api/imu/samples?limit=500`);
    const history = await response.json();
    assert.equal(history.samples.length, 3);
    const status = await (await fetch(`http://127.0.0.1:${service.port}/api/imu/status`)).json();
    assert.equal(status.sampleMessageRateHz, 1);
    assert.deepEqual(history.samples.map(item => item.sampleIndex), [0, 1, 2]);
    assert.deepEqual(history.samples.map(item => item.sample.time), samples.map(sample => sample.time));
    await new Promise(resolve => setTimeout(resolve, 20));
    sensor.send({ type: 'imu.samples', deviceId: joined.device.id,
        generation: joined.device.generation, sequence: 2,
        samples: [{ ...samples[2], time: 1.06, accelBeforeTime: 1.05, accelAfterTime: 1.07 },
            { ...samples[2], time: 1.05, accelBeforeTime: 1.04, accelAfterTime: 1.06 }] });
    assert.match((await sensor.take('error')).message, /递增/);
    const after = await (await fetch(`http://127.0.0.1:${service.port}/api/imu/samples?limit=500`)).json();
    assert.equal(after.samples.length, 3);
    await new Promise(resolve => setTimeout(resolve, 20));
    const legacy = { time: 1.08, gyro: [0, 0, 0], accel: [0, 0, 9.8], kind: 'gravity' };
    sensor.send({ type: 'imu.sample', deviceId: joined.device.id,
        generation: joined.device.generation, sequence: 2, sample: legacy });
    assert.deepEqual((await observer.take('sensor.sample')).sample, legacy);
    const compatible = await (await fetch(`http://127.0.0.1:${service.port}/api/imu/samples?limit=500`)).json();
    assert.equal(compatible.samples.length, 4);
    sensor.socket.close(); observer.socket.close();
});

test('处理参数与重力静稳诊断仅转发白名单，旧帧兼容且非法值被拒绝', async () => {
    const { normalizeFrame } = await import('../3rd/imu-six-axis-test/server.mjs');
    const { ImuEngine } = await import('../3rd/imu-six-axis-test/imu-engine.mjs');
    const engine = new ImuEngine({ remoteAutoRest: true, gyroDeadZone: 0.39 });
    for (let i = 0; i <= 60; i++) engine.push({ time: i * 0.04, kind: 'gravity',
        gyro: [0, 0, 0], accel: [-1.4, 1.1, 9.5] });
    const frame = engine.snapshot(), normalized = normalizeFrame(frame);
    for (const key of ['profile', 'attitudeGyro', 'gravityMagnitude', 'gravityDirectionErrorDegrees', 'remoteRestActive', 'remoteRest']) {
        assert.deepEqual(normalized[key], frame[key]);
    }
    const legacy = { ...frame };
    for (const key of ['profile', 'attitudeGyro', 'gravityMagnitude', 'gravityDirectionErrorDegrees', 'remoteRestActive', 'remoteRest']) delete legacy[key];
    assert.ok(normalizeFrame(legacy)); assert.equal(Object.hasOwn(normalizeFrame(legacy), 'profile'), false);
    for (const patch of [
        { attitudeGyro: [0, NaN, 0] }, { gravityMagnitude: Infinity }, { gravityDirectionErrorDegrees: -1 },
        { remoteRestActive: 'true' }, { profile: [] }, { profile: { gyroDeadZone: -1 } },
        { profile: { remoteAutoRest: 1 } }, { remoteRest: { ...frame.remoteRest, state: 'unknown' } },
        { remoteRest: { ...frame.remoteRest, gyroRms: NaN } }
    ]) assert.equal(normalizeFrame({ ...frame, ...patch }), null);
    assert.equal(normalizeFrame({ ...frame, gravityDirectionErrorDegrees: null }).gravityDirectionErrorDegrees, null);
    assert.deepEqual(normalizeFrame({ ...frame, profile: { gyroDeadZone: 1000, ignored: 'never forward' } }).profile, { gyroDeadZone: 1000 });
});

test('静稳噪声诊断兼容旧帧，模型数组深拷贝且非法统计不会传播', async () => {
    const { normalizeFrame } = await import('../3rd/imu-six-axis-test/server.mjs');
    const { ImuEngine } = await import('../3rd/imu-six-axis-test/imu-engine.mjs');
    const frame = new ImuEngine({ remoteAutoRest: true }).snapshot();
    const restNoise = { gyroMean: [0.001, 0, 0], gyroDeviation: [0.06, 0.05, 0.03],
        forceVariation: 0.25, sampleCount: 151, sampleRateHz: 50 };
    const normalized = normalizeFrame({ ...frame, restNoise,
        remoteRest: { ...frame.remoteRest, noiseLearned: true, gyroMeanError: 0.01, gyroVariation: 0.08, gyroVariationLimit: 0.12 } });
    assert.deepEqual(normalized.restNoise, restNoise); assert.equal(normalized.remoteRest.noiseLearned, true);
    normalized.restNoise.gyroMean[0] = 99; assert.equal(restNoise.gyroMean[0], 0.001);
    for (const patch of [{ gyroDeviation: [-1, 0, 0] }, { sampleCount: 3 }, { sampleRateHz: Infinity }, { forceVariation: NaN }]) {
        assert.equal(normalizeFrame({ ...frame, restNoise: { ...restNoise, ...patch } }), null);
    }
    assert.equal(normalizeFrame({ ...frame, remoteRest: { ...frame.remoteRest, noiseLearned: 'yes' } }), null);
    assert.equal(normalizeFrame({ ...frame, remoteRest: { ...frame.remoteRest, gyroMeanError: -1 } }), null);
    const old = { ...frame }; delete old.restNoise;
    for (const key of ['noiseLearned', 'gyroMeanError', 'gyroVariation', 'gyroVariationLimit']) delete old.remoteRest[key];
    assert.ok(normalizeFrame(old)); assert.equal(Object.hasOwn(normalizeFrame(old), 'restNoise'), false);
});

test('磁场可选观测与诊断严格校验、旧样本兼容、深拷贝和静态融合模块可加载', async t => {
    const { normalizeSample, normalizeFrame, createLabServer } = await import('../3rd/imu-six-axis-test/server.mjs');
    const { ImuEngine } = await import('../3rd/imu-six-axis-test/imu-engine.mjs');
    const raw = { time: 1, gyro: [0, 0, 0], accel: [0, 0, 9.80665], kind: 'gravity',
        magneticAvailable: true, magnetic: { field: [18, 35, -28], time: .98, accuracy: 3, unknown: 100 } };
    const normalized = normalizeSample(raw);
    assert.deepEqual(normalized.magnetic, { field: [18, 35, -28], time: .98, accuracy: 3 });
    normalized.magnetic.field[0] = 0; assert.equal(raw.magnetic.field[0], 18);
    for (const patch of [{ time: 1.1 }, { time: -1 }, { field: [1, 2] }, { field: [Infinity, 0, 0] },
        { field: [3000, 0, 0] }, { accuracy: -1 }, { accuracy: 4 }, { accuracy: 1.5 }, { accuracy: '3' }]) {
        assert.equal(normalizeSample({ ...raw, magnetic: { ...raw.magnetic, ...patch } }), null);
    }
    assert.equal(normalizeSample({ ...raw, magneticAvailable: 'yes' }), null);
    const legacy = { ...raw }; delete legacy.magnetic; delete legacy.magneticAvailable;
    assert.ok(normalizeSample(legacy)); assert.ok(normalizeSample({ ...legacy, magneticAvailable: false }));
    const frame = new ImuEngine().snapshot();
    assert.deepEqual(normalizeFrame(frame).magnetic, frame.magnetic);
    const oldFrame = { ...frame }; delete oldFrame.magnetic;
    assert.ok(normalizeFrame(oldFrame));
    for (const patch of [{ enabled: 1 }, { available: 1 }, { state: 'bad' }, { fieldMagnitude: NaN },
        { headingResidual: 181 }, { observationAge: -1 }, { reason: {} }, { gravityTrusted: 'yes' }, { accuracy: 4 }, { accuracy: '3' }]) {
        assert.equal(normalizeFrame({ ...frame, magnetic: { ...frame.magnetic, ...patch } }), null);
    }
    assert.equal(normalizeFrame({ ...frame, profile: { magneticAssist: 1 } }), null);
    const service = await createLabServer({ host: '127.0.0.1', port: 0 }); t.after(() => service.close());
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/imu-magnetic.mjs`)).status, 200);
});
