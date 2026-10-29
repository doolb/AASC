'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../3rd/imu-six-axis-test/imu-engine.mjs'), import('three')]);
const profile = { denoiseEnabled: true, denoiseLagMs: 300, gyroDeadZone: 0, accelDeadZone: 0,
    filterHz: 0, tiltGain: 0, magneticAssist: false };
const sample = (time, accel = [0, 9.80665, 0], gyro = [0, 0, 0]) => ({ time, kind: 'gravity', accel, gyro });
const std = values => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};

test('25/50/100Hz固定延迟按源时间输出，同步姿态/原始测量且缓存有界', async () => {
    const [{ ImuEngine }] = await modules;
    for (const hz of [25, 50, 100]) {
        const engine = new ImuEngine(profile);
        let previous = -1;
        for (let index = 0; index <= hz * 4; index += 1) {
            const time = index / hz;
            engine.push(sample(time, [.1 * time, 9.80665, 0]));
            const frame = engine.snapshot();
            if (time < .3) { assert.equal(frame.denoise.state, 'warming'); assert.equal(frame.denoise.actualLagMs, null); continue; }
            assert.ok(frame.time >= previous); previous = frame.time;
            assert.ok(frame.denoise.actualLagMs >= 300 - 1e-6 && frame.denoise.actualLagMs < 300 + 1000 / hz + 1e-6);
            assert.ok(Math.abs(frame.rawAccel[0] - .1 * frame.time) < 1e-12);
            assert.ok(frame.denoise.queuedSamples <= 2 * hz + 1);
            assert.ok(Math.abs(Math.hypot(...frame.quaternion) - 1) < 1e-12);
        }
    }
});

test('随机噪声标准差降低，保留加速度直流均值且不新增零速修正', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine(profile), off = new ImuEngine({ ...profile, denoiseEnabled: false });
    let seed = 5937;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
    const raw = [], clean = [];
    for (let index = 0; index <= 1500; index += 1) {
        const s = sample(index / 50, index ? [.1 + random() * .16, 9.80665 + random() * .16, random() * .16] : [0, 9.80665, 0]);
        engine.push(s); off.push(s);
        if (index > 100) { raw.push(off.snapshot().linear[0]); clean.push(engine.snapshot().linear[0]); }
    }
    assert.ok(std(clean) < std(raw) * .5, `降噪不足：${std(clean)}/${std(raw)}`);
    assert.ok(Math.abs(clean.reduce((a, b) => a + b, 0) / clean.length - .1) < .005, '不能把持续线性加速当成噪声去掉');
    assert.equal(engine.snapshot().zeroCorrections, 0);
    assert.ok(engine.snapshot().velocity[0] > 2.5, '不能靠清速或限速伪造改善');
});

test('启停阶跃与单样本真实脉冲保留峰值和速度积分，不摊到邻段', async () => {
    const [{ ImuEngine }] = await modules;
    for (const pulse of [false, true]) {
        const engine = new ImuEngine(profile), output = [];
        for (let index = 0; index <= 350; index += 1) {
            const force = pulse ? index === 100 ? 4 : 0 : index >= 100 && index < 150 ? 1 : 0;
            engine.push(sample(index / 50, [force, 9.80665, 0]));
            const frame = engine.snapshot(); if (frame.time >= 1.8 && frame.time <= 3.2) output.push(frame);
        }
        assert.ok(Math.abs(Math.max(...output.map(f => f.linear[0])) - (pulse ? 4 : 1)) < 1e-8);
        assert.ok(Math.abs(engine.snapshot().velocity[0] - (pulse ? .08 : 1)) < 1e-8);
        if (pulse) assert.ok(output.filter(f => f.rawAccel[0] === 0).every(f => Math.abs(f.linear[0]) < 1e-10));
    }
});

test('纯旋转与往返平移按延迟真值比较，保留动作幅度与位移', async () => {
    const [{ ImuEngine }, { Quaternion, Vector3 }] = await modules;
    const engine = new ImuEngine(profile), axis = new Vector3(0, 1, 0), poses = new Map();
    const positions = new Map(); let p = 0, v = 0;
    for (let index = 0; index <= 600; index += 1) {
        const time = index / 100, pose = new Quaternion().setFromAxisAngle(axis, .6 * time);
        const a = time >= 1 && time < 2 ? 1 : time >= 2 && time < 3 ? -1 : time >= 3 && time < 4 ? -1 : time >= 4 && time < 5 ? 1 : 0;
        if (index) { p += v * .01 + .5 * a * .0001; v += a * .01; }
        positions.set(index, p); poses.set(index, pose);
        const force = new Vector3(a, 9.80665, 0).applyQuaternion(pose.clone().invert()).toArray();
        engine.push(sample(time, force, [0, .6, 0]));
        const frame = engine.snapshot();
        if (time > .6) {
            const outputIndex = Math.round(frame.time * 100);
            assert.ok(new Quaternion().fromArray(frame.quaternion).angleTo(poses.get(outputIndex)) < 1e-6);
            assert.ok(Math.abs(frame.position[0] - positions.get(outputIndex)) < .015);
            assert.ok(Math.abs(frame.position[1]) < 1e-6 && Math.abs(frame.position[2]) < .015);
        }
    }
    assert.ok(Math.abs(engine.snapshot().position[0]) < .015);
});

test('抖动和多样本批次不重复积分，缺口清未来窗口且冻结已显示位置', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine(profile);
    let time = 0;
    engine.push(sample(0));
    for (let index = 0; index < 200; index += 1) {
        time += index % 2 ? .012 : .028; engine.push(sample(time, [1, 9.80665, 0]));
    }
    const before = engine.snapshot();
    engine.pause(); assert.deepEqual(engine.snapshot().position, before.position);
    assert.deepEqual(engine.snapshot().quaternion, before.quaternion);
    assert.equal(engine.snapshot().time, before.time);
    assert.deepEqual(engine.snapshot().velocity, [0, 0, 0]);
    time += 1; engine.push(sample(time));
    assert.equal(engine.snapshot().denoise.state, 'warming');
    assert.deepEqual(engine.snapshot().position, before.position);
    for (let i = 0; i < 30; i += 1) { time += .02; engine.push(sample(time)); }
    assert.ok(engine.snapshot().time > before.time);
    assert.ok(difference(engine.snapshot().position, before.position) < 1e-8);
    assert.equal(engine.push(sample(time)), false);
});

const difference = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

test('原点/航向/参数/模式改变清缓存，关闭时恢复原路径且不回退时间', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine(profile);
    for (let index = 0; index <= 100; index += 1) engine.push(sample(index / 50, [.3, 9.80665, 0]));
    engine.resetOrigin(); assert.deepEqual(engine.snapshot().position, [0, 0, 0]);
    assert.equal(engine.snapshot().denoise.queuedSamples, 0);
    engine.resetHeading(); assert.equal(engine.snapshot().denoise.queuedSamples, 0);
    engine.profile.denoiseLagMs = 500; engine.configureDenoise();
    for (let index = 101; index <= 150; index += 1) engine.push(sample(index / 50));
    assert.ok(Math.abs(engine.snapshot().denoise.actualLagMs - 500) < 1e-6);
    const before = engine.snapshot();
    engine.profile.denoiseEnabled = false; engine.configureDenoise();
    assert.equal(engine.snapshot().denoise.state, 'disabled');
    assert.ok(engine.snapshot().time >= before.time);
    assert.deepEqual(engine.snapshot().position, before.position);
    engine.profile.denoiseEnabled = true; engine.configureDenoise(); engine.resetExperiment();
    assert.deepEqual(engine.snapshot().position, [0, 0, 0]); assert.equal(engine.snapshot().denoise.queuedSamples, 0);
});

test('死区校准继续用原始噪声，不学习被多帧滤小的噪声', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine(profile), off = new ImuEngine({ ...profile, denoiseEnabled: false });
    engine.beginDeadzoneCalibration(); off.beginDeadzoneCalibration();
    for (let i = 0; i <= 160; i += 1) {
        const s = sample(i / 50, [.1 * Math.sin(i), 9.80665, .1 * Math.cos(i)], [.02 * Math.sin(i), 0, 0]);
        engine.push(s); off.push(s);
    }
    assert.equal(engine.profile.gyroDeadZone, off.profile.gyroDeadZone);
    assert.equal(engine.profile.accelDeadZone, off.profile.accelDeadZone);
    assert.deepEqual(engine.restNoise, off.restNoise);
    assert.equal(engine.snapshot().denoise.state, 'warming');
});

test('快速往复旋转跨越四元数正负半球仍跟随延迟真值，不削平转向峰值', async () => {
    const [{ ImuEngine }, { Quaternion, Vector3 }] = await modules;
    const engine = new ImuEngine(profile), axis = new Vector3(0, 1, 0);
    const poses = new Map(); let previousYaw = 0;
    for (let index = 0; index <= 1000; index += 1) {
        const yaw = 3.5 * Math.sin(index / 100 * Math.PI);
        poses.set(index, new Quaternion().setFromAxisAngle(axis, yaw));
        engine.push(sample(index / 100, [0, 9.80665, 0], [0, index ? (yaw - previousYaw) * 100 : 0, 0]));
        previousYaw = yaw;
        const frame = engine.snapshot();
        if (index > 100) {
            assert.ok(new Quaternion().fromArray(frame.quaternion).angleTo(poses.get(Math.round(frame.time * 100))) < .01);
        }
    }
});
