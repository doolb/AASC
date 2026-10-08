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
