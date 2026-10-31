'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../3rd/imu-six-axis-test/imu-engine.mjs'), import('three'),
    import('../3rd/imu-six-axis-test/server.mjs')]);
const ideal = { gyroDeadZone: 0, accelDeadZone: 0, filterHz: 0, tiltGain: 0, magneticAssist: false };
const paired = sample => ({ ...sample, accelBeforeTime: Math.max(0, sample.time - .01), accelAfterTime: sample.time + .01 });
const norm = values => Math.hypot(...values);
const near = (actual, expected, tolerance = 1e-8) => assert.ok(norm(actual.map((v, i) => v - expected[i])) < tolerance,
    `实际${actual}，期望${expected}`);

test('25/50/100Hz瞬时恒速旋转按端点去重力，保留无元数据的原区间路径', async () => {
    const [{ ImuEngine, GRAVITY }, { Quaternion, Vector3 }] = await modules;
    for (const hz of [25, 50, 100]) {
        const engine = new ImuEngine(ideal), old = new ImuEngine(ideal);
        const axis = new Vector3(1, 0, 0); let maximum = 0;
        for (let i = 0; i <= hz * 2; i += 1) {
            const time = i / hz, truth = new Quaternion().setFromAxisAngle(axis, 7 * time);
            const sample = { time, gyro: [7, 0, 0], kind: 'gravity',
                accel: new Vector3(0, GRAVITY, 0).applyQuaternion(truth.clone().invert()).toArray() };
            engine.push(paired(sample)); old.push(sample);
            maximum = Math.max(maximum, norm(engine.snapshot().linear));
            assert.ok(engine.q.angleTo(truth) < 1e-6);
        }
        assert.ok(maximum < 1e-10); assert.ok(norm(engine.snapshot().position) < 1e-10);
        assert.ok(norm(old.snapshot().position) > .6, '旧区间约定仍按原算法，不能用静稳/限速掩盖时序差异');
        assert.equal(engine.snapshot().integration.convention, 'instantaneous');
        assert.equal(old.snapshot().integration.convention, 'interval');
        assert.equal(engine.zeroCorrections, 0);
    }
});

test('从零平滑角速度按前后源观测传播，姿态对齐当前帧而非领先半步', async () => {
    const [{ ImuEngine, GRAVITY }, { Quaternion, Vector3 }] = await modules;
    for (const hz of [25, 50, 100]) {
        const engine = new ImuEngine(ideal); let maximumAngle = 0;
        for (let i = 0; i <= hz * 2; i += 1) {
            const time = i / hz, angle = 14 / Math.PI * (1 - Math.cos(Math.PI * time / 2));
            const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
            engine.push(paired({ time, kind: 'gravity', gyro: [7 * Math.sin(Math.PI * time / 2), 0, 0],
                accel: new Vector3(0, GRAVITY, 0).applyQuaternion(q.clone().invert()).toArray() }));
            maximumAngle = Math.max(maximumAngle, engine.q.angleTo(q));
        }
        assert.ok(maximumAngle * 180 / Math.PI < .05 * (50 / hz) ** 2);
    }
});

/** 独立解析姿态及其机体系导数；不调用产品rotationStep来构造真值。 */
function multiAxis(time, Quaternion, Vector3) {
    const frequency = 2 * Math.PI * 1.5;
    const x = new Vector3(1, 0, 0), y = new Vector3(0, 1, 0), z = new Vector3(0, 0, 1);
    const qx = new Quaternion().setFromAxisAngle(x, .4 * Math.sin(frequency * time));
    const qy = new Quaternion().setFromAxisAngle(y, .35 * Math.sin(.7 * frequency * time));
    const qz = new Quaternion().setFromAxisAngle(z, .25 * Math.sin(1.3 * frequency * time));
    const rate = x.clone().multiplyScalar(.4 * frequency * Math.cos(frequency * time)).applyQuaternion(qy.clone().multiply(qz).invert())
        .add(y.clone().multiplyScalar(.35 * .7 * frequency * Math.cos(.7 * frequency * time)).applyQuaternion(qz.clone().invert()))
        .addScaledVector(z, .25 * 1.3 * frequency * Math.cos(1.3 * frequency * time));
    return { quaternion: qx.multiply(qy).multiply(qz), rate };
}

test('解析快速多轴旋转含时间抖动，二样本交叉传播减少运动中虚假位移', async () => {
    const [{ ImuEngine, GRAVITY }, { Quaternion, Vector3 }] = await modules;
    for (const hz of [25, 50, 100]) {
        const engine = new ImuEngine(ideal), old = new ImuEngine(ideal);
        let maxAngle = 0;
        for (let i = 0; i <= hz * 10; i += 1) {
            const time = i / hz + (i ? .05 * Math.sin(i * 1.1) / hz : 0);
            const { quaternion, rate } = multiAxis(time, Quaternion, Vector3);
            const sample = { time, kind: 'gravity', gyro: rate.toArray(),
                accel: new Vector3(0, GRAVITY, 0).applyQuaternion(quaternion.clone().invert()).toArray() };
            engine.push(paired(sample)); old.push(sample);
            maxAngle = Math.max(maxAngle, engine.q.angleTo(quaternion));
        }
        assert.ok(engine.p.length() < old.p.length() * .1);
        assert.ok(maxAngle * 180 / Math.PI < 1.2 * (25 / hz) ** 2);
        assert.equal(engine.zeroCorrections, 0, '纯数值改善不能依赖零速修正');
        assert.ok(engine.p.length() > 0, '有限频率解析多轴仍有数值残差，不声称完全无误差');
    }
});

test('瞬时旋转加平移双支路按同一源时间积分，保留初速度和线性加速度', async () => {
    const [{ ImuEngine, GRAVITY }, { Quaternion, Vector3 }] = await modules;
    for (const hz of [25, 50, 100]) for (const denoiseEnabled of [false, true]) {
        const engine = new ImuEngine({ ...ideal, denoiseEnabled });
        const initial = [.15, .2, -.1], slope = [.3, -.2, .1]; engine.v.fromArray(initial);
        for (let i = 0; i <= hz * 3; i += 1) {
            const time = i / hz + (i ? .1 * Math.sin(i * 2.1) / hz : 0);
            const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 3 * time);
            const force = new Vector3(slope[0] * time, GRAVITY + slope[1] * time, slope[2] * time)
                .applyQuaternion(q.clone().invert()).toArray();
            engine.push(paired({ time, kind: 'gravity', gyro: [3, 0, 0], accel: force }));
            const frame = engine.snapshot(), t = frame.time;
            if (denoiseEnabled && frame.denoise.state === 'warming') continue;
            near(frame.position, initial.map((v, axis) => v * t + slope[axis] * t ** 3 / 6));
            near(frame.velocity, initial.map((v, axis) => v + slope[axis] * t * t / 2));
            assert.equal(frame.integration.time, frame.time);
            assert.equal(frame.integration.convention, 'instantaneous');
        }
    }
});

test('端点真实单样本脉冲保持冲量，低加速度匀速不被新积分清零', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    for (const denoiseEnabled of [false, true]) {
        const engine = new ImuEngine({ ...ideal, denoiseEnabled });
        for (let i = 0; i <= 200; i += 1) engine.push(paired({ time: i / 50, kind: 'gravity', gyro: [0, 0, 0],
            accel: [i === 100 ? 4 : 0, GRAVITY, 0] }));
        const frame = engine.snapshot(); near(frame.velocity, [.08, 0, 0]);
        assert.ok(Math.abs(frame.position[0] - .08 * (frame.time - 2)) < 1e-8);
        assert.equal(frame.zeroCorrections, 0);
    }
});

test('预积分生命周期不跨暂停/断流/重置/校准/参数与采样约定切换', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const sample = (time, ax = 0) => paired({ time, kind: 'gravity', gyro: [0, 0, 0], accel: [ax, GRAVITY, 0] });
    for (const denoiseEnabled of [false, true]) {
        const engine = new ImuEngine({ ...ideal, denoiseEnabled });
        // 已知初始姿态用于隔离前值生命周期；不能用带平移的首帧反推重力方向。
        engine.q.identity(); engine.initialized = true;
        for (let i = 0; i <= 60; i += 1) engine.push(sample(i / 50, 2));
        const before = engine.snapshot(); engine.pause(); engine.push(sample(10));
        near(engine.snapshot().position, before.position); assert.equal(engine.preintegration.state, 'priming');
        for (let i = 1; i <= 40; i += 1) engine.push(sample(10 + i / 50));
        near(engine.snapshot().position, before.position); near(engine.snapshot().velocity, [0, 0, 0]);
        engine.push(sample(12)); assert.equal(engine.snapshot().status, 'gap');
        assert.equal(engine.preintegration.previousAcceleration, null);
        for (const action of [() => engine.resetHeading(), () => engine.resetOrigin(), () => engine.stopVelocity(),
            () => engine.beginCalibration(), () => engine.beginDeadzoneCalibration(),
            () => { engine.profile.filterHz = 5; engine.configureDenoise(); }]) {
            action(); assert.equal(engine.preintegration.previousRate, null); assert.equal(engine.preintegration.previousAcceleration, null);
            assert.equal(engine.denoiser.preintegration.previousAcceleration, null);
        }
        engine.cancelDeadzoneCalibration();
        engine.push(sample(12.02));
        const lastPosition = engine.p.toArray(), legacy = sample(12.04);
        delete legacy.accelBeforeTime; delete legacy.accelAfterTime;
        engine.push(legacy); near(engine.p.toArray(), lastPosition);
        assert.equal(engine.preintegration.convention, 'interval');
        assert.ok(engine.denoiser.entries.length <= 1);
        const count = engine.samples;
        assert.equal(engine.push({ ...sample(12.06), accelAfterTime: undefined }), false);
        assert.equal(engine.samples, count);
    }
});

test('瞬时支路磁场按观测时刻处理，真实航向加速不冻结或产生平移', async () => {
    const [{ ImuEngine, GRAVITY }, { Quaternion, Vector3 }] = await modules;
    const engine = new ImuEngine({ ...ideal, magneticAssist: true });
    const pose = t => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .2 * Math.max(0, t - 1) ** 2);
    for (let i = 0; i <= 200; i += 1) {
        const time = i / 50, magneticTime = Math.max(0, time - .015);
        engine.push(paired({ time, kind: 'gravity', gyro: [0, .4 * Math.max(0, time - 1), 0], accel: [0, GRAVITY, 0],
            magneticAvailable: true, magnetic: { time: magneticTime, accuracy: 3,
                field: new Vector3(20, 30, -40).applyQuaternion(pose(magneticTime).invert()).toArray() } }));
    }
    assert.equal(engine.snapshot().magnetic.state, 'active');
    assert.ok(engine.q.angleTo(pose(4)) < .001); near(engine.p.toArray(), [0, 0, 0]);
});

test('瞬时快停后重新缓动撤销旧静稳并恢复积分', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine({ ...ideal, denoiseEnabled: true, remoteAutoRest: true });
    let seenFast = false;
    for (let i = 0; i <= 165; i += 1) {
        const time = i / 50, ax = time < .5 ? 2 : time < .7 ? -1 : time < 2.8 ? 0 : .2;
        engine.push(paired({ time, kind: 'gravity', gyro: [0, 0, 0], accel: [ax, GRAVITY, 0] }));
        // 第一帧加速不能用于初始化倾斜：本算例明确提供独立已知初始姿态。
        if (i === 0) engine.q.identity();
        seenFast ||= engine.snapshot().stopRecovery.active;
        if (i === 140) assert.equal(engine.remoteRestActive, false);
    }
    assert.ok(seenFast); assert.equal(engine.snapshot().stopRecovery.active, false);
    assert.ok(engine.snapshot().velocity[0] > .03);
    assert.equal(engine.snapshot().integration.convention, 'instantaneous');
});

test('积分诊断同帧源时间白名单校验、旧帧兼容与独立静态路由', async t => {
    const [{ ImuEngine }, , { normalizeFrame, createLabServer }] = await modules;
    const frame = new ImuEngine().snapshot();
    assert.deepEqual(normalizeFrame(frame).integration, frame.integration);
    const old = { ...frame }; delete old.integration; assert.ok(normalizeFrame(old));
    for (const patch of [{ convention: 'guess' }, { state: 'guess' }, { time: .02 }, { time: NaN }, { dt: -1 }, { dt: Infinity }]) {
        assert.equal(normalizeFrame({ ...frame, integration: { ...frame.integration, ...patch } }), null);
    }
    assert.equal(Object.hasOwn(normalizeFrame({ ...frame, integration: { ...frame.integration, unknown: 1 } }).integration, 'unknown'), false);
    const service = await createLabServer({ port: 0, host: '127.0.0.1' }); t.after(() => service.close());
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/imu-preintegration.mjs`)).status, 200);
});
