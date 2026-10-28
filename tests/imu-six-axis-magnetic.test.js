'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../3rd/imu-six-axis-test/imu-engine.mjs'), import('three')]);

/** 用独立世界磁场/真实姿态生成机体系观测，估计器不接触真值。 */
async function fixture(hz = 50, assisted = true) {
    const [{ ImuEngine, GRAVITY }, { Quaternion, Vector3 }] = await modules;
    const base = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -.9);
    const field = new Vector3(18, 35, -28), up = new Vector3(0, 1, 0);
    const engine = new ImuEngine({ magneticAssist: assisted, gyroDeadZone: 0, accelDeadZone: 0, filterHz: 0 });
    const sample = (index, pose = base, rate = [0, 0, 0], magneticIndex = index, magneticPose = pose) => ({
        time: index / hz, kind: 'gravity', gyro: rate,
        accel: up.clone().multiplyScalar(GRAVITY).applyQuaternion(pose.clone().invert()).toArray(),
        magneticAvailable: true, magnetic: { time: magneticIndex / hz, accuracy: 3,
            field: field.clone().applyQuaternion(magneticPose.clone().invert()).toArray() }
    });
    return { engine, sample, base, field, up, hz, Quaternion, Vector3 };
}

test('25/50/100Hz磁场航向辅助抑制沿重力的陀螺零偏，不冻结真实旋转', async () => {
    for (const hz of [25, 50, 100]) {
        const f = await fixture(hz), off = await fixture(hz, false);
        const bias = f.up.clone().applyQuaternion(f.base.clone().invert()).multiplyScalar(.02).toArray();
        f.engine.push(f.sample(0)); off.engine.push(off.sample(0));
        const initial = f.engine.q.clone();
        for (let i = 1; i <= hz * 30; i += 1) {
            f.engine.push(f.sample(i, f.base, bias)); off.engine.push(off.sample(i, off.base, bias));
        }
        assert.equal(f.engine.snapshot().magnetic.state, 'active');
        assert.ok(f.engine.q.angleTo(initial) < .04, `${hz}Hz磁辅助残差过大`);
        assert.ok(off.engine.q.angleTo(initial) > .5, '关闭辅助对照应保留已注入的航向零偏');
        assert.ok(Math.hypot(...f.engine.snapshot().linear) < .001, '纯航向校正不得改变重力去除');
    }
});

test('倾斜设备真实旋转、异频旧磁场按测量时刻补偿，保持相对航向', async () => {
    const f = await fixture(100), poses = [];
    const rate = f.up.clone().applyQuaternion(f.base.clone().invert()).multiplyScalar(.7).toArray();
    let offset;
    for (let i = 0; i <= 1200; i += 1) {
        const pose = new f.Quaternion().setFromAxisAngle(f.up, .7 * i / 100).multiply(f.base);
        poses.push(pose); const magIndex = Math.floor(i / 5) * 5;
        f.engine.push(f.sample(i, pose, rate, magIndex, poses[magIndex]));
        offset ??= f.engine.q.clone().multiply(pose.clone().invert());
        assert.ok(f.engine.q.angleTo(offset.clone().multiply(pose)) < .005, '旋转不得被拉回开始姿态');
    }
    assert.equal(f.engine.snapshot().magnetic.state, 'active');
    assert.ok(Math.abs(f.engine.snapshot().magnetic.headingResidual) < .1);
});

test('动态加速度暂停重力与磁修正，恢复需稳定窗口', async () => {
    const f = await fixture();
    for (let i = 0; i <= 50; i += 1) f.engine.push(f.sample(i));
    const before = f.engine.q.clone();
    for (let i = 51; i <= 100; i += 1) {
        const s = f.sample(i); s.accel[0] += 4; f.engine.push(s);
        assert.equal(f.engine.snapshot().magnetic.state, 'dynamic');
    }
    assert.ok(f.engine.q.angleTo(before) < 1e-7, '移动加速度不得被强行当重力纠倾');
    f.engine.push(f.sample(101)); assert.notEqual(f.engine.snapshot().magnetic.state, 'active');
    for (let i = 102; i <= 132; i += 1) f.engine.push(f.sample(i));
    assert.equal(f.engine.snapshot().magnetic.state, 'active');
});

test('同模长方向干扰、强磁场、低精度、过期/未来和退化观测不重建参考', async () => {
    const f = await fixture();
    for (let i = 0; i <= 50; i += 1) f.engine.push(f.sample(i));
    const reference = f.engine.magnetic.reference.clone(), q = f.engine.q.clone();
    const disturbances = [
        s => { s.magnetic.field = f.field.clone().applyAxisAngle(f.up, Math.PI / 3).applyQuaternion(f.base.clone().invert()).toArray(); },
        s => { s.magnetic.field = [1000, 0, 0]; },
        s => { s.magnetic.accuracy = 0; },
        s => { s.magnetic.time -= .2; },
        s => { s.magnetic.time += .1; },
        s => { s.magnetic.field = f.up.clone().multiplyScalar(40).applyQuaternion(f.base.clone().invert()).toArray(); }
    ];
    for (let i = 0; i < disturbances.length; i += 1) {
        const s = f.sample(51 + i); disturbances[i](s); f.engine.push(s);
        assert.notEqual(f.engine.snapshot().magnetic.state, 'active');
        assert.ok(f.engine.magnetic.reference.distanceTo(reference) < 1e-12);
        assert.ok(f.engine.q.angleTo(q) < 1e-7);
    }
    for (let i = 57; i <= 90; i += 1) f.engine.push(f.sample(i));
    assert.equal(f.engine.snapshot().magnetic.state, 'active');
});

test('磁辅助关闭/重置/断流/手动航向/校准生命周期及旧APK兼容', async () => {
    const f = await fixture();
    for (let i = 0; i <= 50; i += 1) f.engine.push(f.sample(i));
    const reference = f.engine.magnetic.reference.clone();
    f.engine.pause(); assert.ok(f.engine.magnetic.reference.equals(reference));
    f.engine.push(f.sample(51)); assert.notEqual(f.engine.snapshot().magnetic.state, 'active');
    for (let i = 52; i <= 85; i += 1) f.engine.push(f.sample(i));
    assert.equal(f.engine.snapshot().magnetic.state, 'active');
    f.engine.profile.magneticAssist = false; f.engine.push(f.sample(86));
    assert.equal(f.engine.snapshot().magnetic.state, 'disabled'); assert.equal(f.engine.magnetic.reference, null);
    f.engine.profile.magneticAssist = true;
    for (let i = 87; i <= 120; i += 1) f.engine.push(f.sample(i));
    assert.equal(f.engine.snapshot().magnetic.state, 'active');
    const copy = f.engine.snapshot().magnetic; copy.state = 'invalid';
    assert.equal(f.engine.snapshot().magnetic.state, 'active');
    f.engine.resetHeading(); assert.equal(f.engine.magnetic.reference, null);
    for (let i = 121; i <= 155; i += 1) f.engine.push(f.sample(i));
    f.engine.beginDeadzoneCalibration(); assert.equal(f.engine.magnetic.reference, null);
    f.engine.resetExperiment(); assert.equal(f.engine.magnetic.reference, null);
    const old = f.sample(156); delete old.magnetic; delete old.magneticAvailable;
    f.engine.push(old); assert.equal(f.engine.snapshot().magnetic.state, 'missing');
    const noHardware = f.sample(157); delete noHardware.magnetic; noHardware.magneticAvailable = false;
    f.engine.push(noHardware); assert.equal(f.engine.snapshot().magnetic.state, 'unsupported');
});

test('可信重力缓慢纠倾，单步限速且航向校正不会被解释为平移', async () => {
    const f = await fixture();
    for (let i = 0; i <= 50; i += 1) f.engine.push(f.sample(i));
    f.engine.q.premultiply(new f.Quaternion().setFromAxisAngle(new f.Vector3(1, 0, 0), .08));
    for (let i = 51; i <= 400; i += 1) {
        const before = f.engine.q.clone(); f.engine.push(f.sample(i));
        assert.ok(f.engine.q.angleTo(before) <= 8 * Math.PI / 180 / f.hz + 1e-7);
    }
    const force = new f.Vector3().fromArray(f.sample(400).accel).applyQuaternion(f.engine.q).normalize();
    assert.ok(force.angleTo(f.up) < .002, '可信重力应恢复倾斜方向');
});

test('初始参考拒绝模长不稳定的磁场，重复同一观测不能凑足确认窗口', async () => {
    const f = await fixture();
    for (let i = 0; i <= 50; i += 1) {
        const s = f.sample(i); s.magnetic.field = s.magnetic.field.map(v => v * (i % 2 ? 1.3 : 1));
        f.engine.push(s); assert.equal(f.engine.magnetic.reference, null);
    }
    for (let i = 51; i <= 55; i += 1) {
        const s = f.sample(i, f.base, [0, 0, 0], 51); f.engine.push(s);
        assert.equal(f.engine.magnetic.reference, null);
    }
    const stale = f.sample(60, f.base, [0, 0, 0], 51); f.engine.push(stale);
    assert.equal(f.engine.snapshot().magnetic.state, 'stale');
});
