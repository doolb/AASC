'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../3rd/imu-six-axis-test/imu-engine.mjs'),
    import('../3rd/imu-six-axis-test/imu-conservative-denoise.mjs'), import('../3rd/imu-six-axis-test/server.mjs')]);
const norm = a => Math.hypot(...a);
const distance = (a, b) => norm(a.map((v, i) => v - b[i]));
const profile = { gyroDeadZone: 0, accelDeadZone: 0, filterHz: 0, tiltGain: 0, magneticAssist: false };
const native = (time, acceleration, gyro = [0, 0, 0]) => ({ time, kind: 'gravity', gyro,
    accel: [acceleration[0], 9.80665 + acceleration[1], acceleration[2]],
    accelBeforeTime: Math.max(0, time - .005), accelAfterTime: time + .005 });

test('24组合三轴往返与12Hz低通保留同一输入冲量及时间矩，高显示死区不截断运动', async () => {
    const [{ ImuEngine }] = await modules;
    for (const hz of [25, 50, 100]) for (const duration of [.8, 1, 1.2, 1.6]) for (const jitter of [false, true]) {
        for (const filterHz of [0, 12]) {
            const raw = new ImuEngine({ ...profile, filterHz });
            const smooth = new ImuEngine({ ...profile, filterHz, accelDeadZone: 1.33, denoiseEnabled: true });
            let maximum = 0;
            for (let i = 0; i <= hz * 5; i += 1) {
                const t = i / hz + (i && jitter ? .15 * Math.sin(i * 1.3) / hz : 0), s = t - 1, w = Math.PI / duration;
                const a = s >= 0 && s <= duration ? .3 * w * w * (2 * Math.cos(2 * w * s) - 2 * Math.cos(4 * w * s)) : 0;
                const sample = native(t, [a, -.35 * a, .2 * a]); raw.push(sample); smooth.push(sample);
                maximum = Math.max(maximum, smooth.snapshot().position[0]);
            }
            const frame = smooth.snapshot(), direct = raw.snapshot();
            // 已经过足够长的零输入尾段，用同一输出源时刻比较；抖动采样自身的残差不能被强行抹掉。
            const reference = direct.position.map((p, axis) => p - direct.velocity[axis] * (direct.time - frame.time));
            assert.ok(distance(frame.position, reference) < 1e-8, `${hz}Hz/${duration}s/${jitter}/${filterHz}Hz位置不守恒`);
            assert.ok(distance(frame.velocity, direct.velocity) < 1e-8);
            assert.equal(frame.zeroCorrections, 0);
            assert.ok(maximum > .27 && maximum < .32, '不能只保末点而把真实30cm动作压没');
            if (!jitter) { assert.ok(norm(frame.position) < 1e-8); assert.ok(norm(frame.velocity) < 1e-8); }
            assert.equal(frame.integration.time, frame.time);
            assert.ok(smooth.denoiser.entries.length < 2 * hz);
        }
    }
});

test('单向加速后的真实匀速及显示死区下慢动作保留，不自动拉回原点', async () => {
    const [{ ImuEngine }] = await modules;
    for (const denoiseEnabled of [false, true]) {
        const e = new ImuEngine({ ...profile, filterHz: 12, accelDeadZone: 5, denoiseEnabled });
        let distinct = false;
        for (let i = 0; i <= 250; i += 1) {
            e.push(native(i / 50, [i >= 50 && i < 100 ? .2 : 0, 0, 0]));
            const f = e.snapshot(); distinct ||= norm(f.linear) === 0 && norm(f.integrationAcceleration) > .05;
        }
        const f = e.snapshot(); assert.ok(distinct);
        assert.ok(Math.abs(f.velocity[0] - .2) < 1e-8);
        assert.ok(f.position[0] > .6); assert.equal(f.zeroCorrections, 0);
    }
});

test('孤立脉冲不因额外平滑丢幅或摊开，原生/区间契约各自保留积分', async () => {
    const [{ ImuEngine }] = await modules;
    for (const hz of [25, 50, 100]) for (const instantaneous of [false, true]) {
        const raw = new ImuEngine(profile), smooth = new ImuEngine({ ...profile, denoiseEnabled: true });
        let peak = 0;
        for (let i = 0; i <= hz * 4; i += 1) {
            const sample = native(i / hz, [i === hz * 2 ? 4 : 0, 0, 0]);
            if (!instantaneous) { delete sample.accelBeforeTime; delete sample.accelAfterTime; }
            raw.push(sample); smooth.push(sample); const f = smooth.snapshot();
            if (f.denoise.state === 'warming') continue;
            peak = Math.max(peak, f.integrationAcceleration[0]);
            if (f.rawAccel[0] === 0) assert.ok(Math.abs(f.integrationAcceleration[0]) < 1e-8);
        }
        const a = smooth.snapshot(), b = raw.snapshot();
        assert.ok(Math.abs(peak - 4) < 1e-8); assert.ok(Math.abs(a.velocity[0] - 4 / hz) < 1e-8);
        const p = b.position[0] - b.velocity[0] * (b.time - a.time);
        assert.ok(Math.abs(a.position[0] - p) < 1e-8);
    }
});

test('随机噪声降低但恒定真实偏置和相应速度保留，不以清速伪造降噪', async () => {
    const [{ ImuEngine }] = await modules;
    const raw = new ImuEngine(profile), smooth = new ImuEngine({ ...profile, denoiseEnabled: true });
    let seed = 1241; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
    const before = [], after = [];
    for (let i = 0; i <= 500; i += 1) {
        const sample = native(i / 50, [i ? .1 + .16 * random() : 0, 0, 0]); raw.push(sample); smooth.push(sample);
        if (i > 100) { before.push(raw.snapshot().integrationAcceleration[0]); after.push(smooth.snapshot().integrationAcceleration[0]); }
    }
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const deviation = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
    assert.ok(deviation(after) < deviation(before) * .5);
    assert.ok(Math.abs(mean(after) - .1) < .01);
    assert.ok(smooth.snapshot().velocity[0] > .8); assert.equal(smooth.snapshot().zeroCorrections, 0);
});

test('移除原生积分硬死区后，合成手持静置仍由已学静稳保持，持续噪声不推走已停位置', async () => {
    const [{ ImuEngine }] = await modules;
    const e = new ImuEngine({ ...profile, filterHz: 12, accelDeadZone: 1.33, remoteAutoRest: true, denoiseEnabled: true });
    e.restNoise = { gyroMean: [0, 0, 0], gyroDeviation: [.04, .04, .04], forceVariation: .3, sampleCount: 150, sampleRateHz: 50 };
    let held;
    for (let i = 0; i <= 400; i += 1) {
        const phase = i * Math.PI / 5;
        e.push(native(i / 50, [.15 * Math.sin(phase), .2 * Math.cos(phase), .1 * Math.sin(phase + .5)],
            [.03 * Math.sin(phase), .02 * Math.cos(phase), .02 * Math.sin(phase + .7)]));
        if (i === 200) held = e.snapshot();
    }
    const last = e.snapshot(); assert.ok(held.remoteRestActive); assert.ok(last.remoteRestActive);
    assert.ok(norm(held.position) < .1);
    assert.ok(distance(last.position, held.position) < 1e-10);
    assert.deepEqual(last.integrationAcceleration, [0, 0, 0]); assert.deepEqual(last.velocity, [0, 0, 0]);
});

test('源时钟长会话与50/100/300ms延迟不放大原函数相消误差', async () => {
    const [{ ImuEngine }] = await modules;
    for (const denoiseLagMs of [50, 100, 300]) {
        const raw = new ImuEngine(profile), smooth = new ImuEngine({ ...profile, denoiseEnabled: true, denoiseLagMs });
        for (let i = 0; i <= 250; i += 1) {
            const t = i / 50, s = t - 1, a = s >= 0 && s <= 1 ? .3 * Math.PI ** 2 * (2 * Math.cos(2 * Math.PI * s) - 2 * Math.cos(4 * Math.PI * s)) : 0;
            const sample = native(60000 + t, [a, 0, 0]); raw.push(sample); smooth.push(sample);
        }
        const a = smooth.snapshot(), b = raw.snapshot();
        assert.ok(distance(a.velocity, b.velocity) < 1e-7);
        assert.ok(Math.abs(a.position[0] - b.position[0] + b.velocity[0] * (b.time - a.time)) < 1e-7);
    }
});

test('连续低通区间的冲量和时间矩与独立数值求积一致，包括极低频率', async () => {
    const [, { SourceFilter, integrateSignal }] = await modules;
    for (const hz of [.000001, .01, 12, 50]) {
        const filter = new SourceFilter(); filter.commit(filter.prepare(0, [0, 0, 0], hz));
        const signal = filter.prepare(1, [1, 0, 0], hz, 'interval'), result = integrateSignal(signal);
        const count = 20000, sums = [0, 0, 0];
        for (let i = 0; i <= count; i += 1) {
            const t = i / count, f = -Math.expm1(-2 * Math.PI * hz * t), weight = i === 0 || i === count ? 1 : i % 2 ? 4 : 2;
            sums[0] += weight * f; sums[1] += weight * f * (1 - t); sums[2] += weight * f * (1 - t) ** 2 / 2;
        }
        [result.velocity[0], result.position[0], result.third[0]].forEach((value, i) => assert.ok(Math.abs(value - sums[i] / (3 * count)) < 1e-10));
    }
});

test('控制重置后的积分诊断不沿用旧运动值，恢复不会补入旧滤波尾巴', async () => {
    const [{ ImuEngine }] = await modules;
    for (const denoiseEnabled of [false, true]) {
        const e = new ImuEngine({ ...profile, filterHz: 12, denoiseEnabled });
        e.push(native(0, [0, 0, 0]));
        for (let i = 1; i <= 60; i += 1) e.push(native(i / 50, [.2, 0, 0]));
        assert.ok(e.snapshot().integrationAcceleration[0] > .1);
        e.stopVelocity(); assert.deepEqual(e.snapshot().integrationAcceleration, [0, 0, 0]);
        const p = e.snapshot().position;
        for (let i = 61; i <= 100; i += 1) e.push(native(i / 50, [0, 0, 0]));
        assert.ok(distance(e.snapshot().position, p) < 1e-10); assert.deepEqual(e.snapshot().velocity, [0, 0, 0]);
        e.profile.filterHz = 5; e.configureDenoise(); assert.deepEqual(e.snapshot().integrationAcceleration, [0, 0, 0]);
        e.beginCalibration(); assert.deepEqual(e.snapshot().integrationAcceleration, [0, 0, 0]);
    }
});

test('实际积分信号兼容旧帧、严格验证且深拷贝，不让显示字段覆盖它', async () => {
    const [{ ImuEngine }, , { normalizeFrame, createLabServer }] = await modules;
    const frame = new ImuEngine().snapshot(); frame.integrationAcceleration = [.2, 0, 0];
    const value = normalizeFrame(frame); assert.deepEqual(value.integrationAcceleration, [.2, 0, 0]);
    assert.deepEqual(value.linear, [0, 0, 0]); frame.integrationAcceleration[0] = 1; assert.equal(value.integrationAcceleration[0], .2);
    for (const invalid of [[1, 2], [NaN, 0, 0], [Infinity, 0, 0], [10001, 0, 0], '0']) assert.equal(normalizeFrame({ ...frame, integrationAcceleration: invalid }), null);
    const old = { ...frame }; delete old.integrationAcceleration; assert.ok(normalizeFrame(old));
    const server = await createLabServer({ host: '127.0.0.1', port: 0 });
    try { assert.equal((await fetch(`http://127.0.0.1:${server.port}/imu-conservative-denoise.mjs`)).status, 200); }
    finally { await server.close(); }
});
