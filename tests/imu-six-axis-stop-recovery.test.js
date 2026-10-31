'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../3rd/imu-six-axis-test/imu-engine.mjs'),
    import('../3rd/imu-six-axis-test/imu-denoiser.mjs'), import('../3rd/imu-six-axis-test/server.mjs'), import('three')]);
const profile = { denoiseEnabled: true, remoteAutoRest: true, stopRecoveryEnabled: true,
    denoiseLagMs: 300, gyroDeadZone: 0, accelDeadZone: .08, filterHz: 12, tiltGain: 0, magneticAssist: false };

/** 用相同初值隔离延迟积分与快停；hold是原始静稳结果，不能让原兜底掩盖误清速。 */
async function replay({ hz = 50, enabled = true, lag = 300, end = 2, acceleration, rate = () => [0, 0, 0], jitter = false, hold = () => false }) {
    const [{ ImuEngine }, { FixedLagDenoiser }] = await modules;
    const p = { ...profile, stopRecoveryEnabled: enabled, denoiseLagMs: lag };
    const seed = { ...new ImuEngine(p).rawSnapshot(), quaternion: [0, 0, 0, 1], velocity: [1, 0, 0] };
    const d = new FixedLagDenoiser(); d.reset(seed);
    const outputs = [];
    for (let i = 0; i <= end * hz; i += 1) {
        const time = i / hz + (jitter && i ? Math.sin(i * 2.4) * .15 / hz : 0);
        const a = acceleration(time, i), gyro = rate(time, i);
        const frame = { ...seed, time, rawAccel: [a[0], 9.80665 + a[1], a[2]], rawGyro: gyro };
        d.push(frame, a, gyro, hold(time));
        if (d.lastOutputTime !== null) outputs.push(structuredClone(d.frame));
    }
    return { d, outputs };
}
const brake = time => time >= .2 && time < .4 ? [-1, 0, 0] : [0, 0, 0];

test('25/50/100Hz减速后快停仅清残速，同帧时序不回写旧位置，抖动按源秒判断', async () => {
    for (const hz of [25, 50, 100]) {
        const { d, outputs } = await replay({ hz, acceleration: brake, jitter: true });
        const first = outputs.find(frame => frame.stopRecovery.active);
        assert.ok(first, `${hz}Hz未进入快停`);
        // 抖动会改变边缘取样及滤波尾巴；在静稳开始后100ms源时间内完成，另有配置的显示延迟。
        assert.ok(first.time >= .4 && first.time <= .5, `${hz}Hz首次快停${first.time}`);
        assert.ok(first.stopRecovery.evidenceEndTime - first.time >= .24);
        assert.ok(first.stopRecovery.evidenceEndTime - first.time <= .3 + 1e-8);
        assert.equal(first.stopRecovery.source, 'future');
        assert.deepEqual(first.rawAccel, [0, 9.80665, 0]);
        const previous = outputs.filter(frame => frame.time < first.time).at(-1);
        assert.deepEqual(first.position, previous.position, '清速只冻结当前端点，不回拉已有位置');
        const savedPrevious = structuredClone(previous);
        assert.deepEqual(d.frame.velocity, [0, 0, 0]);
        assert.deepEqual(d.frame.position, first.position);
        assert.deepEqual(previous, savedPrevious);
        assert.equal(d.stopRecovery.corrections, 1);
        assert.ok(d.entries.length < hz * 2);
        const baseline = await replay({ hz, acceleration: brake, enabled: false, jitter: true });
        assert.ok(baseline.d.frame.velocity[0] > .7);
        assert.ok(baseline.d.frame.position[0] - d.frame.position[0] > .8);
    }
});

test('匀速、正向启动、单点反向脉冲、持续加速、持续旋转及高噪声均不触发快停', async () => {
    const cases = [
        { acceleration: () => [0, 0, 0] },
        { acceleration: t => t < .4 ? [1, 0, 0] : [0, 0, 0] },
        { acceleration: (t, i) => i === 15 ? [-1, 0, 0] : [0, 0, 0] },
        { acceleration: t => t < .4 ? brake(t) : [.3, 0, 0] },
        { acceleration: brake, rate: t => t < .4 ? [0, 0, 0] : [0, .08, 0] },
        { acceleration: (t, i) => t < .4 ? brake(t) : [i % 2 ? .12 : -.12, 0, 0] }
    ];
    for (const hz of [25, 50, 100]) {
        for (const [index, scenario] of cases.entries()) {
            const { d, outputs } = await replay({ ...scenario, hz });
            assert.equal(d.stopRecovery.corrections, 0, `${hz}Hz反例${index}`);
            assert.ok(outputs.every(f => !f.stopRecovery.active));
            assert.ok(d.frame.velocity[0] > .5, '反例不能被清速掩盖');
        }
    }
});

test('未来窗口不足保持原流程，原静稳兜底可独立清速', async () => {
    for (const lag of [50, 100, 200]) {
        const { d } = await replay({ acceleration: brake, lag });
        assert.equal(d.stopRecovery.corrections, 0); assert.ok(d.frame.velocity[0] > .7);
    }
    const { d } = await replay({ acceleration: () => [0, 0, 0], hold: t => t >= 1 });
    assert.equal(d.stopRecovery.corrections, 0); assert.equal(d.frame.stopRecovery.source, 'legacy');
    assert.deepEqual(d.frame.velocity, [0, 0, 0]);
});

test('快停只在新动作到达对应源中心时退出，缓动与旋转保持姿态/积分', async () => {
    for (const rotation of [false, true]) {
        const { outputs } = await replay({ end: 1.7,
            acceleration: t => t < .8 ? brake(t) : [.2, 0, 0],
            rate: t => rotation && t >= .8 ? [0, .1, 0] : [0, 0, 0] });
        assert.ok(outputs.some(f => f.stopRecovery.active));
        assert.ok(outputs.filter(f => f.time >= .4 && f.time < .8).every(f => f.stopRecovery.active), '未来新运动不能提前解锁历史静稳');
        const resumed = outputs.find(f => f.time >= .8);
        assert.equal(resumed.stopRecovery.active, false); assert.equal(resumed.stopRecovery.state, 'motion');
        assert.ok(outputs.at(-1).velocity[0] > .1, '真实缓动不能被快停持续吞掉');
    }
});

test('长缺口不构成未来强静稳；reset清除所有快停证据', async () => {
    const { d } = await replay({ end: .65, acceleration: brake });
    const frame = { ...d.frame, time: 1, profile: { ...d.frame.profile, denoiseLagMs: 1000 } };
    d.push(frame, [0, 0, 0], [0, 0, 0], false);
    assert.equal(d.stopRecovery.corrections, 0, '跨300ms以上缺口不能凑静稳窗口');
    d.reset(frame, '设备切换');
    assert.equal(d.stopRecovery.active, false); assert.equal(d.stopRecovery.braking.length, 0);
    assert.equal(d.stopRecovery.decisionTime, null); assert.equal(d.stopRecovery.corrections, 0);
});

test('完整引擎快停后真实重启先撤销旧raw静稳；暂停/校准/参数切换均清证据', async () => {
    const [{ ImuEngine }, , , { Quaternion }] = await modules;
    const engine = new ImuEngine(profile); engine.q = new Quaternion(); engine.initialized = true;
    let fast = false, beforeRestart;
    for (let i = 0; i <= 155; i += 1) {
        const time = i / 50;
        const ax = time < .5 ? 2 : time < .7 ? -1 : time < 2.8 ? 0 : .2;
        engine.push({ time, kind: 'gravity', accel: [ax, 9.80665, 0], gyro: [0, 0, 0] });
        const frame = engine.snapshot(); fast ||= frame.stopRecovery.active;
        if (i === 139) beforeRestart = frame;
        if (i === 140) assert.equal(engine.remoteRestActive, false, '当前新运动先撤销旧静稳');
    }
    assert.ok(fast); assert.ok(beforeRestart.stopRecovery.active);
    assert.equal(engine.snapshot().stopRecovery.active, false);
    assert.ok(engine.snapshot().velocity[0] > 0);
    engine.pause(); assert.equal(engine.snapshot().stopRecovery.corrections, 0);
    assert.equal(engine.snapshot().stopRecovery.active, false);
    engine.profile.stopRecoveryEnabled = false; engine.configureDenoise();
    assert.equal(engine.snapshot().stopRecovery.decisionTime, null);
    engine.beginDeadzoneCalibration(); assert.equal(engine.snapshot().stopRecovery.active, false);
});

test('快停诊断白名单、时间范围、旧帧兼容且profile开关校验', async () => {
    const [, , { normalizeFrame }] = await modules;
    const { d } = await replay({ acceleration: brake });
    const frame = d.frame, normalized = normalizeFrame(frame);
    assert.deepEqual(normalized.stopRecovery, frame.stopRecovery);
    assert.equal(normalized.profile.stopRecoveryEnabled, true);
    const old = { ...frame }; delete old.stopRecovery;
    assert.ok(normalizeFrame(old));
    assert.equal(normalizeFrame({ ...frame, profile: { stopRecoveryEnabled: 'true' } }), null);
    for (const patch of [{ active: 1 }, { state: 'unknown' }, { source: 'unknown' }, { windowSeconds: NaN },
        { gyroMeanError: -1 }, { brakingAt: Infinity }, { corrections: .5 }, { decisionTime: .8, evidenceEndTime: .7 },
        { decisionTime: .8, evidenceEndTime: 1.2 }]) {
        assert.equal(normalizeFrame({ ...frame, stopRecovery: { ...frame.stopRecovery, ...patch } }), null);
    }
    const withExtra = normalizeFrame({ ...frame, stopRecovery: { ...frame.stopRecovery, extra: 'ignore' } });
    assert.equal(Object.hasOwn(withExtra.stopRecovery, 'extra'), false);
});
