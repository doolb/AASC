'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const imu = require('../3rd/mind-basic/mind-basic-imu.js');
const zero = { alpha: 0, beta: 0, gamma: 0 };
const pose = (position = [0, 0, -1], quaternion = [0, 0, 0, 1], scale = [1, 1, 1]) => ({ position, quaternion, scale });
const angle = (degrees) => [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)];
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function seed(options = {}, initial = pose()) {
  const state = imu.createState(options);
  imu.seedVisualPose(state, initial, 1000);
  imu.integrateGyroscope(state, zero, 990);
  imu.integrateGyroscope(state, zero, 1000);
  return state;
}

test('相机旋转同时反向旋转目标位置和姿态，距离不变', () => {
  const state = seed();
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, 1100);
  close(state.position[0], Math.sin(Math.PI / 20));
  close(state.position[2], -Math.cos(Math.PI / 20));
  close(Math.hypot(...state.position), 1);
  close(state.orientation[1], -Math.sin(Math.PI / 40));
  close(Math.hypot(...state.orientation), 1);
  const prior = imu.getPose(state, 1100);
  assert.equal(imu.integrateGyroscope(state, zero, 1090), false);
  assert.equal(state.lastGyroscopeAt, 1100);
  assert.equal(imu.integrateGyroscope(state, zero, 1500), false);
  assert.deepEqual(imu.getPose(state, 1500), prior);
  assert.equal(imu.isGyroscopeFresh(state, 1500), false);
});

test('按时间纠偏，15Hz 与 60Hz 视觉更新经过同样时间得到相同结果', () => {
  const run = (hz) => {
    const state = seed({}, pose([0, 0, -1], angle(20)));
    for (let i = 1; i <= hz; i += 1) {
      const time = 1000 + i * 1000 / hz;
      imu.integrateGyroscope(state, zero, time);
      imu.correctVisualPose(state, pose(), { timestamp: time });
    }
    return state.orientation;
  };
  const slow = run(15), fast = run(60);
  slow.forEach((value, index) => close(value, fast[index]));
  close(2 * Math.atan2(slow[1], slow[3]) * 180 / Math.PI, 20 * Math.exp(-1 / 0.8));
});

test('快速旋转下延迟视觉观测对预测方向的回拉更小', () => {
  const result = (speed) => {
    const state = seed({}, pose([0, 0, -1], angle(10)));
    state.angularSpeedDegrees = speed;
    imu.correctVisualPose(state, pose(), { timestamp: 1040 });
    return state.orientation[1];
  };
  assert.ok(result(180) > result(0));
});

test('孤立视觉突跳被拒绝，连续可信的新位置可以逐渐纠正', () => {
  const state = seed();
  const jump = pose([1, 0, -1], angle(80));
  assert.equal(imu.correctVisualPose(state, jump, { timestamp: 1030 }), false);
  assert.deepEqual(state.position, [0, 0, -1]);
  assert.equal(imu.correctVisualPose(state, pose(), { timestamp: 1060 }), true);
  assert.equal(imu.correctVisualPose(state, jump, { timestamp: 1090 }), false);
  assert.equal(imu.correctVisualPose(state, jump, { timestamp: 1120 }), false);
  assert.equal(imu.correctVisualPose(state, jump, { timestamp: 1150 }), true);
  assert.ok(state.position[0] > 0 && state.position[0] < 1);
  assert.ok(state.orientation[1] > 0 && state.orientation[1] < jump.quaternion[1]);
});

test('失锁后默认只旋转；超过平移窗口仍旋转，传感器过期返回空', () => {
  const state = seed({ maxLossDurationMs: 200 });
  imu.beginTrackingLoss(state, 1000);
  assert.equal(imu.integrateLinearAcceleration(state, [100, 0, 0], 1050), false);
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, 1100);
  assert.ok(imu.getPose(state, 1100).position[0] > 0);
  imu.integrateGyroscope(state, zero, 1200);
  assert.ok(imu.getPose(state, 1201));
  assert.equal(imu.getPose(state, 1500), null);
  const noSensor = imu.createState();
  imu.seedVisualPose(noSensor, pose(), 1000);
  imu.beginTrackingLoss(noSensor, 1000);
  assert.equal(imu.getPose(noSensor, 1001), null);
});

test('失锁重获连续三帧稳定才平滑纠偏，长时间失锁也不跳变', () => {
  const state = seed();
  imu.beginTrackingLoss(state, 1000);
  imu.integrateGyroscope(state, zero, 1050);
  for (const time of [1010, 1030]) {
    assert.equal(imu.correctVisualPose(state, pose([0.2, 0.1, -1], angle(10)), { timestamp: time }), false);
  }
  assert.equal(imu.correctVisualPose(state, pose([0.2, 0.1, -1], angle(10)), { timestamp: 1050 }), true);
  assert.ok(state.position[0] > 0 && state.position[0] < 0.2);
  assert.ok(state.orientation[1] > 0 && state.orientation[1] < angle(10)[1]);
  assert.equal(state.lossStartedAt, null);
  assert.deepEqual(state.velocity, [0, 0, 0]);
  assert.deepEqual(state.integratedTranslation, [0, 0, 0]);
  imu.beginTrackingLoss(state, 1060);
  const next = pose([2, 1, -2]);
  assert.equal(imu.correctVisualPose(state, next, { timestamp: 4000 }), false);
  assert.equal(imu.correctVisualPose(state, next, { timestamp: 4030 }), false);
  assert.equal(imu.correctVisualPose(state, next, { timestamp: 4060 }), true);
  const recovered = imu.getPose(state, 4060);
  assert.ok(recovered.position[0] > 0 && recovered.position[0] < 2);
});

test('可选位移积分按实体图宽转换像素坐标，旋转后补偿坐标仍一致', () => {
  const state = seed({ translationEnabled: true, targetWidthMeters: 0.2, velocityDamping: 0 },
    pose([0, 0, -1000], [0, 0, 0, 1], [400, 400, 400]));
  imu.beginTrackingLoss(state, 1000);
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1000);
  imu.integrateGyroscope(state, zero, 1100);
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1100);
  close(state.integratedTranslation[0], 0.01);
  close(imu.getPose(state, 1100).position[0], -20);
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, 1200);
  const predicted = imu.getPose(state, 1200);
  close(predicted.position[0], 1000 * Math.sin(Math.PI / 20) - 20 * Math.cos(Math.PI / 20));
  close(predicted.position[2], -1000 * Math.cos(Math.PI / 20) - 20 * Math.sin(Math.PI / 20));
});

test('静止死区、无效样本、速度和位移上限保护', () => {
  const state = seed({ translationEnabled: true, velocityDamping: 0, maxTranslationMeters: 0.08,
    maxVelocityMetersPerSecond: 0.5 });
  imu.beginTrackingLoss(state, 1000);
  imu.integrateLinearAcceleration(state, [0.01, 0, 0], 1000);
  imu.integrateLinearAcceleration(state, [0.01, 0, 0], 1050);
  assert.deepEqual(state.integratedTranslation, [0, 0, 0]);
  assert.equal(imu.integrateLinearAcceleration(state, { x: null, y: 0, z: 0 }, 1060), false);
  imu.integrateLinearAcceleration(state, [100, 0, 0], 1100);
  for (let time = 1200; time <= 1500; time += 100) {
    imu.integrateGyroscope(state, zero, time);
    imu.integrateLinearAcceleration(state, [100, 0, 0], time);
  }
  assert.ok(Math.hypot(...state.integratedTranslation) <= 0.08);
  assert.equal(state.translationLimitReached, true);
  assert.ok(imu.getPose(state, 1500));
});

test('屏幕四方向映射保留物理旋转轴；无效姿态不能建立锚点', () => {
  assert.deepEqual(imu.rotateForScreen([1, 2, 3], 90), [2, -1, 3]);
  assert.deepEqual(imu.rotateForScreen([1, 2, 3], 180), [-1, -2, 3]);
  assert.deepEqual(imu.rotateForScreen([1, 2, 3], 270), [-2, 1, 3]);
  const state = imu.createState();
  assert.equal(imu.seedVisualPose(state, pose([NaN, 0, 0])), false);
  assert.equal(imu.seedVisualPose(state, pose([0, 0, -1], [0, 0, 0, 0])), false);
  assert.equal(imu.seedVisualPose(state, pose([0, 0, -1], [0, 0, 0, 1], [0, 0, 0])), false);
});

test('校准拒绝转动、线性加速度和振荡样本，只接受静止窗口', () => {
  const samples = [];
  for (let i = 0; i < 40; i += 1) {
    assert.equal(imu.collectCalibrationSample(samples, { alpha: 0, beta: 0, gamma: 30 }, [0, 0, 0], i * 60), null);
  }
  assert.equal(samples.length, 0);
  for (let i = 0; i < 24; i += 1) {
    assert.equal(imu.collectCalibrationSample(samples, { alpha: 0, beta: i % 2 ? 1 : -1, gamma: 0 }, [0, 0, 0], i * 60), null);
  }
  assert.equal(samples.length, 0);
  assert.equal(imu.collectCalibrationSample(samples, zero, [0, 1, 0], 1500), null);
  let bias;
  for (let i = 0; i < 24; i += 1) {
    bias = imu.collectCalibrationSample(samples, { alpha: 0.1, beta: 0.2, gamma: -0.1 }, [0, 0, 0], 2000 + i * 60);
  }
  [0.2, -0.1, 0.1].forEach((value, index) => close(bias.gyroBias[index], value));
});


test('视觉可见期间也预测平移，纠偏吸收位移但保留速度且失锁无跳变', () => {
  const state = seed({ translationEnabled: true, velocityDamping: 0 });
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1000);
  imu.integrateGyroscope(state, zero, 1100);
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1100);
  const predicted = imu.getPose(state, 1100);
  close(predicted.position[0], -0.05);
  close(state.velocity[0], 0.1);
  imu.correctVisualPose(state, pose(), { timestamp: 1100 });
  const corrected = imu.getPose(state, 1100);
  assert.ok(corrected.position[0] > predicted.position[0] && corrected.position[0] < 0);
  close(state.velocity[0], 0.1);
  assert.deepEqual(state.integratedTranslation, [0, 0, 0]);
  imu.integrateGyroscope(state, zero, 1200);
  imu.integrateLinearAcceleration(state, [0, 0, 0], 1200);
  const beforeLoss = imu.getPose(state, 1200);
  imu.beginTrackingLoss(state, 1200);
  assert.deepEqual(imu.getPose(state, 1200), beforeLoss);
  assert.ok(beforeLoss.position[0] < corrected.position[0]);
});

test('视觉纠偏重新定基准时旋转速度向量，避免相机旋转后平移轴跳变', () => {
  const state = seed({ translationEnabled: true, velocityDamping: 0 });
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1000);
  imu.integrateGyroscope(state, zero, 1100);
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1100);
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, 1200);
  const current = imu.getPose(state, 1200);
  imu.correctVisualPose(state, current, { timestamp: 1200 });
  close(state.velocity[0], 0.1 * Math.cos(Math.PI / 20));
  close(state.velocity[2], 0.1 * Math.sin(Math.PI / 20));
  assert.deepEqual(imu.getPose(state, 1200), current);
});

test('平移窗口耗尽后冻结积分但继续旋转，传感器缺失不跨间隔补积分', () => {
  const state = seed({ translationEnabled: true, maxLossDurationMs: 200, velocityDamping: 0 });
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1000);
  imu.integrateGyroscope(state, zero, 1100);
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1100);
  imu.beginTrackingLoss(state, 1100);
  const displacement = state.integratedTranslation.slice();
  for (const time of [1200, 1300, 1400]) {
    imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, time);
    if (time > 1200) assert.equal(imu.integrateLinearAcceleration(state, [1, 0, 0], time), false);
  }
  assert.deepEqual(state.integratedTranslation, displacement);
  assert.deepEqual(state.velocity, [0, 0, 0]);
  assert.ok(imu.getPose(state, 1400).quaternion[1] < -0.1);
  assert.equal(imu.getPose(state, 1800), null);
  imu.integrateGyroscope(state, zero, 1800);
  assert.equal(imu.integrateLinearAcceleration(state, [1, 0, 0], 1800), false);
  assert.deepEqual(state.integratedTranslation, displacement);
});


test('校准要求持续时间，估计两类零偏，短突发和断流不算校准完成', () => {
  const samples = [];
  for (let i = 0; i < 60; i += 1) assert.equal(imu.collectCalibrationSample(samples, zero, [0.2, 0, 0], i), null);
  let calibration;
  for (let i = 0; i < 25; i += 1) calibration = imu.collectCalibrationSample(samples,
    { alpha: 0.1, beta: 0.2, gamma: 0.1 }, [0.2, 0.02, 0], 2000 + i * 60);
  assert.deepEqual(calibration.accelerationBias.map(v=>Number(v.toFixed(2))), [0.2, 0.02, 0]);
  assert.ok(imu.setCalibration(seed(), calibration));
});

test('陀螺仪静止噪声不累计方向和位置漂移，真实慢转和快转仍响应', () => {
  const state = seed();
  imu.beginTrackingLoss(state, 1000);
  for (let t = 1020; t <= 11000; t += 20) {
    imu.integrateGyroscope(state, { alpha: 0.02, beta: -0.01, gamma: 0.02 }, t);
  }
  assert.deepEqual(imu.getPose(state, 11000), pose());
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 0.5 }, 11020);
  assert.ok(state.orientation[1] < 0);
  const prior = state.orientation[1];
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, 11040);
  assert.ok(state.orientation[1] < prior - 0.01);
});

test('视觉与传感器同时静止才零速更新，移动视觉和无视觉均不能触发', () => {
  const run = (moving, visible) => {
    const state = seed({ translationEnabled: true, velocityDamping: 0 });
    state.velocity = [0.1, 0, 0];
    for (let t = 1020; t <= 2020; t += 20) {
      if (visible) imu.observeVisualMotion(state, pose([moving ? (t - 1000) / 1000 : 0, 0, -1]), t);
      imu.recordLinearAcceleration(state, [0.03, 0, 0]);
      imu.integrateGyroscope(state, { alpha: 0.01, beta: 0, gamma: 0 }, t);
    }
    return state;
  };
  const still = run(false, true);
  assert.equal(still.stationary, true);
  assert.deepEqual(still.velocity, [0, 0, 0]);
  assert.ok(still.accelerationBias[0] > 0);
  assert.equal(run(true, true).stationary, false);
  assert.equal(run(false, false).stationary, false);
});

test('去重力加速度扣除零偏后不再积分，断流后滤波记忆清除', () => {
  const state = seed({ translationEnabled: true });
  imu.setCalibration(state, { gyroBias: [0, 0, 0], accelerationBias: [0.3, 0, 0] });
  for (let t = 1020; t <= 1500; t += 20) {
    imu.recordLinearAcceleration(state, [0.3, 0, 0]);
    imu.integrateGyroscope(state, zero, t);
    imu.integrateLinearAcceleration(state, [0.3, 0, 0], t);
  }
  assert.deepEqual(state.integratedTranslation, [0, 0, 0]);
  imu.integrateGyroscope(state, zero, 2000);
  assert.equal(state.filteredGyro, null);
  assert.equal(state.correctedAcceleration, null);
  assert.equal(state.stationary, false);
});


test('自适应陀螺仪死区整体翻倍且保留迟滞', () => {
  const state = seed();
  const sample = (speed, time) => imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: speed }, time);
  sample(0.1, 1020);
  assert.equal(state.angularSpeedDegrees, 0, '低于新的开启门限 0.162，不积分');
  sample(0.2, 1040);
  assert.ok(state.angularSpeedDegrees > 0);
  sample(0.1, 1060);
  assert.ok(state.angularSpeedDegrees > 0, '已开启后保持到低门限 0.09');
  sample(0.08, 1080);
  assert.equal(state.angularSpeedDegrees, 0);
});

test('间歇跟踪失败打断重获计数但不延长失锁窗口', () => {
  const state = seed();
  imu.beginTrackingLoss(state, 1000);
  assert.equal(imu.correctVisualPose(state, pose(), { timestamp: 1020 }), false);
  assert.equal(imu.correctVisualPose(state, pose(), { timestamp: 1040 }), false);
  imu.beginTrackingLoss(state, 1060);
  assert.equal(state.lossStartedAt, 1000);
  assert.equal(state.pendingVisualCount, 0);
  assert.equal(imu.correctVisualPose(state, pose(), { timestamp: 1080 }), false);
  assert.equal(imu.correctVisualPose(state, pose(), { timestamp: 1100 }), false);
  assert.equal(imu.correctVisualPose(state, pose(), { timestamp: 1120 }), true);
});


test('暂停预测保留当前位姿并清零速度，停用期间不补积分', () => {
  const state = seed({ translationEnabled: true, velocityDamping: 0 });
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1000);
  imu.integrateGyroscope(state, zero, 1100);
  imu.integrateLinearAcceleration(state, [1, 0, 0], 1100);
  imu.beginTrackingLoss(state, 1100);
  const prior = imu.getPose(state, 1100);
  imu.pausePrediction(state);
  assert.deepEqual(imu.getPose(state, 1100), prior);
  assert.deepEqual(state.velocity, [0, 0, 0]);
  assert.deepEqual(state.integratedTranslation, [0, 0, 0]);
  for (let t = 1120; t <= 1400; t += 20) {
    imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, t, 0, false);
  }
  assert.deepEqual(imu.getPose(state, 1400), prior);
  assert.equal(state.lossStartedAt, 1100);
  imu.integrateGyroscope(state, { alpha: 0, beta: 0, gamma: 90 }, 1420);
  assert.notDeepEqual(imu.getPose(state, 1420).quaternion, prior.quaternion);
});
