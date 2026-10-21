'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([import('../3rd/imu-six-axis-test/imu-engine.mjs'),
    import('../3rd/imu-six-axis-test/imu-simulator.mjs'), import('three')]);
const ideal = { gyroDeadZone: 0, accelDeadZone: 0, filterHz: 0, tiltGain: 0 };

test('三轴组合旋转和平移由带重力六轴重建，不读取模拟真值', async () => {
    const [{ ImuEngine }, { ImuSimulator }] = await modules;
    for (const trajectory of ['translate', 'rotate', 'combined']) {
        const sim = new ImuSimulator(), engine = new ImuEngine(ideal);
        Object.keys(sim.noise).forEach(key => { sim.noise[key] = 0; });
        engine.push(sim.step()); sim.startTrajectory(trajectory);
        for (let i = 0; i < 1400; i += 1) engine.push(sim.step(i % 2 ? 0.007 : 0.013));
        assert.ok(engine.p.distanceTo(sim.p) < 1e-7);
        assert.ok(engine.q.angleTo(sim.q) < 1e-6);
        assert.ok(Math.abs(engine.q.length() - 1) < 1e-12);
    }
});

test('匀速不会因低加速度清零；显式停稳独立处理，线性数据不二次去重力', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine(ideal);
    engine.push({ time: 0, gyro: [0, 0, 0], accel: [0, 0, 0], kind: 'linear' });
    for (let i = 1; i <= 100; i += 1) engine.push({ time: i / 100, gyro: [0, 0, 0], accel: [1, 0, 0], kind: 'linear' });
    for (let i = 101; i <= 300; i += 1) engine.push({ time: i / 100, gyro: [0, 0, 0], accel: [0, 0, 0], kind: 'linear' });
    assert.ok(Math.abs(engine.p.x - 2.5) < 1e-9); assert.ok(Math.abs(engine.v.x - 1) < 1e-9);
    assert.ok(Math.abs(engine.p.y) < 1e-9); assert.equal(engine.zeroCorrections, 0);
    engine.stopVelocity(); assert.equal(engine.v.length(), 0); assert.equal(engine.zeroCorrections, 1);
});

test('静置校准估计陀螺仪零偏；单面不假称完成加速度校准', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine(ideal); engine.beginCalibration();
    for (let i = 0; i <= 220; i += 1) engine.push({ time: i / 100, gyro: [0.04, -0.02, 0.01], accel: [0, 0, GRAVITY], kind: 'gravity' });
    engine.gyroBias.forEach((value, axis) => assert.ok(Math.abs(value - [0.04, -0.02, 0.01][axis]) < 1e-9));
    assert.equal(engine.gyroCalibrated, true); assert.equal(engine.accelCalibrated, false);
    assert.ok(engine.q.angleTo((await modules)[0].REST_ORIENTATION) < 1e-6);
});

test('六面校准恢复加速度偏置与比例，运动窗口不能误标为静置', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine(ideal), bias = [0.1, -0.12, 0.06], scale = [1.02, 0.98, 1.01];
    let time = 0;
    for (const face of ['x+', 'x-', 'y+', 'y-', 'z+', 'z-']) {
        const axis = 'xyz'.indexOf(face[0]), sign = face[1] === '+' ? 1 : -1;
        engine.beginCalibration(face);
        for (let i = 0; i < 220; i += 1) {
            time += 0.01; const force = [...bias]; force[axis] += sign * GRAVITY * scale[axis];
            engine.push({ time, gyro: [0, 0, 0], accel: force, kind: 'gravity' });
        }
    }
    assert.equal(engine.accelCalibrated, true);
    bias.forEach((value, axis) => assert.ok(Math.abs(engine.accelBias[axis] - value) < 1e-9));
    scale.forEach((value, axis) => assert.ok(Math.abs(engine.accelScale[axis] - 1 / value) < 1e-9));
    const moving = new ImuEngine(); moving.beginCalibration();
    for (let i = 0; i < 300; i += 1) moving.push({ time: i / 100, gyro: [0, 1, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    assert.equal(moving.gyroCalibrated, false);
});

test('固定种子噪声可重复，校准后旋转误差明显改善且残余误差如实保留', async () => {
    const [{ ImuEngine }, { ImuSimulator }] = await modules;
    const run = calibrated => {
        const sim = new ImuSimulator(81), engine = new ImuEngine({ ...ideal, gyroDeadZone: 0.002 });
        sim.noise.gyroBias = 0.04; sim.noise.gyro = 0.0005;
        if (calibrated) engine.beginCalibration();
        for (let i = 0; i < 2200; i += 1) engine.push(sim.step());
        return { rotation: engine.q.angleTo(sim.q), position: engine.p.toArray() };
    };
    const calibrated = run(true), raw = run(false);
    assert.deepEqual(calibrated, run(true)); assert.ok(calibrated.rotation < raw.rotation / 10);
    assert.ok(calibrated.position.every(Number.isFinite));
});

test('缺轴、重复/回退和断流不跨时间积分；接收后冻结位置并重新初始化速度', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine(ideal), frame = time => ({ time, gyro: [0, 0, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    assert.equal(engine.push({ ...frame(0), gyro: [null, 0, 0] }), false);
    engine.push(frame(0)); engine.v.x = 1; engine.push(frame(0.1));
    assert.equal(engine.push(frame(0.1)), false); assert.equal(engine.push(frame(0)), false);
    const previous = engine.p.clone(); engine.push(frame(5));
    assert.ok(engine.p.equals(previous)); assert.equal(engine.v.length(), 0); assert.equal(engine.gaps, 1);
    engine.pause(); engine.push(frame(50)); assert.ok(engine.p.equals(previous));
});

test('批量传输标记缺样时冻结位置并从当前样本重启积分', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine(ideal);
    const sample = (time, gap = false) => ({ time, gyro: [0, 0, 0], accel: [1, 0, 0], kind: 'linear', gap });
    engine.push(sample(0)); engine.push(sample(0.02));
    const beforeGap = engine.p.x;
    engine.push(sample(0.04, true));
    assert.equal(engine.gaps, 1);
    assert.equal(engine.v.x, 0);
    assert.equal(engine.p.x, beforeGap);
    engine.push(sample(0.06));
    assert.ok(engine.v.x > 0);
    assert.equal(engine.samples, 4);
});

test('重置航向抵消水平角，保留设备倾斜且暂停不使共享时间倒退', async () => {
    const [{ ImuEngine, REST_ORIENTATION, GRAVITY }, , { Vector3, Quaternion }] = await modules;
    const engine = new ImuEngine(ideal), up = new Vector3(0, 1, 0);
    engine.q.copy(new Quaternion().setFromAxisAngle(up, 0.8)).multiply(REST_ORIENTATION)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25));
    const tilt = new Vector3(0, 0, 1).applyQuaternion(engine.q).dot(up);
    engine.resetHeading();
    const forward = new Vector3(0, 1, 0).applyQuaternion(engine.q);
    assert.ok(Math.abs(forward.x) < 1e-12); assert.ok(forward.z < 0);
    assert.ok(Math.abs(new Vector3(0, 0, 1).applyQuaternion(engine.q).dot(up) - tilt) < 1e-12);
    engine.push({ time: 5, gyro: [0, 0, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    const time = engine.snapshot().time; engine.pause(); assert.equal(engine.snapshot().time, time);
});

test('浏览器六轴映射自然设备轴，不把null当0，不对横竖屏重复旋转', async () => {
    const { motionSample } = await import('../3rd/imu-six-axis-test/imu-phone.mjs');
    assert.equal(motionSample({ rotationRate: { alpha: null, beta: 0, gamma: 0 } }, 1), null);
    const sample = motionSample({ rotationRate: { alpha: 180, beta: 90, gamma: -90 },
        accelerationIncludingGravity: { x: 1, y: 2, z: 3 } }, 1);
    assert.deepEqual(sample.accel, [1, 2, 3]); assert.deepEqual(sample.gyro, [Math.PI / 2, -Math.PI / 2, Math.PI]);
});

test('右相机跟随任意位移保持相对距离/方向，观察目标始终与设备位置一致', async () => {
    const { followTranslation } = await import('../3rd/imu-six-axis-test/imu-scene.mjs');
    const [, , { Vector3 }] = await modules;
    const camera = { position: new Vector3(3, 2, 4) }, controls = { target: new Vector3() }, previous = new Vector3();
    const offset = camera.position.clone();
    for (const current of [new Vector3(1, 2, -3), new Vector3(-8, 9, 12), new Vector3(10, -3, -5)]) {
        followTranslation(camera, controls, current, previous);
        assert.ok(camera.position.clone().sub(current).distanceTo(offset) < 1e-12);
        assert.ok(controls.target.distanceTo(current) < 1e-12);
    }
});

test('默认处理的无噪声旋转不制造平移，平移与复合运动不被错误倾斜纠偏破坏', async () => {
    const [{ ImuEngine }, { ImuSimulator }] = await modules;
    const limits = { rotate: 1e-6, translate: 0.01, combined: 0.03 };
    for (const [trajectory, limit] of Object.entries(limits)) {
        const simulator = new ImuSimulator(), engine = new ImuEngine();
        Object.keys(simulator.noise).forEach(key => { simulator.noise[key] = 0; });
        engine.push(simulator.step()); simulator.startTrajectory(trajectory);
        for (let i = 0; i < 1000; i += 1) engine.push(simulator.step());
        assert.ok(engine.p.distanceTo(simulator.p) < limit, `${trajectory}默认处理误差过大`);
        assert.equal(engine.zeroCorrections, 0, '不能靠自动清速度掩盖积分错误');
    }
});

test('默认带噪输入经静置校准保留有限残差，已标定加速度不被再次误对齐', async () => {
    const [{ ImuEngine, GRAVITY, REST_ORIENTATION }, { ImuSimulator }] = await modules;
    const simulator = new ImuSimulator(), engine = new ImuEngine(); engine.beginCalibration();
    for (let i = 0; i < 1000; i += 1) engine.push(simulator.step());
    assert.equal(engine.gyroCalibrated, true); assert.ok(engine.p.length() < 0.05);
    const corrected = new ImuEngine(); corrected.accelBias = [0.3, -0.2, 0.1];
    corrected.accelScale = [1.02, 0.98, 1.01]; corrected.beginCalibration();
    for (let i = 0; i < 300; i += 1) corrected.push({ time: i / 100, gyro: [0, 0, 0],
        accel: [0.3, -0.2, GRAVITY / 1.01 + 0.1], kind: 'gravity' });
    assert.ok(corrected.q.angleTo(REST_ORIENTATION) < 1e-6);
});

// 未校准输入的死区应作用于去重力后的加速度，不能吞掉正常重力初始化。
test('默认无需校准即可用死区抑制微小静态扰动', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine();
    engine.push({ time: 0, gyro: [0, 0, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    for (let i = 1; i <= 200; i += 1) {
        engine.push({ time: i / 100, gyro: [0.001, 0, 0], accel: [0.01, 0, GRAVITY], kind: 'gravity' });
    }
    assert.equal(engine.gyroCalibrated, false);
    assert.equal(engine.accelCalibrated, false);
    assert.deepEqual(engine.snapshot().gyro, [0, 0, 0]);
    assert.deepEqual(engine.snapshot().linear, [0, 0, 0]);
    assert.equal(engine.p.length(), 0);
    assert.match(engine.message, /校准可选/);
});

test('APK观察模式由六轴静稳窗口学习重力并阻止静置下坠，普通手机保持手动', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const force = [-1.7008, 1.1419, 9.4655];
    const frame = time => ({ time, gyro: [0.001, -0.001, 0.0005], accel: force, kind: 'gravity' });
    const remote = new ImuEngine({ remoteAutoRest: true });
    const phone = new ImuEngine();
    for (let i = 0; i <= 200; i += 1) {
        const sample = frame(i * 0.04);
        remote.push(sample); phone.push(sample);
    }
    assert.ok(remote.snapshot().remoteRestActive);
    assert.equal(remote.zeroCorrections, 1);
    assert.equal(remote.v.length(), 0);
    assert.ok(Math.abs(remote.gravityMagnitude - Math.hypot(...force)) < 1e-6);
    assert.ok(remote.p.y > -0.15, '静置时只允许窗口确认前的短暂积分');
    assert.equal(phone.zeroCorrections, 0);
    assert.equal(phone.gravityMagnitude, GRAVITY);
    assert.ok(phone.p.y < -3, '普通手机默认仍保留原来的手动清零行为');
});

test('APK观察模式移动后重新静稳会清除残留速度，线性输入不触发重力学习', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine({ remoteAutoRest: true });
    const stationary = time => ({ time, gyro: [0, 0, 0], accel: [0, 0, 9.684], kind: 'gravity' });
    for (let i = 0; i <= 100; i += 1) engine.push(stationary(i * 0.04));
    assert.equal(engine.zeroCorrections, 1);
    for (let i = 101; i <= 125; i += 1) {
        engine.push({ time: i * 0.04, gyro: [0, 0, 0], accel: [1.2, 0, 9.684], kind: 'gravity' });
    }
    assert.equal(engine.remoteRestActive, false);
    assert.ok(engine.v.length() > 0);
    for (let i = 126; i <= 225; i += 1) engine.push(stationary(i * 0.04));
    assert.equal(engine.zeroCorrections, 2);
    assert.equal(engine.v.length(), 0);
    assert.ok(engine.remoteRestActive);

    const linear = new ImuEngine({ remoteAutoRest: true });
    for (let i = 0; i <= 100; i += 1) linear.push({ time: i * 0.04,
        gyro: [0, 0, 0], accel: [0, 0, 0], kind: 'linear' });
    assert.equal(linear.zeroCorrections, 0);
    assert.equal(linear.gravityMagnitude, GRAVITY);
});

test('死区校准从门限前数据取样，对齐重力且不修改零偏或位置', async () => {
    const [{ ImuEngine, GRAVITY }, , { Vector3 }] = await modules;
    const engine = new ImuEngine({ gyroDeadZone: 0.5, accelDeadZone: 0.5 });
    engine.push({ time: 0, gyro: [0, 0, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    engine.p.set(1, 2, 3); const before = engine.q.clone();
    engine.beginDeadzoneCalibration();
    for (let i = 1; i <= 330 && engine.deadzoneCalibration; i += 1) {
        engine.push({ time: i / 100, gyro: [0.005, 0, 0], accel: [0.04, 0, GRAVITY + 0.01 * Math.sin(i)], kind: 'gravity' });
    }
    assert.equal(engine.deadzoneRevision, 1);
    assert.ok(engine.profile.gyroDeadZone > 0.005 && engine.profile.gyroDeadZone < 0.007);
    assert.ok(engine.profile.accelDeadZone >= 0.01 && engine.profile.accelDeadZone < 0.05);
    assert.deepEqual(engine.gyroBias, [0, 0, 0]); assert.deepEqual(engine.accelBias, [0, 0, 0]);
    assert.deepEqual(engine.p.toArray(), [1, 2, 3]); assert.ok(!engine.q.equals(before));
    const gravity = new Vector3(0.04, 0, GRAVITY).applyQuaternion(engine.q);
    assert.ok(Math.hypot(gravity.x, gravity.z) < 0.001);
    assert.equal(engine.gyroCalibrated, false); assert.equal(engine.accelCalibrated, false);
});

test('倾斜静置校准后模拟器能清除残留速度，不再持续放大位置误差', async () => {
    const [{ ImuEngine }, { ImuSimulator }, { Quaternion, Vector3 }] = await modules;
    const simulator = new ImuSimulator(42), engine = new ImuEngine({ simulatorAutoRest: true });
    engine.push(simulator.step());
    engine.q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.03));
    engine.beginDeadzoneCalibration();
    for (let i = 0; i < 330 && engine.deadzoneCalibration; i += 1) engine.push(simulator.step());
    assert.equal(engine.deadzoneRevision, 1);
    assert.ok(engine.q.angleTo(simulator.q) < 0.01);
    for (const target of [[1.5, 0, -1], [-0.8, 0, 1.3], [0.1, 0, -1.35]]) {
        simulator.setTarget(new Vector3(...target), simulator.q);
        for (let i = 0; i < 150; i += 1) engine.push(simulator.step());
    }
    assert.equal(engine.zeroCorrections, 1, '运动途中不能把限速匀速段误判为停稳');
    for (let i = 0; i < 200; i += 1) engine.push(simulator.step());
    assert.equal(engine.v.length(), 0);
    assert.ok(engine.simulatorRestActive);
    const stopped = engine.p.clone();
    for (let i = 0; i < 300; i += 1) engine.push(simulator.step());
    assert.ok(engine.p.distanceTo(stopped) < 0.01);
    assert.ok(engine.p.distanceTo(simulator.p) < 0.6);
});

test('模拟器六轴静稳窗口能清掉无减速证据的残留速度，手机默认保持手动清零', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const stationary = time => ({ time, gyro: [0.003, -0.004, 0.001],
        accel: [0.015, 0.012, GRAVITY + 0.052], kind: 'gravity' });
    const simulator = new ImuEngine({ simulatorAutoRest: true, gyroDeadZone: 0.01, accelDeadZone: 0.08 });
    simulator.push(stationary(0)); simulator.v.set(0.15, 0.31, 2.09);
    for (let i = 1; i <= 2000; i += 1) simulator.push(stationary(i / 100));
    assert.equal(simulator.zeroCorrections, 1);
    assert.deepEqual(simulator.v.toArray(), [0, 0, 0]);
    assert.ok(simulator.p.z < 4.1, '停稳后的位置不得按旧速度继续漂移');
    assert.equal(simulator.snapshot().restReason, 'window');
    assert.ok(simulator.snapshot().restConfidence >= 0.8);

    const phone = new ImuEngine({ gyroDeadZone: 0.01, accelDeadZone: 0.08 });
    phone.push(stationary(0)); phone.v.set(0.15, 0.31, 2.09);
    for (let i = 1; i <= 2000; i += 1) phone.push(stationary(i / 100));
    assert.equal(phone.zeroCorrections, 0);
    assert.ok(phone.v.z > 2);
    assert.equal(phone.snapshot().restReason, null);
});

test('模拟器窗口的匀速误判边界和断流重置可见', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine({ simulatorAutoRest: true });
    const stationary = time => ({ time, gyro: [0, 0, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    engine.push(stationary(0)); engine.v.set(1, 0, 0);
    for (let i = 1; i <= 180; i += 1) engine.push(stationary(i / 100));
    assert.equal(engine.zeroCorrections, 0, '短暂停顿不能触发兜底归零');
    for (let i = 181; i <= 200; i += 1) engine.push(stationary(i / 100));
    assert.equal(engine.zeroCorrections, 1, '仅凭六轴会把长时间匀速误判为静止');
    assert.equal(engine.snapshot().restReason, 'window');
    engine.push(stationary(2.3));
    assert.equal(engine.snapshot().restConfidence, 0);
    assert.equal(engine.snapshot().restReason, null);
});

test('模拟器默认噪声下纯旋转不把重力积分成平移，组合运动不误触仅旋转零速', async () => {
    const [{ ImuEngine }, { ImuSimulator }] = await modules;
    const spin = new ImuSimulator(42), engine = new ImuEngine({ simulatorAutoRest: true });
    engine.push(spin.step()); spin.startTrajectory('rotate');
    for (let i = 0; i < 3000; i += 1) engine.push(spin.step());
    assert.ok(engine.p.distanceTo(spin.p) < 0.05, '纯旋转30秒不应产生明显估计平移');
    assert.equal(engine.v.length(), 0);
    assert.equal(engine.zeroCorrections, 1, '连续纯旋转只记一次零速修正');
    assert.equal(engine.snapshot().restReason, 'rotation');

    const mixed = new ImuSimulator(42), mixedEngine = new ImuEngine({ simulatorAutoRest: true });
    mixedEngine.push(mixed.step()); mixed.startTrajectory('combined');
    for (let i = 0; i < 800; i += 1) mixedEngine.push(mixed.step());
    assert.equal(mixedEngine.zeroCorrections, 0, '同时旋转和平移不能被判为仅旋转');
    assert.ok(mixedEngine.p.distanceTo(mixed.p) < 1.2);

    const phone = new ImuEngine(); const phoneSpin = new ImuSimulator(42);
    phone.push(phoneSpin.step()); phoneSpin.startTrajectory('rotate');
    for (let i = 0; i < 200; i += 1) phone.push(phoneSpin.step());
    assert.equal(phone.zeroCorrections, 0);
    assert.equal(phone.snapshot().restReason, null);
});

test('模拟器静稳评分使用去重力前的力模长并能恢复旋转后的倾斜', async () => {
    const [{ ImuEngine, GRAVITY }, , { Quaternion, Vector3 }] = await modules;
    const engine = new ImuEngine({ simulatorAutoRest: true, gyroDeadZone: 0.01 });
    const stationary = time => ({ time, gyro: [0.003, -0.004, 0.001],
        accel: [0, 0, GRAVITY], kind: 'gravity' });
    engine.push(stationary(0));
    const level = engine.q.clone();
    engine.q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.04));
    engine.v.set(1, 0, 0);
    for (let i = 1; i <= 500; i += 1) engine.push(stationary(i / 100));
    assert.ok(engine.restConfidence >= 0.8, '重力模长应取自去重力前的机体系数据');
    assert.ok(engine.zeroCorrections >= 1);
    assert.equal(engine.v.length(), 0);
    assert.ok(engine.q.angleTo(level) < 0.001, '持续静稳后应恢复重力方向');
});

test('死区校准允许手持高噪声超过旧上限，并提示高阈值风险', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine({ filterHz: 0 });
    engine.push({ time: 0, gyro: [0, 0, 0], accel: [0, 0, GRAVITY], kind: 'gravity' });
    engine.beginDeadzoneCalibration();
    for (let i = 1; i <= 330 && engine.deadzoneCalibration; i += 1) {
        engine.push({ time: i / 100, gyro: [0.05 * Math.sin(i * 0.4), 0, 0],
            accel: [1.2 * Math.sin(i * 0.7), 0.2 * Math.cos(i * 0.9), GRAVITY + 0.25 * Math.sin(i * 0.8)],
            kind: 'gravity' });
    }
    assert.equal(engine.deadzoneRevision, 1);
    assert.ok(engine.profile.gyroDeadZone * 180 / Math.PI > 1);
    assert.ok(engine.profile.accelDeadZone > 0.5);
    assert.match(engine.deadzoneMessage, /高死区/);
});

test('死区校准类型变化、断流和取消不会套用旧窗口', async () => {
    const [{ ImuEngine, GRAVITY }] = await modules;
    const engine = new ImuEngine();
    const sample = (time, kind = 'gravity') => ({ time, gyro: [0, 0, 0],
        accel: kind === 'gravity' ? [0, 0, GRAVITY] : [0, 0, 0], kind });
    engine.push(sample(0)); engine.beginDeadzoneCalibration();
    for (let i = 1; i < 100; i += 1) engine.push(sample(i / 100));
    engine.push(sample(1, 'linear'));
    assert.equal(engine.deadzoneCalibration.samples.length, 1);
    assert.equal(engine.deadzoneCalibration.kind, 'linear');
    const previous = { ...engine.profile }, pose = engine.q.clone();
    engine.cancelDeadzoneCalibration(); assert.deepEqual(engine.profile, previous);
    engine.beginDeadzoneCalibration();
    engine.push(sample(1.01)); engine.push(sample(2));
    assert.equal(engine.deadzoneCalibration.samples.length, 0);
    assert.deepEqual(engine.profile, previous); assert.ok(engine.q.equals(pose));
    engine.beginDeadzoneCalibration(); engine.pause(); assert.equal(engine.deadzoneCalibration, null);
});

test('线性加速度死区校准不借重力调整姿态', async () => {
    const [{ ImuEngine }] = await modules;
    const engine = new ImuEngine();
    engine.push({ time: 0, gyro: [0, 0, 0], accel: [0, 0, 0], kind: 'linear' });
    const before = engine.q.clone(); engine.beginDeadzoneCalibration();
    for (let i = 1; i <= 330 && engine.deadzoneCalibration; i += 1) {
        engine.push({ time: i / 100, gyro: [0.001, 0, 0], accel: [0.03, 0, 0], kind: 'linear' });
    }
    assert.equal(engine.deadzoneRevision, 1); assert.ok(engine.q.equals(before));
});
