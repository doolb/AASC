/* Mind Basic 的 IMU 姿态预测、视觉校正与短时位移积分。 */
(function exposeMindBasicImu(root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    maxDeltaSeconds: 0.12,
    maxLossDurationMs: 1800,
    maxTranslationMeters: 0.25,
    maxVelocityMetersPerSecond: 1.2,
    accelerationDeadZone: 0.16,
    velocityDamping: 1.8,
    orientationCorrectionMs: 800,
    positionCorrectionMs: 250,
    sensorTimeoutMs: 250,
    visualTimeoutMs: 500,
    translationEnabled: false,
    targetWidthMeters: 0.2
  });

  let frameHandler = null;

  function vectorFrom(value, fallback = [0, 0, 0]) {
    if (Array.isArray(value) && value.length >= 3
      && value.slice(0, 3).every(Number.isFinite)) return value.slice(0, 3);
    if (value && [value.x, value.y, value.z].every(Number.isFinite)) {
      return [value.x, value.y, value.z];
    }
    return fallback ? fallback.slice() : null;
  }

  function quaternionFrom(value) {
    const quaternion = Array.isArray(value)
      ? value.slice(0, 4)
      : value && [value.x, value.y, value.z, value.w];
    if (!quaternion || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) {
      return [0, 0, 0, 1];
    }
    const magnitude = Math.hypot(...quaternion);
    if (magnitude < 1e-9) return [0, 0, 0, 1];
    return quaternion.map((component) => component / magnitude);
  }

  function multiplyQuaternion(leftValue, rightValue) {
    const [ax, ay, az, aw] = quaternionFrom(leftValue);
    const [bx, by, bz, bw] = quaternionFrom(rightValue);
    return quaternionFrom([
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ]);
  }

  function inverseQuaternion(value) {
    const [x, y, z, w] = quaternionFrom(value);
    return [-x, -y, -z, w];
  }

  function slerpQuaternion(fromValue, toValue, amountValue) {
    const from = quaternionFrom(fromValue);
    let to = quaternionFrom(toValue);
    const amount = Math.max(0, Math.min(1, Number(amountValue) || 0));
    let dot = from.reduce((sum, component, index) => sum + component * to[index], 0);
    if (dot < 0) {
      to = to.map((component) => -component);
      dot = -dot;
    }
    if (dot > 0.9995) {
      return quaternionFrom(from.map((component, index) => component
        + amount * (to[index] - component)));
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sine = Math.sin(angle);
    const fromWeight = Math.sin((1 - amount) * angle) / sine;
    const toWeight = Math.sin(amount * angle) / sine;
    return quaternionFrom(from.map((component, index) => (
      component * fromWeight + to[index] * toWeight
    )));
  }

  function makeDeltaQuaternion(angularVelocity, deltaSeconds) {
    const speed = Math.hypot(...angularVelocity);
    if (!Number.isFinite(speed) || speed < 1e-9 || deltaSeconds <= 0) return [0, 0, 0, 1];
    const angle = speed * deltaSeconds;
    const halfAngle = angle / 2;
    const factor = Math.sin(halfAngle) / speed;
    return quaternionFrom([
      angularVelocity[0] * factor,
      angularVelocity[1] * factor,
      angularVelocity[2] * factor,
      Math.cos(halfAngle)
    ]);
  }

  function rotateVector(value, quaternionValue) {
    const [x, y, z] = vectorFrom(value);
    const [qx, qy, qz, qw] = quaternionFrom(quaternionValue);
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    return [
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx
    ];
  }

  function rotateForScreen(vector, angleValue) {
    const [x, y, z] = vectorFrom(vector);
    const angle = ((Math.round((Number(angleValue) || 0) / 90) * 90) % 360 + 360) % 360;
    if (angle === 90) return [y, -x, z];
    if (angle === 180) return [-x, -y, z];
    if (angle === 270) return [-y, x, z];
    return [x, y, z];
  }

  function rotationRateVector(rotationRate, bias, screenAngle) {
    if (!rotationRate || ![rotationRate.alpha, rotationRate.beta, rotationRate.gamma]
      .every(Number.isFinite)) return null;
    const biasVector = vectorFrom(bias);
    const deviceAxes = [
      rotationRate.beta - biasVector[0],
      rotationRate.gamma - biasVector[1],
      rotationRate.alpha - biasVector[2]
    ];
    return rotateForScreen(deviceAxes, screenAngle).map((value) => value * Math.PI / 180);
  }

  function makePose(position, quaternion, scale) {
    return {
      position: vectorFrom(position),
      quaternion: quaternionFrom(quaternion),
      scale: vectorFrom(scale, [1, 1, 1])
    };
  }

  function cameraPoseFromTarget(pose, referenceScale) {
    if (!pose || !Array.isArray(pose.position) || pose.position.length !== 3
      || !Array.isArray(pose.quaternion) || pose.quaternion.length !== 4
      || !Array.isArray(pose.scale) || pose.scale.length !== 3
      || ![...pose.position, ...pose.quaternion, ...pose.scale].every(Number.isFinite)
      || pose.scale.some((value) => value <= 0) || Math.hypot(...pose.quaternion) < 1e-9
      || !Number.isFinite(referenceScale) || referenceScale <= 0) return null;
    // 视觉/融合状态保存目标相对相机的测量；渲染输出取逆，实际驱动世界中的相机。
    // MindAR postMatrix 的均匀尺度为目标像素宽度。固定世界尺度使用首次测量，
    // 不把模型变成单位尺寸，以免与 MindAR 设置的 near/far 裁剪单位冲突。
    const quaternion = inverseQuaternion(pose.quaternion);
    const factor = referenceScale / pose.scale[0];
    const position = rotateVector(pose.position.map((value) => -value * factor), quaternion);
    if (!position.every(Number.isFinite)) return null;
    return makePose(position, quaternion, [1, 1, 1]);
  }

  function createState(options = {}) {
    return {
      config: { ...DEFAULTS, ...options },
      gyroBias: [0, 0, 0],
      accelerationBias: [0, 0, 0],
      gyroNoise: 0.015,
      accelerationNoise: 0.02,
      filteredGyro: null,
      filteredAcceleration: null,
      correctedAcceleration: null,
      rawAngularSpeedDegrees: 0,
      gyroActive: false,
      stationary: false,
      quietSince: null,
      visualStill: null,
      visualStillAt: null,
      visualObservedAt: null,
      sensorOrientation: [0, 0, 0, 1],
      orientation: [0, 0, 0, 1],
      position: [0, 0, 0],
      scale: [1, 1, 1],
      lastVisualAt: null,
      lastCorrectionAt: null,
      pendingVisual: null,
      pendingVisualCount: 0,
      gyroReady: false,
      translationLimitReached: false,
      integratedTranslation: [0, 0, 0],
      velocity: [0, 0, 0],
      initialized: false,
      tracking: false,
      lossStartedAt: null,
      lastGyroscopeAt: null,
      lastAccelerationAt: null,
      angularSpeedDegrees: 0,
      acceleration: null,
      rejectedDeltaCount: 0
    };
  }

  function setGyroscopeBias(state, bias) {
    if (!state || !Array.isArray(bias) || bias.length < 3 || !bias.slice(0, 3).every(Number.isFinite)) {
      return false;
    }
    state.gyroBias = bias.slice(0, 3);
    return true;
  }

  // 不把损坏的矩阵或空传感器数据归一化成看似有效的姿态。
  function validPose(pose) {
    return Boolean(pose && vectorFrom(pose.position, null)
      && Array.isArray(pose.quaternion) && pose.quaternion.length === 4
      && pose.quaternion.every(Number.isFinite) && Math.hypot(...pose.quaternion) > 1e-9
      && vectorFrom(pose.scale, null)?.every((value) => value > 0));
  }

  function isGyroscopeFresh(state, timestamp) {
    return Boolean(state?.gyroReady && Number.isFinite(timestamp)
      && state.lastGyroscopeAt !== null && timestamp >= state.lastGyroscopeAt
      && timestamp - state.lastGyroscopeAt <= state.config.sensorTimeoutMs);
  }

  function clearTranslation(state) {
    state.integratedTranslation = [0, 0, 0];
    state.velocity = [0, 0, 0];
    state.sensorOrientation = [0, 0, 0, 1];
    state.lastAccelerationAt = null;
    state.translationLimitReached = false;
  }

  function seedVisualPose(state, poseValue, timestamp = state?.lastGyroscopeAt ?? 0) {
    if (!state || !validPose(poseValue) || !Number.isFinite(timestamp)) return false;
    const pose = makePose(poseValue.position, poseValue.quaternion, poseValue.scale);
    state.position = pose.position;
    state.orientation = pose.quaternion;
    state.scale = pose.scale;
    clearTranslation(state);
    state.initialized = true;
    state.tracking = true;
    state.lossStartedAt = null;
    state.lastVisualAt = timestamp;
    state.lastCorrectionAt = timestamp;
    state.pendingVisual = null;
    state.pendingVisualCount = 0;
    return true;
  }

  function quaternionAngle(a, b) {
    const right = quaternionFrom(b);
    const dot = quaternionFrom(a).reduce((sum, value, index) => sum + value * right[index], 0);
    return 2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI;
  }

  function positionDistance(a, b) {
    return Math.hypot(...a.map((value, index) => value - b[index]));
  }

  function correctVisualPose(state, poseValue, options = {}) {
    const timestamp = options.timestamp ?? state?.lastGyroscopeAt ?? 0;
    if (!state || !validPose(poseValue) || !Number.isFinite(timestamp)) return false;
    if (!state.initialized || options.stabilize === false) {
      return seedVisualPose(state, poseValue, timestamp);
    }
    if (state.lastCorrectionAt !== null && timestamp <= state.lastCorrectionAt) return false;
    const predicted = readPredictedPose(state);
    const pose = makePose(poseValue.position, poseValue.quaternion, poseValue.scale);
    const dt = Math.min(0.1, Math.max(0, (timestamp - state.lastCorrectionAt) / 1000));
    state.lastCorrectionAt = timestamp;

    // 延迟、误匹配或遮挡可产生孤立突跳；持续且相近的观测允许恢复，避免永远锁在旧位置。
    const range = Math.max(Math.hypot(...predicted.position), pose.scale[0]);
    const isOutlier = quaternionAngle(predicted.quaternion, pose.quaternion) > 35
      || positionDistance(predicted.position, pose.position) > range * 0.35;
    if (isOutlier || !state.tracking) {
      const consistent = state.pendingVisual
        && quaternionAngle(state.pendingVisual.quaternion, pose.quaternion) < 10
        && positionDistance(state.pendingVisual.position, pose.position) < range * 0.15;
      state.pendingVisualCount = consistent ? state.pendingVisualCount + 1 : 1;
      state.pendingVisual = pose;
      if (state.pendingVisualCount < 3) return false;
    }
    state.pendingVisual = null;
    state.pendingVisualCount = 0;

    // 快速旋转时降低视觉方向纠正，防止较旧的图像姿态反复拉回当前 IMU 预测。
    const motionFactor = 1 + Math.min(4, state.angularSpeedDegrees / 90);
    const orientationGain = 1 - Math.exp(-dt / (state.config.orientationCorrectionMs / 1000 * motionFactor));
    const positionGain = 1 - Math.exp(-dt / (state.config.positionCorrectionMs / 1000));
    state.position = predicted.position.map((value, index) => value
      + positionGain * (pose.position[index] - value));
    state.orientation = slerpQuaternion(predicted.quaternion, pose.quaternion, orientationGain);
    state.scale = pose.scale;
    // 视觉已吸收位移增量；速度仍有物理意义，必须随积分基准转到当前相机坐标。
    const velocity = rotateVector(state.velocity, inverseQuaternion(state.sensorOrientation));
    const lastAccelerationAt = state.lastAccelerationAt;
    clearTranslation(state);
    state.velocity = velocity;
    state.lastAccelerationAt = lastAccelerationAt;
    state.tracking = true;
    state.lossStartedAt = null;
    state.lastVisualAt = timestamp;
    return true;
  }

  function pausePrediction(state) {
    if (!state?.initialized) return;
    // 将已有位移吸收进当前位置再清零速度，防止关闭预测后跳回积分起点。
    const pose = readPredictedPose(state);
    state.position = pose.position;
    state.orientation = pose.quaternion;
    state.scale = pose.scale;
    clearTranslation(state);
  }

  function beginTrackingLoss(state, timestamp) {
    if (!state?.initialized || !Number.isFinite(timestamp)) return false;
    // 每个失败帧都打断重获确认，但不能重置失锁计时、无限延长平移预测。
    state.pendingVisual = null;
    state.pendingVisualCount = 0;
    if (!state.tracking) return false;
    state.tracking = false;
    state.lossStartedAt = timestamp;
    state.visualStillAt = null;
    state.visualObservedAt = null;
    state.visualStill = null;
    state.stationary = false;
    state.quietSince = null;
    // 丢失视觉不改变积分基准，避免清除已有位移造成模型跳回。
    state.pendingVisual = null;
    state.pendingVisualCount = 0;
    return true;
  }

  // 使用持续时间而非仅样本个数校准，避免高频事件在极短时间内完成校准。
  function collectCalibrationSample(samples, rotationRate, acceleration, timestamp) {
    const gyro = rotationRate && [rotationRate.beta, rotationRate.gamma, rotationRate.alpha];
    const linear = vectorFrom(acceleration, null);
    const last = samples.at(-1);
    if (!gyro?.every(Number.isFinite) || !Number.isFinite(timestamp)
      || Math.hypot(...gyro) > 3 || (linear && Math.hypot(...linear) > 0.5)) {
      samples.length = 0;
      return null;
    }
    if (last && (timestamp <= last.timestamp || timestamp - last.timestamp > 120)) samples.length = 0;
    samples.push({ gyro, linear, timestamp });
    if (samples.length < 24 || timestamp - samples[0].timestamp < 1200) return null;
    const stats = (values) => {
      const mean = [0, 1, 2].map((axis) => values.reduce((sum, value) => sum + value[axis], 0) / values.length);
      const noise = Math.max(...mean.map((value, axis) => Math.sqrt(values.reduce((sum, row) =>
        sum + (row[axis] - value) ** 2, 0) / values.length)));
      return { mean, noise };
    };
    const gyroStats = stats(samples.map((sample) => sample.gyro));
    const linearValues = samples.map((sample) => sample.linear).filter(Boolean);
    const accelStats = linearValues.length === samples.length ? stats(linearValues) : null;
    if (gyroStats.noise > 0.2 || (accelStats && accelStats.noise > 0.05)) {
      samples.length = 0;
      return null;
    }
    return { gyroBias: gyroStats.mean, gyroNoise: gyroStats.noise,
      accelerationBias: accelStats?.mean || [0, 0, 0], accelerationNoise: accelStats?.noise ?? 0.02 };
  }

  function setCalibration(state, calibration) {
    if (!state || !calibration || !setGyroscopeBias(state, calibration.gyroBias)) return false;
    state.accelerationBias = vectorFrom(calibration.accelerationBias);
    state.gyroNoise = Math.max(0, Number(calibration.gyroNoise) || 0);
    state.accelerationNoise = Math.max(0, Number(calibration.accelerationNoise) || 0);
    resetMotionFilter(state);
    return true;
  }

  function resetMotionFilter(state) {
    state.filteredGyro = null;
    state.filteredAcceleration = null;
    state.correctedAcceleration = null;
    state.gyroActive = false;
    state.stationary = false;
    state.quietSince = null;
  }

  function observeVisualMotion(state, pose, timestamp) {
    if (!state || !validPose(pose) || !Number.isFinite(timestamp)) return;
    if (state.visualObservedAt !== null && timestamp <= state.visualObservedAt) return;
    const metricPosition = pose.position.map((value) => value / pose.scale[0] * state.config.targetWidthMeters);
    const baseline = state.visualStill;
    const moved = !baseline || timestamp - state.visualObservedAt > 200
      || positionDistance(baseline.position, metricPosition) > 0.003
      || quaternionAngle(baseline.quaternion, pose.quaternion) > 0.25;
    if (moved) {
      state.visualStill = { position: metricPosition, quaternion: pose.quaternion.slice() };
      state.visualStillAt = timestamp;
      state.stationary = false;
      state.quietSince = null;
    }
    state.visualObservedAt = timestamp;
  }

  function conditionMotion(state, rotationRate, timestamp, dt) {
    const raw = [rotationRate.beta, rotationRate.gamma, rotationRate.alpha];
    state.rawAngularSpeedDegrees = Math.hypot(...raw);
    let corrected = raw.map((value, axis) => value - state.gyroBias[axis]);
    let linear = state.acceleration?.map((value, axis) => value - state.accelerationBias[axis]) || null;
    const quiet = Math.hypot(...corrected) < 0.3 && linear && Math.hypot(...linear) < 0.12;
    if (!quiet) state.quietSince = null;
    if (quiet && state.quietSince === null) state.quietSince = timestamp;
    const visualStill = state.visualStillAt !== null && timestamp - state.visualStillAt >= 600
      && timestamp - state.visualObservedAt <= 200 && timestamp >= state.visualObservedAt;
    state.stationary = Boolean(quiet && visualStill && timestamp - state.quietSince >= 600);
    if (state.stationary) {
      const gain = 1 - Math.exp(-dt / 15);
      state.gyroBias = state.gyroBias.map((value, axis) => value + gain * corrected[axis]);
      state.accelerationBias = state.accelerationBias.map((value, axis) => value + gain * linear[axis]);
      corrected = raw.map((value, axis) => value - state.gyroBias[axis]);
      linear = state.acceleration.map((value, axis) => value - state.accelerationBias[axis]);
      state.velocity = [0, 0, 0];
    }
    // 按噪声估计设置迟滞门限；运动开始越过高门限，停止降至低门限才关断。
    const threshold = 2 * Math.max(0.03, Math.min(0.25, state.gyroNoise * 3));
    const magnitude = Math.hypot(...corrected);
    state.gyroActive = state.gyroActive ? magnitude > threshold : magnitude > threshold * 1.8;
    const smooth = (previous, value, speed, fastThreshold) => {
      if (!previous || speed >= fastThreshold) return value.slice();
      const gain = 1 - Math.exp(-dt / 0.02);
      return previous.map((old, axis) => old + gain * (value[axis] - old));
    };
    state.filteredGyro = state.gyroActive && !state.stationary
      ? smooth(state.filteredGyro, corrected, magnitude, 3) : [0, 0, 0];
    state.filteredAcceleration = linear
      ? smooth(state.filteredAcceleration, linear, Math.hypot(...linear), 0.3) : null;
    state.correctedAcceleration = state.stationary ? [0, 0, 0] : state.filteredAcceleration?.slice() || null;
    return state.filteredGyro;
  }

  function recordLinearAcceleration(state, acceleration) {
    if (!state) return false;
    const linear = vectorFrom(acceleration, null);
    if (!linear || !linear.every(Number.isFinite)) {
      state.acceleration = null;
      return false;
    }
    state.acceleration = linear;
    return true;
  }

  function integrateGyroscope(state, rotationRate, timestamp, screenAngle = 0, predict = true) {
    if (!state || !Number.isFinite(timestamp)) return false;
    let rates = rotationRateVector(rotationRate, state.gyroBias, screenAngle);
    if (!rates) {
      state.gyroReady = false;
      state.lastGyroscopeAt = null;
      resetMotionFilter(state);
      return false;
    }
    const speed = Math.hypot(...rates) * 180 / Math.PI;
    state.angularSpeedDegrees = speed;
    if (state.lastGyroscopeAt !== null && timestamp <= state.lastGyroscopeAt) return false;
    if (state.lastGyroscopeAt === null) {
      resetMotionFilter(state);
      state.rawAngularSpeedDegrees = Math.hypot(rotationRate.beta, rotationRate.gamma, rotationRate.alpha);
      state.lastGyroscopeAt = timestamp;
      return true;
    }
    const deltaSeconds = (timestamp - state.lastGyroscopeAt) / 1000;
    state.lastGyroscopeAt = timestamp;
    if (deltaSeconds <= 0 || deltaSeconds > state.config.maxDeltaSeconds) {
      state.rejectedDeltaCount += 1;
      state.gyroReady = false;
      resetMotionFilter(state);
      return false;
    }
    const filtered = conditionMotion(state, rotationRate, timestamp, deltaSeconds);
    rates = rotateForScreen(filtered, screenAngle).map((value) => value * Math.PI / 180);
    state.angularSpeedDegrees = Math.hypot(...filtered);
    state.gyroReady = true;
    // 关闭该场景预测时仍更新采样/滤波，重新开启不跨停用期间补积分。
    if (!predict) return true;
    const sensorDelta = makeDeltaQuaternion(rates, deltaSeconds);
    state.sensorOrientation = multiplyQuaternion(state.sensorOrientation, sensorDelta);
    if (state.initialized) {
      const inverseDelta = inverseQuaternion(sensorDelta);
      state.orientation = multiplyQuaternion(inverseDelta, state.orientation);
      // 目标在相机坐标中的平移也随相机转动，不能只旋转模型的自身朝向。
      state.position = rotateVector(state.position, inverseDelta);
      if (state.pendingVisual) {
        state.pendingVisual.position = rotateVector(state.pendingVisual.position, inverseDelta);
        state.pendingVisual.quaternion = multiplyQuaternion(inverseDelta, state.pendingVisual.quaternion);
      }
    }
    return true;
  }

  function integrateLinearAcceleration(state, acceleration, timestamp, screenAngle = 0) {
    if (!state?.initialized || !state.config.translationEnabled || !Number.isFinite(timestamp)) return false;
    if (!isGyroscopeFresh(state, timestamp)
      || timestamp - state.lastVisualAt > state.config.maxLossDurationMs || state.translationLimitReached) {
      state.velocity = [0, 0, 0];
      state.lastAccelerationAt = null;
      return false;
    }
    if (!recordLinearAcceleration(state, acceleration)) {
      state.lastAccelerationAt = null;
      state.velocity = [0, 0, 0];
      return false;
    }
    const linear = state.correctedAcceleration
      || state.acceleration.map((value, axis) => value - state.accelerationBias[axis]);
    if (state.stationary) {
      state.velocity = [0, 0, 0];
      state.lastAccelerationAt = timestamp;
      return true;
    }
    if (state.lastAccelerationAt !== null && timestamp <= state.lastAccelerationAt) return false;
    if (state.lastAccelerationAt === null) {
      state.lastAccelerationAt = timestamp;
      return true;
    }
    const deltaSeconds = (timestamp - state.lastAccelerationAt) / 1000;
    state.lastAccelerationAt = timestamp;
    if (deltaSeconds <= 0 || deltaSeconds > state.config.maxDeltaSeconds) {
      state.rejectedDeltaCount += 1;
      state.velocity = [0, 0, 0];
      return false;
    }
    let accelerationInStartFrame = rotateVector(rotateForScreen(linear, screenAngle), state.sensorOrientation);
    if (Math.hypot(...accelerationInStartFrame) < state.config.accelerationDeadZone) {
      accelerationInStartFrame = [0, 0, 0];
    }
    state.velocity = state.velocity.map((value, index) => value
      + accelerationInStartFrame[index] * deltaSeconds);
    const velocityMagnitude = Math.hypot(...state.velocity);
    if (velocityMagnitude > state.config.maxVelocityMetersPerSecond) {
      const scale = state.config.maxVelocityMetersPerSecond / velocityMagnitude;
      state.velocity = state.velocity.map((value) => value * scale);
    }
    const damping = Math.exp(-state.config.velocityDamping * deltaSeconds);
    state.velocity = state.velocity.map((value) => value * damping);
    state.integratedTranslation = state.integratedTranslation.map((value, index) => (
      value + state.velocity[index] * deltaSeconds
    ));
    const distance = Math.hypot(...state.integratedTranslation);
    if (distance >= state.config.maxTranslationMeters) {
      const scale = state.config.maxTranslationMeters / distance;
      state.integratedTranslation = state.integratedTranslation.map((value) => value * scale);
      state.velocity = [0, 0, 0];
      state.translationLimitReached = true;
    }
    return true;
  }

  function getPose(state, timestamp) {
    if (!state?.initialized || !Number.isFinite(timestamp)) return null;
    if (!state.tracking && !isGyroscopeFresh(state, timestamp)) return null;
    // 平移预测有时间/距离限制；有效陀螺仪仍可持续更新相机旋转。
    return readPredictedPose(state);
  }

  function readPredictedPose(state) {
    // MindAR 的原始坐标以目标像素为尺度；加速度积分的米必须按实体图宽换算。
    const unitsPerMeter = state.scale[0] / state.config.targetWidthMeters;
    const displacement = state.config.translationEnabled && Number.isFinite(unitsPerMeter) && unitsPerMeter > 0
      ? rotateVector(state.integratedTranslation, inverseQuaternion(state.sensorOrientation))
        .map((value) => value * unitsPerMeter)
      : [0, 0, 0];
    return makePose(
      state.position.map((value, index) => value - displacement[index]),
      state.orientation,
      state.scale
    );
  }

  function getDiagnostics(state, timestamp) {
    if (!state) return null;
    const lostForMs = state.lossStartedAt === null || !Number.isFinite(timestamp)
      ? 0
      : Math.max(0, timestamp - state.lossStartedAt);
    return {
      angularSpeedDegrees: state.angularSpeedDegrees,
      rawAngularSpeedDegrees: state.rawAngularSpeedDegrees,
      correctedAcceleration: state.correctedAcceleration?.slice() || null,
      stationary: state.stationary,
      gyroBias: state.gyroBias.slice(),
      accelerationBias: state.accelerationBias.slice(),
      acceleration: state.acceleration?.slice() || null,
      velocity: state.velocity.slice(),
      translation: state.integratedTranslation.slice(),
      lostForMs,
      rejectedDeltaCount: state.rejectedDeltaCount
    };
  }

  function setFrameHandler(handler) {
    frameHandler = typeof handler === 'function' ? handler : null;
  }

  const api = Object.freeze({
    createState,
    isGyroscopeFresh,
    collectCalibrationSample,
    setGyroscopeBias,
    setCalibration,
    observeVisualMotion,
    seedVisualPose,
    correctVisualPose,
    beginTrackingLoss,
    pausePrediction,
    recordLinearAcceleration,
    integrateGyroscope,
    integrateLinearAcceleration,
    getPose,
    cameraPoseFromTarget,
    getDiagnostics,
    rotateForScreen,
    multiplyQuaternion,
    inverseQuaternion,
    slerpQuaternion,
    setFrameHandler
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.DisplayMmdImuCore = api;
    if (root.AFRAME && !root.AFRAME.components['mind-basic-imu-frame']) {
      root.AFRAME.registerComponent('mind-basic-imu-frame', {
        tick(time) {
          if (frameHandler) frameHandler(time);
        }
      });
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
