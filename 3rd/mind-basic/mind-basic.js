/* Mind Basic 独立示例的自定义定位图、本地存储与 MindAR 生命周期控制。 */
(function initializeMindBasic(root) {
  'use strict';

  const OFFICIAL_TARGET_ID = 'official';
  const OFFICIAL_TARGET_SRC = 'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.2/examples/image-tracking/assets/card-example/card.mind';
  const COMPILER_MODULE_URL = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';
  const DATABASE_NAME = 'mind-basic-targets';
  const TARGET_STORE = 'targets';
  const SELECTED_TARGET_KEY = 'mind-basic.selected-target.v1';
  const MAX_SOURCE_WIDTH = 640;
  const MAX_TARGET_WIDTH = 512;
  const MAX_CAPTURE_WIDTH = 1920;
  const DEFAULT_CROP_RECT = Object.freeze({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });

  const elements = Object.fromEntries([
    'mindBasicControls', 'mindBasicControlsBody', 'mindBasicControlsToggle',
    'mindBasicTargetSelect', 'mindBasicCaptureButton', 'mindBasicStartButton',
    'mindBasicStopButton', 'mindBasicDeleteButton', 'mindBasicStatus',
    'mindBasicProgress', 'mindBasicProgressText', 'mindBasicProgressValue',
    'mindBasicProgressBar', 'mindBasicCalibration', 'mindBasicCameraVideo',
    'mindBasicCalibrationCanvas', 'mindBasicCropFrame', 'mindBasicCaptureStage',
    'mindBasicTargetName', 'mindBasicTakePhotoButton', 'mindBasicRetakeButton',
    'mindBasicSaveButton', 'mindBasicCancelButton', 'mindBasicCalibrationHint',
    'mindBasicScene', 'mindBasicTargetPlane', 'mindBasicTargetAnchor', 'mindBasicImuStage', 'mindBasicCameraRig',
    'mindBasicImuToggle', 'mindBasicImuStabilize', 'mindBasicImuBridge', 'mindBasicImuReset',
    'mindBasicImuStatus', 'mindBasicImuAngular', 'mindBasicImuAcceleration',
    'mindBasicImuTranslation', 'mindBasicImuLostFor',
    'mindBasicImuCorrection', 'mindBasicImuCorrectionValue', 'mindBasicImuHold', 'mindBasicImuHoldValue',
    'mindBasicImuTargetWidth',
    'mindBasicQualityScore', 'mindBasicQualityPoints', 'mindBasicQualityRatio',
    'mindBasicQualityCoverage', 'mindBasicQualityError', 'mindBasicQualityAge',
    'mindBasicImuRawAngular', 'mindBasicImuCorrectedAcceleration', 'mindBasicImuStationary'
  ].map((id) => [id, document.getElementById(id)]));

  const state = {
    database: null,
    targets: [],
    selectedTargetId: OFFICIAL_TARGET_ID,
    scene: elements.mindBasicScene,
    system: null,
    isRunning: false,
    isBusy: false,
    cameraStream: null,
    photoBlob: null,
    photoCanvas: null,
    cropRect: { ...DEFAULT_CROP_RECT },
    cropDrag: null,
    controlsExpanded: true,
    captureRequestId: 0,
    mindUrl: null,
    planeUrl: null,
    resizeHandler: null,
    startPromise: null,
    operationId: 0,
    imuEnabled: false,
    imuState: null,
    imuTracked: false,
    targetVisible: false,
    imuMotionHandler: null,
    imuOrientationHandler: null,
    imuVisibilityHandler: null,
    imuSampleCount: 0,
    imuBiasSamples: [],
    imuCalibrating: false,
    imuCalibrationTimeout: null,
    imuMetricsUpdatedAt: 0,
    imuExpiryReported: false,
    imuScreenAngle: 0,
    imuPoseUpdateQueued: false,
    lastVisualPose: null,
    lastRenderedCameraPose: null,
    worldTargetScale: null,
    lastVisualReceivedAt: null,
    qualitySample: null,
    qualityDetach: null,
    qualityUpdatedAt: -Infinity,
    qualityLost: false,
    imuPredictionActive: null,
    imuFallbackReported: false
  };

  function setStatus(message) {
    elements.mindBasicStatus.textContent = message;
  }

  function setImuStatus(message) {
    elements.mindBasicImuStatus.textContent = message;
  }

  function updateMindQualityDisplay(now, force = false) {
    if (!force && now - state.qualityUpdatedAt < 100) return;
    state.qualityUpdatedAt = now;
    const sample = state.qualitySample;
    const metrics = sample?.metrics;
    const age = sample ? Math.max(0, now - sample.timestamp) : null;
    const stale = age !== null && age > 500;
    const usable = state.isRunning && !state.qualityLost && !stale && metrics;
    elements.mindBasicQualityScore.textContent = usable ? `${metrics.score} / 100` : '--';
    elements.mindBasicQualityPoints.textContent = usable ? `${metrics.points} / ${metrics.totalPoints}` : '--';
    elements.mindBasicQualityRatio.textContent = usable ? `${(metrics.ratio * 100).toFixed(0)}%` : '--';
    elements.mindBasicQualityCoverage.textContent = usable && metrics.coverage !== null
      ? `${(metrics.coverage * 100).toFixed(0)}%` : '--';
    elements.mindBasicQualityError.textContent = usable && metrics.rmse !== null ? `${metrics.rmse.toFixed(2)} px` : '--';
    let status = '等待识别';
    if (sample) status = metrics ? `${Math.round(age)} ms 前${metrics.tracking ? '' : ' · 跟踪失败'}` : '指标不可用';
    if (stale) status = '数据已过期';
    if (state.qualityLost) status = '定位已丢失';
    if (state.isRunning && !state.qualityDetach) status = '质量接口不可用';
    if (!state.isRunning) status = '未运行';
    elements.mindBasicQualityAge.textContent = status;
  }

  function observeMindQuality() {
    state.qualityDetach?.();
    state.qualitySample = null;
    state.qualityLost = false;
    state.qualityDetach = root.MindBasicQuality?.attach(state.system?.controller, (sample) => {
      if (!state.isRunning || sample.targetIndex !== 0) return;
      state.qualitySample = sample;
      if (sample.metrics?.tracking) state.qualityLost = false;
    }) || null;
    updateMindQualityDisplay(performance.now(), true);
  }

  function setImuControlsEnabled(enabled) {
    elements.mindBasicImuToggle.setAttribute('aria-pressed', String(enabled));
    elements.mindBasicImuToggle.textContent = enabled ? '关闭 IMU 辅助' : '启用 IMU 辅助';
    elements.mindBasicImuStabilize.disabled = !enabled;
    elements.mindBasicImuBridge.disabled = !enabled;
    elements.mindBasicImuReset.disabled = !enabled;
  }

  function getScreenAngle() {
    const angle = Number(root.screen?.orientation?.angle ?? root.orientation ?? 0);
    return Number.isFinite(angle) ? angle : 0;
  }

  function readTargetPose() {
    const object3D = elements.mindBasicTargetAnchor.object3D;
    if (!object3D?.position || !object3D?.quaternion || !object3D?.scale) return null;
    const position = object3D.position.clone?.() || object3D.position;
    const quaternion = object3D.quaternion.clone?.() || object3D.quaternion;
    const scale = object3D.scale.clone?.() || object3D.scale;
    // MindAR 关闭 matrixAutoUpdate 并直接提交 matrix，position/quaternion 属性可能仍是初值。
    if (object3D.matrixAutoUpdate === false && object3D.matrix?.decompose) {
      object3D.matrix.decompose(position, quaternion, scale);
    }
    const pose = { position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray() };
    if (![...pose.position, ...pose.quaternion, ...pose.scale].every(Number.isFinite)
      || pose.scale.some((value) => value <= 0) || Math.hypot(...pose.quaternion) < 1e-9) return null;
    return pose;
  }

  function readImuOptions() {
    const bounded = (element, fallback, min, max) => {
      const value = Number(element.value);
      return Number.isFinite(value) && element.value !== '' ? Math.max(min, Math.min(max, value)) : fallback;
    };
    return {
      orientationCorrectionMs: bounded(elements.mindBasicImuCorrection, 800, 200, 2000),
      maxLossDurationMs: bounded(elements.mindBasicImuHold, 1800, 200, 3000),
      translationEnabled: true,
      targetWidthMeters: bounded(elements.mindBasicImuTargetWidth, 20, 1, 300) / 100
    };
  }

  function resetImuPrediction() {
    const calibration = state.imuState;
    state.imuState = root.MindBasicImu.createState(readImuOptions());
    state.imuPredictionActive = null;
    if (calibration) root.MindBasicImu.setCalibration(state.imuState, calibration);
    state.lastVisualReceivedAt = null;
    state.lastVisualPose = null;
    state.lastRenderedCameraPose = null;
    state.imuExpiryReported = false;
    state.imuFallbackReported = false;
    setStageVisible(false);
  }

  function setStageVisible(visible) {
    const isVisible = Boolean(visible);
    if (elements.mindBasicImuStage.object3D) {
      elements.mindBasicImuStage.object3D.visible = isVisible;
    }
    elements.mindBasicImuStage.setAttribute('visible', String(isVisible));
  }

  function applyCameraPose(targetPose) {
    const cameraRig = elements.mindBasicCameraRig.object3D;
    const worldAnchor = elements.mindBasicImuStage.object3D;
    if (!cameraRig || !worldAnchor || !targetPose) return false;
    const referenceScale = state.worldTargetScale ?? targetPose.scale?.[0];
    const cameraPose = root.MindBasicImu?.cameraPoseFromTarget(targetPose, referenceScale);
    if (!cameraPose) return false;
    if (state.worldTargetScale === null) {
      // 一次定位会话内，图片和角色共享固定世界锚点；后续预测/纠偏只更新相机。
      state.worldTargetScale = referenceScale;
      worldAnchor.position.set(0, 0, 0);
      worldAnchor.quaternion.set(0, 0, 0, 1);
      worldAnchor.scale.set(referenceScale, referenceScale, referenceScale);
      worldAnchor.updateMatrix?.();
      worldAnchor.updateMatrixWorld?.(true);
    }
    cameraRig.position.set(...cameraPose.position);
    cameraRig.quaternion.set(...cameraPose.quaternion);
    cameraRig.scale.set(1, 1, 1);
    cameraRig.updateMatrix?.();
    cameraRig.updateMatrixWorld?.(true);
    // 只保存已经应用到相机的姿态，失锁保持不能退回原始视觉候选。
    state.lastRenderedCameraPose = {
      position: cameraPose.position.slice(), quaternion: cameraPose.quaternion.slice(), scale: cameraPose.scale.slice()
    };
    return true;
  }

  function updateWorldAnchorVisibility() {
    // 预测失效冻结相机；首次定位前和显式停止后不显示世界锚点下的模型。
    setStageVisible(state.isRunning && Boolean(state.lastRenderedCameraPose));
  }

  function applyVisualPose(pose) {
    if (!pose) return;
    state.lastVisualPose = {
      position: pose.position.slice(),
      quaternion: pose.quaternion.slice(),
      scale: pose.scale.slice()
    };
    if (!state.imuEnabled || !state.imuState) {
      applyCameraPose(pose);
      return;
    }
    const timestamp = performance.now();
    root.MindBasicImu.observeVisualMotion(state.imuState, pose, timestamp);
    const isStabilizing = elements.mindBasicImuStabilize.checked && !state.imuCalibrating;
    const wasTracking = state.imuState.tracking;
    const accepted = root.MindBasicImu.correctVisualPose(state.imuState, pose, { stabilize: isStabilizing, timestamp });
    if (accepted && !wasTracking) {
      state.imuExpiryReported = false;
      if (state.imuState.initialized) setImuStatus('视觉定位已确认；IMU 预测运动，视觉持续平滑纠偏。');
    }
    applyCameraPose(isStabilizing ? root.MindBasicImu.getPose(state.imuState, timestamp) : pose);
  }

  function updateImuMetrics(timestamp) {
    if (timestamp - state.imuMetricsUpdatedAt < 100) return;
    state.imuMetricsUpdatedAt = timestamp;
    const diagnostics = state.imuState
      ? root.MindBasicImu.getDiagnostics(state.imuState, timestamp)
      : null;
    if (!diagnostics) return;
    elements.mindBasicImuRawAngular.textContent = `${diagnostics.rawAngularSpeedDegrees.toFixed(3)} °/s`;
    elements.mindBasicImuStationary.textContent = diagnostics.stationary ? '视觉＋IMU 确认静止' : '运动或静止未确认';
    elements.mindBasicImuCorrectedAcceleration.textContent = diagnostics.correctedAcceleration
      ? `${diagnostics.correctedAcceleration.map((value) => value.toFixed(3)).join(', ')} m/s²` : '无可用样本';
    elements.mindBasicImuAngular.textContent = `${diagnostics.angularSpeedDegrees.toFixed(3)} °/s`;
    elements.mindBasicImuAcceleration.textContent = diagnostics.acceleration
      ? `${diagnostics.acceleration.map((value) => value.toFixed(3)).join(', ')} m/s²`
      : '无可用样本';
    elements.mindBasicImuTranslation.textContent = `${diagnostics.translation
      .map((value) => value.toFixed(3)).join(', ')} m`;
    elements.mindBasicImuLostFor.textContent = diagnostics.lostForMs > 0
      ? `${diagnostics.lostForMs.toFixed(0)} ms`
      : state.imuTracked ? '跟踪中' : '--';
  }

  function isVisualTrackingFresh(timestamp) {
    return state.targetVisible && state.imuTracked && state.lastVisualReceivedAt !== null
      && timestamp - state.lastVisualReceivedAt <= (state.imuState?.config.visualTimeoutMs ?? 500);
  }

  function syncImuPredictionMode(timestamp) {
    const enabled = isVisualTrackingFresh(timestamp)
      ? elements.mindBasicImuStabilize.checked : elements.mindBasicImuBridge.checked;
    if (!enabled && state.imuPredictionActive !== false) {
      root.MindBasicImu.pausePrediction(state.imuState);
    }
    state.imuPredictionActive = enabled;
    return enabled;
  }

  function updateImuSceneFrame() {
    if (document.visibilityState === 'hidden') return;
    const now = performance.now();
    updateMindQualityDisplay(now);
    if (!state.isRunning) return;
    if (!state.imuEnabled || !state.imuState) return;
    const imu = root.MindBasicImu;
    const fusion = state.imuState;
    const fresh = !state.imuCalibrating && imu.isGyroscopeFresh(fusion, now);
    // 有识别标志但没有新的可靠观测时，也要进入失锁状态，限制无视觉约束的平移积分。
    if (fusion.tracking && now - fusion.lastVisualAt > fusion.config.visualTimeoutMs) {
      imu.beginTrackingLoss(fusion, fusion.lastVisualAt);
    }
    const visualFresh = isVisualTrackingFresh(now);
    const predicting = syncImuPredictionMode(now) && fresh;

    if (!predicting) {
      if (visualFresh && state.lastVisualPose) {
        // 传感器过期时也保留视觉接纳门槛，不绕过滤波直接应用候选原始矩阵。
        const fallback = elements.mindBasicImuStabilize.checked && fusion.initialized
          ? imu.getPose(fusion, now) : state.lastVisualPose;
        if (fallback) applyCameraPose(fallback);
        updateWorldAnchorVisibility();
      } else {
        updateWorldAnchorVisibility();
      }
      if (!fresh && !state.imuCalibrating && !state.imuFallbackReported) {
        setImuStatus('陀螺仪数据缺失或过期；使用可用视觉姿态，失锁时保留最后姿态。');
        state.imuFallbackReported = true;
      }
      updateImuMetrics(now);
      return;
    }
    if (state.imuFallbackReported) {
      setImuStatus('IMU 已恢复；预测旋转与平移，视觉持续纠偏。');
      state.imuFallbackReported = false;
    }
    const pose = imu.getPose(fusion, now);
    if (pose) applyCameraPose(pose);
    updateWorldAnchorVisibility();
    if (fusion.lossStartedAt !== null && !state.imuExpiryReported
      && (now - fusion.lastVisualAt > fusion.config.maxLossDurationMs || fusion.translationLimitReached)) {
      setImuStatus('失锁平移预测已停止；陀螺仪有效时继续旋转，等待稳定视觉重新校准。');
      state.imuExpiryReported = true;
    }
    updateImuMetrics(now);
  }

  function handleTargetPoseUpdate() {
    if (state.imuPoseUpdateQueued) return;
    state.imuPoseUpdateQueued = true;
    queueMicrotask(() => {
      state.imuPoseUpdateQueued = false;
      if (!state.targetVisible || !state.isRunning || document.visibilityState === 'hidden') return;
      // MindAR 在 missTolerance 窗口内仍会重复旧矩阵，不能把它视为新视觉观测。
      if (state.system?.controller?.trackingStates?.[0]?.isTracking === false) {
        state.imuTracked = false;
        state.lastVisualReceivedAt = null;
        if (state.imuEnabled && state.imuState) {
          root.MindBasicImu.beginTrackingLoss(state.imuState, performance.now());
        }
        updateImuSceneFrame();
        return;
      }
      const pose = readTargetPose();
      if (!pose) return;
      state.imuTracked = true;
      state.lastVisualReceivedAt = performance.now();
      applyVisualPose(pose);
      updateWorldAnchorVisibility();
      updateImuSceneFrame();
    });
  }

  function updateCalibrationSamples(event, timestamp) {
    if (!state.imuCalibrating) return false;
    const fusion = state.imuState;
    // 有视觉时，校准也必须避开已观测到的相机运动；无视觉时依赖用户静置和传感器窗口。
    if (fusion.visualObservedAt !== null && timestamp - fusion.visualObservedAt <= 200
      && timestamp - fusion.visualStillAt < 600) {
      state.imuBiasSamples.length = 0;
      return true;
    }
    const bias = root.MindBasicImu.collectCalibrationSample(
      state.imuBiasSamples, event.rotationRate, event.acceleration, timestamp
    );
    if (!bias) return true;
    root.MindBasicImu.setCalibration(state.imuState, bias);
    state.imuCalibrating = false;
    state.imuState.lastGyroscopeAt = null;
    clearTimeout(state.imuCalibrationTimeout);
    state.imuCalibrationTimeout = null;
    setImuStatus('IMU 已校准。IMU 预测旋转与平移，视觉持续纠偏；请按实物填写定位图宽度。');
    return true;
  }

  function handleDeviceMotion(event) {
    if (!state.imuEnabled || !state.imuState || document.visibilityState === 'hidden') return;
    state.imuSampleCount += 1;
    const timestamp = performance.now();
    root.MindBasicImu.recordLinearAcceleration(state.imuState, event.acceleration);
    if (updateCalibrationSamples(event, timestamp)) {
      updateImuMetrics(timestamp);
      return;
    }
    root.MindBasicImu.integrateGyroscope(
      state.imuState,
      event.rotationRate,
      timestamp,
      state.imuScreenAngle,
      syncImuPredictionMode(timestamp)
    );
    if (state.imuPredictionActive) {
      root.MindBasicImu.integrateLinearAcceleration(
        state.imuState,
        event.acceleration,
        timestamp,
        state.imuScreenAngle
      );
    }
    updateImuMetrics(timestamp);
  }

  function clearImuListeners() {
    if (state.imuMotionHandler) root.removeEventListener('devicemotion', state.imuMotionHandler);
    if (state.imuOrientationHandler) root.removeEventListener('orientationchange', state.imuOrientationHandler);
    if (state.imuVisibilityHandler) document.removeEventListener('visibilitychange', state.imuVisibilityHandler);
    state.imuMotionHandler = null;
    state.imuOrientationHandler = null;
    state.imuVisibilityHandler = null;
    clearTimeout(state.imuCalibrationTimeout);
    state.imuCalibrationTimeout = null;
  }

  function stopImuSensors(message = 'IMU 已关闭；MindAR 使用原始视觉定位。') {
    clearImuListeners();
    state.imuEnabled = false;
    state.imuCalibrating = false;
    state.imuTracked = state.targetVisible;
    state.imuState = root.MindBasicImu?.createState?.(readImuOptions()) || null;
    state.imuPredictionActive = null;
    state.imuBiasSamples = [];
    state.imuSampleCount = 0;
    state.imuExpiryReported = false;
    setImuControlsEnabled(false);
    const pose = state.targetVisible ? readTargetPose() : null;
    if (pose && state.isRunning) {
      applyCameraPose(pose);
      updateWorldAnchorVisibility();
    } else {
      updateWorldAnchorVisibility();
    }
    setImuStatus(message);
  }

  async function startImuSensors() {
    if (state.imuEnabled) return;
    try {
      if (!root.isSecureContext) throw new Error('设备传感器只在 HTTPS 或可信本地页面开放');
      if (!root.MindBasicImu) throw new Error('IMU 算法模块未加载，纯 MindAR 定位仍可继续使用');
      if (!root.DeviceMotionEvent) throw new Error('浏览器不支持设备运动传感器');
      if (typeof root.DeviceMotionEvent.requestPermission === 'function') {
        const permission = await root.DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') throw new Error('设备运动权限未获准');
      }
      state.imuState = root.MindBasicImu.createState(readImuOptions());
      state.imuPredictionActive = null;
      state.imuEnabled = true;
      state.imuTracked = state.isRunning && state.targetVisible;
      state.imuScreenAngle = getScreenAngle();
      state.imuBiasSamples = [];
      state.imuSampleCount = 0;
      state.imuCalibrating = true;
      state.imuExpiryReported = false;
      setImuControlsEnabled(true);
      if (state.imuTracked) root.MindBasicImu.seedVisualPose(state.imuState, readTargetPose(), performance.now());
      state.imuMotionHandler = handleDeviceMotion;
      state.imuOrientationHandler = () => {
        state.imuScreenAngle = getScreenAngle();
        resetImuPrediction();
        state.imuBiasSamples = [];
      };
      state.imuVisibilityHandler = () => {
        resetImuPrediction();
        state.imuBiasSamples = [];
      };
      root.addEventListener('devicemotion', state.imuMotionHandler, { passive: true });
      root.addEventListener('orientationchange', state.imuOrientationHandler, { passive: true });
      document.addEventListener('visibilitychange', state.imuVisibilityHandler);
      setImuStatus('请保持手机静止，正在校准陀螺仪偏置与加速度零偏（至少 1.2 秒）…');
      state.imuCalibrationTimeout = setTimeout(() => {
        if (state.imuCalibrating) {
          setImuStatus(state.imuSampleCount
            ? '静止校准未完成，IMU 保持暂停；请静置后点击重新校准。'
            : '等待设备运动数据；请确认 HTTPS、权限和浏览器传感器支持。');
        }
      }, 8000);
    } catch (error) {
      stopImuSensors(error.message || '无法启用 IMU');
    }
  }

  function resetImuCalibration() {
    if (!state.imuEnabled) return;
    const pose = state.imuTracked ? readTargetPose() : state.lastVisualPose;
    state.imuState = root.MindBasicImu.createState(readImuOptions());
    state.imuPredictionActive = null;
    state.imuBiasSamples = [];
    state.imuSampleCount = 0;
    state.imuCalibrating = true;
    state.imuExpiryReported = false;
    if (state.imuTracked && pose) root.MindBasicImu.seedVisualPose(state.imuState, pose, performance.now());
    setImuStatus('请保持手机静止，正在重新校准陀螺仪偏置与加速度零偏（至少 1.2 秒）…');
    clearTimeout(state.imuCalibrationTimeout);
    state.imuCalibrationTimeout = setTimeout(() => {
      if (state.imuCalibrating) {
        setImuStatus('静止校准未完成，IMU 保持暂停；请静置后点击重新校准。');
      }
    }, 8000);
  }

  function setBusy(value) {
    state.isBusy = value;
    elements.mindBasicTargetSelect.disabled = value;
    elements.mindBasicCaptureButton.disabled = value;
    elements.mindBasicStartButton.disabled = value || state.isRunning;
    elements.mindBasicStopButton.disabled = value || !state.isRunning;
    elements.mindBasicDeleteButton.disabled = value
      || state.selectedTargetId === OFFICIAL_TARGET_ID;
  }

  function showProgress(message, percentage) {
    const safePercentage = Math.max(0, Math.min(100, Math.round(percentage)));
    elements.mindBasicProgress.hidden = false;
    elements.mindBasicProgressText.textContent = message;
    elements.mindBasicProgressValue.textContent = `${safePercentage}%`;
    elements.mindBasicProgressBar.value = safePercentage;
  }

  function hideProgress() {
    elements.mindBasicProgress.hidden = true;
    elements.mindBasicProgressBar.value = 0;
  }

  function setControlsExpanded(expanded) {
    state.controlsExpanded = Boolean(expanded);
    elements.mindBasicControls.classList.toggle('is-collapsed', !state.controlsExpanded);
    elements.mindBasicControlsToggle.setAttribute('aria-expanded', String(state.controlsExpanded));
    elements.mindBasicControlsToggle.textContent = state.controlsExpanded ? '收起' : '展开控制';
    elements.mindBasicControlsToggle.setAttribute(
      'aria-label',
      state.controlsExpanded ? '收起控制面板' : '展开控制面板'
    );
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('读取本地定位图失败'));
    });
  }

  function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('保存本地定位图失败'));
      transaction.onabort = () => reject(transaction.error || new Error('本地定位图事务已取消'));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(TARGET_STORE)) {
          const store = database.createObjectStore(TARGET_STORE, { keyPath: 'targetId' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开浏览器本地定位图存储'));
    });
  }

  async function loadTargets() {
    state.database = await openDatabase();
    const transaction = state.database.transaction(TARGET_STORE, 'readonly');
    const records = await requestToPromise(transaction.objectStore(TARGET_STORE).getAll());
    state.targets = records
      .map((record) => {
        if (!record || typeof record.targetId !== 'string'
          || record.targetId === OFFICIAL_TARGET_ID || !(record.imageBlob instanceof Blob)) return null;
        const cropRect = root.MindBasicGeometry.getCropRect(record);
        return cropRect ? { ...record, cropRect } : null;
      })
      .filter(Boolean)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));

    const storedSelection = readSelectedTarget();
    state.selectedTargetId = storedSelection === OFFICIAL_TARGET_ID
      || state.targets.some((target) => target.targetId === storedSelection)
      ? storedSelection
      : OFFICIAL_TARGET_ID;
    renderTargetOptions();
  }

  function readSelectedTarget() {
    try {
      return localStorage.getItem(SELECTED_TARGET_KEY) || OFFICIAL_TARGET_ID;
    } catch (error) {
      console.warn('[Mind Basic] 无法读取上次选择的定位图:', error);
      return OFFICIAL_TARGET_ID;
    }
  }

  function rememberSelectedTarget(targetId) {
    try {
      localStorage.setItem(SELECTED_TARGET_KEY, targetId);
    } catch (error) {
      console.warn('[Mind Basic] 无法记住定位图选择:', error);
    }
  }

  function renderTargetOptions() {
    const official = document.createElement('option');
    official.value = OFFICIAL_TARGET_ID;
    official.textContent = 'MindAR 官方示例卡片';
    elements.mindBasicTargetSelect.replaceChildren(official);
    for (const target of state.targets) {
      const option = document.createElement('option');
      option.value = target.targetId;
      option.textContent = target.name || '未命名定位图';
      elements.mindBasicTargetSelect.appendChild(option);
    }
    elements.mindBasicTargetSelect.value = state.selectedTargetId;
    elements.mindBasicDeleteButton.disabled = state.selectedTargetId === OFFICIAL_TARGET_ID
      || state.isBusy;
  }

  function findSelectedTarget() {
    return state.targets.find((target) => target.targetId === state.selectedTargetId) || null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  async function decodeImage(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const temporaryUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = temporaryUrl;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  }

  function cropImageCanvas(sourceCanvas, cropRect, maximumDimension = 0) {
    const bounds = root.MindBasicGeometry.getPixelCropBounds(
      sourceCanvas.width,
      sourceCanvas.height,
      cropRect
    );
    if (!bounds) throw new Error('矩形裁剪范围无效');
    const scale = maximumDimension > 0
      ? Math.min(1, maximumDimension / Math.max(bounds.width, bounds.height))
      : 1;
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = Math.max(1, Math.round(bounds.width * scale));
    outputCanvas.height = Math.max(1, Math.round(bounds.height * scale));
    outputCanvas.getContext('2d').drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      outputCanvas.width,
      outputCanvas.height
    );
    return outputCanvas;
  }

  function renderCropSelection() {
    if (!state.photoCanvas || !root.MindBasicGeometry.isValidCropRect(state.cropRect)) return;
    elements.mindBasicCropFrame.style.left = `${state.cropRect.x * 100}%`;
    elements.mindBasicCropFrame.style.top = `${state.cropRect.y * 100}%`;
    elements.mindBasicCropFrame.style.width = `${state.cropRect.width * 100}%`;
    elements.mindBasicCropFrame.style.height = `${state.cropRect.height * 100}%`;
  }

  function getNormalizedCropPointer(event) {
    const bounds = elements.mindBasicCalibrationCanvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    };
  }

  function beginCropPointer(event) {
    if (!state.photoCanvas || event.button !== 0) return;
    const handle = event.target.closest('[data-crop-handle]')?.dataset.cropHandle || null;
    const pointer = getNormalizedCropPointer(event);
    if (!pointer) return;
    state.cropDrag = {
      pointerId: event.pointerId,
      mode: handle ? 'resize' : 'move',
      handle,
      startPointer: pointer,
      startRect: { ...state.cropRect }
    };
    elements.mindBasicCropFrame.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveCropPointer(event) {
    const drag = state.cropDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointer = getNormalizedCropPointer(event);
    if (!pointer) return;
    const deltaX = pointer.x - drag.startPointer.x;
    const deltaY = pointer.y - drag.startPointer.y;
    const nextRect = drag.mode === 'move'
      ? root.MindBasicGeometry.moveCropRect(drag.startRect, deltaX, deltaY)
      : root.MindBasicGeometry.resizeCropRect(
        drag.startRect,
        drag.handle,
        deltaX,
        deltaY,
        1 / state.photoCanvas.width,
        1 / state.photoCanvas.height
      );
    if (!nextRect) return;
    state.cropRect = nextRect;
    renderCropSelection();
  }

  function endCropPointer(event) {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) return;
    state.cropDrag = null;
    if (elements.mindBasicCropFrame.hasPointerCapture(event.pointerId)) {
      elements.mindBasicCropFrame.releasePointerCapture(event.pointerId);
    }
  }

  async function createCroppedTarget(target) {
    const image = await decodeImage(target.imageBlob);
    try {
      const scale = Math.min(1, MAX_SOURCE_WIDTH / image.width);
      const sourceWidth = Math.max(1, Math.round(image.width * scale));
      const sourceHeight = Math.max(1, Math.round(image.height * scale));
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = sourceWidth;
      sourceCanvas.height = sourceHeight;
      const sourceContext = sourceCanvas.getContext('2d');
      sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
      const cropRect = root.MindBasicGeometry.getCropRect(target);
      return cropImageCanvas(sourceCanvas, cropRect, MAX_TARGET_WIDTH);
    } finally {
      image.close?.();
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('无法生成图片数据'));
      }, 'image/jpeg', 0.92);
    });
  }

  function releaseCamera() {
    if (state.cameraStream) {
      for (const track of state.cameraStream.getTracks()) track.stop();
    }
    state.cameraStream = null;
    elements.mindBasicCameraVideo.pause();
    elements.mindBasicCameraVideo.srcObject = null;
  }

  function stopMindArSystem() {
    state.isRunning = false;
    state.qualityDetach?.();
    state.qualityDetach = null;
    state.qualitySample = null;
    state.qualityLost = false;
    updateMindQualityDisplay(performance.now(), true);
    state.targetVisible = false;
    state.imuTracked = false;
    state.lastVisualPose = null;
    state.lastRenderedCameraPose = null;
    state.worldTargetScale = null;
    state.imuExpiryReported = false;
    state.imuFallbackReported = false;
    setStageVisible(false);
    const cameraRig = elements.mindBasicCameraRig.object3D;
    if (cameraRig) {
      cameraRig.position.set(0, 0, 0);
      cameraRig.quaternion.set(0, 0, 0, 1);
      cameraRig.scale.set(1, 1, 1);
      cameraRig.updateMatrix?.();
      cameraRig.updateMatrixWorld?.(true);
    }
    const system = state.system;
    if (!system) return;
    const video = system.video;
    const controller = system.controller;
    if (state.resizeHandler) root.removeEventListener('resize', state.resizeHandler);
    try {
      if (video && controller && typeof system.pause === 'function') system.pause();
    } catch (error) {
      console.warn('[Mind Basic] 停止视频处理时继续清理资源:', error);
    }
    for (const track of video?.srcObject?.getTracks?.() || []) track.stop();
    try {
      controller?.dispose?.();
    } catch (error) {
      console.warn('[Mind Basic] 销毁 MindAR Controller 时继续清理资源:', error);
    }
    video?.remove();
    if (system.mainStats?.domElement?.isConnected) system.mainStats.domElement.remove();
    system.video = null;
    system.controller = null;
    system.mainStats = null;
    state.isRunning = false;
    if (state.mindUrl) URL.revokeObjectURL(state.mindUrl);
    state.mindUrl = null;
  }

  function trackMindArResizeHandler() {
    if (state.resizeHandler || typeof state.system?._resize !== 'function') return;
    const originalResize = state.system._resize;
    state.resizeHandler = originalResize.bind(state.system);
    const trackedResize = function trackedResize(...args) {
      return originalResize.apply(this, args);
    };
    // MindAR 1.2.5 每次启动都会把 _resize.bind(this) 注册到 window，却不在 stop() 中移除。
    // 固定同一个 handler 引用，停止/切换时才能移除，避免重复切换后窗口 resize 访问已销毁的视频。
    Object.defineProperty(trackedResize, 'bind', {
      configurable: true,
      value: () => state.resizeHandler
    });
    state.system._resize = trackedResize;
  }

  function replacePlaneSource(source, aspect, isObjectUrl) {
    elements.mindBasicTargetPlane.setAttribute('src', source);
    elements.mindBasicTargetPlane.setAttribute('width', '1');
    elements.mindBasicTargetPlane.setAttribute('height', String(aspect));
    if (state.planeUrl && state.planeUrl !== source) URL.revokeObjectURL(state.planeUrl);
    state.planeUrl = isObjectUrl ? source : null;
  }

  async function compileTarget(target, operationId) {
    showProgress('正在校正图片…', 0);
    const rectifiedCanvas = await createCroppedTarget(target);
    if (operationId !== state.operationId) throw new Error('定位任务已取消');
    const module = await import(COMPILER_MODULE_URL);
    const compiler = new module.Compiler();
    showProgress('正在编译定位图…', 0);
    await compiler.compileImageTargets([rectifiedCanvas], (progress) => {
      if (Number.isFinite(progress)) showProgress('正在编译定位图…', progress);
    });
    if (operationId !== state.operationId) throw new Error('定位任务已取消');
    const mindData = await compiler.exportData();
    const mindBlob = new Blob([mindData], { type: 'application/octet-stream' });
    const targetBlob = await canvasToBlob(rectifiedCanvas);
    return {
      mindUrl: URL.createObjectURL(mindBlob),
      planeUrl: URL.createObjectURL(targetBlob),
      aspect: rectifiedCanvas.height / rectifiedCanvas.width
    };
  }

  function prepareCameraBackground(operationId) {
    const video = state.system?.video;
    if (!video) return;
    // 使用 MindAR 实际创建的视频，不依赖其父节点；保留其尺寸与投影裁剪。
    video.classList.add('mind-basic-tracking-video');
    video.muted = true;
    video.playsInline = true;
    state.scene.object3D.background = null;
    state.scene.renderer?.setClearAlpha(0);
    const playCamera = async () => {
      if (operationId !== state.operationId || video !== state.system?.video) return;
      try {
        await video.play();
      } catch (error) {
        if (operationId !== state.operationId || video !== state.system?.video) return;
        setStatus('摄像头播放失败，请停止定位后重新开始。');
        console.warn('[Mind Basic] 播放跟踪摄像头失败:', error);
      }
    };
    if (video.readyState >= 1) void playCamera();
    else video.addEventListener('loadedmetadata', playCamera, { once: true });
  }

  function waitForArStart(operationId) {
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const cleanup = () => {
        clearTimeout(timeoutId);
        state.scene.removeEventListener('arReady', onReady);
        state.scene.removeEventListener('arError', onError);
        if (state.startPromise === pending) state.startPromise = null;
      };
      const onReady = () => {
        cleanup();
        if (operationId !== state.operationId) {
          reject(new Error('定位任务已取消'));
          return;
        }
        state.isRunning = true;
        observeMindQuality();
        setStatus('定位已启动，请将图片放入摄像头画面。');
        hideProgress();
        setBusy(false);
        resolve();
      };
      const onError = (event) => {
        cleanup();
        const error = event.detail?.error;
        reject(new Error(error ? `MindAR 启动失败：${error}` : 'MindAR 摄像头启动失败'));
      };
      const pending = { cancel: () => {
        cleanup();
        reject(new Error('定位任务已取消'));
      } };
      state.startPromise = pending;
      state.scene.addEventListener('arReady', onReady, { once: true });
      state.scene.addEventListener('arError', onError, { once: true });
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('MindAR 启动超时，请检查摄像头权限和网络后重试'));
      }, 120000);
      try {
        state.system.start();
        prepareCameraBackground(operationId);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async function startSelectedTarget() {
    if (state.isBusy || !state.system) return;
    const operationId = ++state.operationId;
    if (state.imuEnabled) stopImuSensors('定位正在重启；IMU 已关闭，请重新启用以继续实验。');
    setBusy(true);
    hideProgress();
    try {
      stopMindArSystem();
      const target = findSelectedTarget();
      let targetSrc = OFFICIAL_TARGET_SRC;
      if (target) {
        setStatus('正在准备自定义定位图…');
        const compiled = await compileTarget(target, operationId);
        if (operationId !== state.operationId) {
          URL.revokeObjectURL(compiled.mindUrl);
          URL.revokeObjectURL(compiled.planeUrl);
          return;
        }
        targetSrc = compiled.mindUrl;
        state.mindUrl = compiled.mindUrl;
        replacePlaneSource(compiled.planeUrl, compiled.aspect, true);
      } else {
        replacePlaneSource('#mindBasicTargetImage', 0.552, false);
      }
      if (operationId !== state.operationId) return;
      state.system.imageTargetSrc = targetSrc;
      setStatus('正在请求摄像头并启动定位…');
      await waitForArStart(operationId);
    } catch (error) {
      if (operationId !== state.operationId) return;
      stopMindArSystem();
      hideProgress();
      setBusy(false);
      setStatus(error.message || '定位启动失败，请重试。');
      console.error('[Mind Basic] 启动定位失败:', error);
    }
  }

  async function stopSelectedTarget() {
    if (state.isBusy) return;
    state.operationId += 1;
    state.startPromise?.cancel?.();
    stopMindArSystem();
    stopImuSensors('定位已停止，IMU 监听已关闭。');
    hideProgress();
    setBusy(false);
    setStatus('定位已停止。');
  }

  function updateCaptureStageSize() {
    const video = elements.mindBasicCameraVideo;
    const sourceWidth = state.photoCanvas?.width || video.videoWidth;
    const sourceHeight = state.photoCanvas?.height || video.videoHeight;
    if (!sourceWidth || !sourceHeight || elements.mindBasicCalibration.hidden) return;
    const availableWidth = Math.max(1, elements.mindBasicCaptureStage.parentElement.clientWidth - 2);
    const availableHeight = Math.max(1, Math.min(window.innerHeight * 0.58, 620) - 2);
    const scale = Math.min(
      availableWidth / sourceWidth,
      availableHeight / sourceHeight
    );
    elements.mindBasicCaptureStage.style.width = `${Math.round(sourceWidth * scale) + 2}px`;
    elements.mindBasicCaptureStage.style.height = `${Math.round(sourceHeight * scale) + 2}px`;
  }

  async function openCalibration() {
    if (state.isBusy) return;
    const captureRequestId = ++state.captureRequestId;
    state.operationId += 1;
    state.startPromise?.cancel?.();
    stopImuSensors('正在进行拍照校准；IMU 监听已关闭。');
    stopMindArSystem();
    hideProgress();
    elements.mindBasicCalibration.hidden = false;
    elements.mindBasicCameraVideo.hidden = false;
    elements.mindBasicCalibrationCanvas.hidden = true;
    elements.mindBasicCropFrame.hidden = true;
    elements.mindBasicTakePhotoButton.hidden = false;
    elements.mindBasicRetakeButton.hidden = true;
    elements.mindBasicTakePhotoButton.disabled = true;
    elements.mindBasicSaveButton.disabled = true;
    elements.mindBasicTargetName.value = '';
    state.photoBlob = null;
    state.photoCanvas = null;
    state.cropRect = { ...DEFAULT_CROP_RECT };
    elements.mindBasicCaptureStage.style.removeProperty('width');
    elements.mindBasicCaptureStage.style.removeProperty('height');
    setBusy(false);
    setStatus('正在请求后置摄像头…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头访问');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (captureRequestId !== state.captureRequestId || elements.mindBasicCalibration.hidden) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      state.cameraStream = stream;
      elements.mindBasicCameraVideo.srcObject = state.cameraStream;
      await new Promise((resolve, reject) => {
        const video = elements.mindBasicCameraVideo;
        const timeoutId = setTimeout(() => reject(new Error('等待摄像头画面超时')), 15000);
        const ready = () => {
          clearTimeout(timeoutId);
          video.removeEventListener('loadedmetadata', ready);
          resolve();
        };
        if (video.readyState >= 1) ready();
        else video.addEventListener('loadedmetadata', ready, { once: true });
      });
      if (captureRequestId !== state.captureRequestId || elements.mindBasicCalibration.hidden) return;
      await elements.mindBasicCameraVideo.play();
      updateCaptureStageSize();
      elements.mindBasicTakePhotoButton.disabled = false;
      elements.mindBasicCalibrationHint.textContent = '对准清晰、纹理丰富的定位图拍摄完整画面，之后可移动和调整矩形选区。';
    } catch (error) {
      releaseCamera();
      if (captureRequestId === state.captureRequestId) {
        elements.mindBasicCalibrationHint.textContent = error.message || '摄像头启动失败';
      }
    }
  }

  async function takePhoto() {
    const video = elements.mindBasicCameraVideo;
    if (!video.videoWidth || !video.videoHeight) {
      elements.mindBasicCalibrationHint.textContent = '摄像头画面尚未准备好，请稍候再拍。';
      return;
    }
    const scale = Math.min(1, MAX_CAPTURE_WIDTH / video.videoWidth);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    sourceCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    sourceCanvas.getContext('2d').drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
    try {
      state.photoBlob = await canvasToBlob(sourceCanvas);
      state.photoCanvas = sourceCanvas;
      state.cropRect = { ...DEFAULT_CROP_RECT };
      releaseCamera();
      video.hidden = true;
      elements.mindBasicCropFrame.hidden = false;
      elements.mindBasicCalibrationCanvas.hidden = false;
      elements.mindBasicTakePhotoButton.hidden = true;
      elements.mindBasicRetakeButton.hidden = false;
      elements.mindBasicTargetName.value = `定位图 ${new Date().toLocaleString()}`;
      elements.mindBasicCalibrationCanvas.width = sourceCanvas.width;
      elements.mindBasicCalibrationCanvas.height = sourceCanvas.height;
      elements.mindBasicCalibrationCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
      updateCaptureStageSize();
      renderCropSelection();
      elements.mindBasicSaveButton.disabled = false;
      elements.mindBasicCalibrationHint.textContent = '默认框四边内缩 10%；拖动框内可移动，拖动边或角可调整矩形大小。';
    } catch (error) {
      elements.mindBasicCalibrationHint.textContent = error.message || '拍照失败，请重试。';
    }
  }

  function retakePhoto() {
    void openCalibration();
  }

  function createTargetId() {
    if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID();
    return `target-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function saveCalibrationTarget() {
    if (!state.photoBlob || !root.MindBasicGeometry.isValidCropRect(state.cropRect)) return;
    const name = elements.mindBasicTargetName.value.trim() || '自定义定位图';
    const now = Date.now();
    const target = {
      targetId: createTargetId(),
      name,
      imageBlob: state.photoBlob,
      cropRect: { ...state.cropRect },
      createdAt: now,
      updatedAt: now
    };
    try {
      const transaction = state.database.transaction(TARGET_STORE, 'readwrite');
      const completion = transactionToPromise(transaction);
      transaction.objectStore(TARGET_STORE).put(target);
      await completion;
      state.targets.push(target);
      state.selectedTargetId = target.targetId;
      rememberSelectedTarget(state.selectedTargetId);
      renderTargetOptions();
      closeCalibration();
      setStatus('定位图已保存到本浏览器，正在编译并启动…');
      await startSelectedTarget();
    } catch (error) {
      elements.mindBasicCalibrationHint.textContent = error.message || '保存定位图失败';
    }
  }

  function closeCalibration() {
    state.captureRequestId += 1;
    releaseCamera();
    elements.mindBasicCalibration.hidden = true;
    elements.mindBasicCameraVideo.hidden = false;
    elements.mindBasicCalibrationCanvas.hidden = true;
    elements.mindBasicCropFrame.hidden = true;
    elements.mindBasicTakePhotoButton.hidden = false;
    elements.mindBasicRetakeButton.hidden = true;
    state.photoBlob = null;
    state.photoCanvas = null;
    elements.mindBasicCaptureStage.style.removeProperty('width');
    elements.mindBasicCaptureStage.style.removeProperty('height');
  }

  function cancelCalibration() {
    closeCalibration();
    setStatus('拍摄已取消；可重新启动当前定位。');
  }

  async function deleteSelectedTarget() {
    const target = findSelectedTarget();
    if (!target || state.isBusy) return;
    if (!confirm(`删除本地定位图“${target.name || '未命名定位图'}”？`)) return;
    try {
      const transaction = state.database.transaction(TARGET_STORE, 'readwrite');
      const completion = transactionToPromise(transaction);
      transaction.objectStore(TARGET_STORE).delete(target.targetId);
      await completion;
      state.targets = state.targets.filter((item) => item.targetId !== target.targetId);
      state.selectedTargetId = OFFICIAL_TARGET_ID;
      rememberSelectedTarget(OFFICIAL_TARGET_ID);
      renderTargetOptions();
      await startSelectedTarget();
    } catch (error) {
      setStatus(error.message || '删除定位图失败');
    }
  }

  function handleTargetSelection() {
    state.selectedTargetId = elements.mindBasicTargetSelect.value;
    rememberSelectedTarget(state.selectedTargetId);
    renderTargetOptions();
    if (state.isRunning) {
      void startSelectedTarget();
      return;
    }
    setStatus(state.selectedTargetId === OFFICIAL_TARGET_ID
      ? '已选择 MindAR 官方示例卡片。'
      : '已选择本地矩形定位图，点击“开始定位”后将在浏览器内编译。');
  }

  function bindTargetEvents() {
    elements.mindBasicTargetAnchor.addEventListener('targetFound', () => {
      state.targetVisible = true;
      state.imuTracked = true;
      state.imuExpiryReported = false;
      updateWorldAnchorVisibility();
      setStatus(`已识别“${findSelectedTarget()?.name || 'MindAR 官方示例卡片'}”，Softmind 模型已锚定。`);
      handleTargetPoseUpdate();
    });
    elements.mindBasicTargetAnchor.addEventListener('targetUpdate', handleTargetPoseUpdate);
    elements.mindBasicTargetAnchor.addEventListener('targetLost', () => {
      state.qualityLost = true;
      updateMindQualityDisplay(performance.now(), true);
      state.targetVisible = false;
      state.imuTracked = false;
      if (state.imuEnabled && state.imuState) {
        root.MindBasicImu.beginTrackingLoss(state.imuState, performance.now());
      }
      if (state.imuEnabled && state.imuState && elements.mindBasicImuBridge.checked) {
        const pose = root.MindBasicImu.getPose(state.imuState, performance.now());
        if (pose) applyCameraPose(pose);
        updateWorldAnchorVisibility();
        setImuStatus(pose
          ? '定位图丢失；IMU 继续预测旋转，平移在设定时间内继续估算。'
          : '定位图丢失；保留最后姿态，等待下一次视觉锚定。');
      } else {
        updateWorldAnchorVisibility();
        if (state.imuEnabled) setImuStatus('定位图丢失；失锁预测已关闭，模型保留最后姿态。');
      }
      if (state.isRunning) setStatus('定位图丢失，保留模型；正在重新寻找图片…');
    });
  }

  function waitForScene() {
    if (state.scene.hasLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('A-Frame 场景初始化超时')), 30000);
      state.scene.addEventListener('loaded', () => {
        clearTimeout(timeoutId);
        resolve();
      }, { once: true });
    });
  }

  function bindControls() {
    elements.mindBasicCaptureButton.addEventListener('click', () => void openCalibration());
    elements.mindBasicStartButton.addEventListener('click', () => void startSelectedTarget());
    elements.mindBasicStopButton.addEventListener('click', () => void stopSelectedTarget());
    elements.mindBasicDeleteButton.addEventListener('click', () => void deleteSelectedTarget());
    elements.mindBasicTargetSelect.addEventListener('change', handleTargetSelection);
    elements.mindBasicControlsToggle.addEventListener('click', () => {
      setControlsExpanded(!state.controlsExpanded);
    });
    elements.mindBasicImuToggle.addEventListener('click', () => {
      if (state.imuEnabled) stopImuSensors();
      else void startImuSensors();
    });
    elements.mindBasicImuReset.addEventListener('click', resetImuCalibration);
    const updateFusionOptions = () => {
      const options = readImuOptions();
      elements.mindBasicImuCorrectionValue.textContent = `${options.orientationCorrectionMs} ms`;
      elements.mindBasicImuHoldValue.textContent = `${options.maxLossDurationMs} ms`;
      if (state.imuState) Object.assign(state.imuState.config, options);
    };
    elements.mindBasicImuCorrection.addEventListener('input', updateFusionOptions);
    elements.mindBasicImuHold.addEventListener('input', updateFusionOptions);
    elements.mindBasicImuTargetWidth.addEventListener('change', () => {
      if (state.imuEnabled) resetImuPrediction();
      updateFusionOptions();
    });
    for (const input of [elements.mindBasicImuStabilize, elements.mindBasicImuBridge]) {
      input.addEventListener('change', updateImuSceneFrame);
    }
    elements.mindBasicTakePhotoButton.addEventListener('click', () => void takePhoto());
    elements.mindBasicRetakeButton.addEventListener('click', retakePhoto);
    elements.mindBasicSaveButton.addEventListener('click', () => void saveCalibrationTarget());
    elements.mindBasicCancelButton.addEventListener('click', cancelCalibration);
    elements.mindBasicCropFrame.addEventListener('pointerdown', beginCropPointer);
    elements.mindBasicCropFrame.addEventListener('pointermove', moveCropPointer);
    elements.mindBasicCropFrame.addEventListener('pointerup', endCropPointer);
    elements.mindBasicCropFrame.addEventListener('pointercancel', endCropPointer);
    root.addEventListener('resize', updateCaptureStageSize);
    elements.mindBasicCalibration.addEventListener('click', (event) => {
      if (event.target === elements.mindBasicCalibration) cancelCalibration();
    });
  }

  async function initialize() {
    try {
      bindControls();
      setControlsExpanded(true);
      setImuControlsEnabled(false);
      if (root.MindBasicImu) {
        root.MindBasicImu.setFrameHandler(updateImuSceneFrame);
      } else {
        elements.mindBasicImuToggle.disabled = true;
        setImuStatus('IMU 算法模块未加载；普通 MindAR 定位不受影响。');
      }
      bindTargetEvents();
      await loadTargets();
      await waitForScene();
      state.system = state.scene.systems['mindar-image-system'];
      if (!state.system) throw new Error('MindAR A-Frame system 未初始化');
      trackMindArResizeHandler();
      await startSelectedTarget();
    } catch (error) {
      setBusy(false);
      setStatus(error.message || 'MindAR 页面初始化失败');
      console.error('[Mind Basic] 初始化失败:', error);
    }
  }

  root.addEventListener('pagehide', () => {
    state.operationId += 1;
    state.captureRequestId += 1;
    state.startPromise?.cancel?.();
    stopImuSensors('页面已离开，IMU 监听已清理。');
    root.removeEventListener('resize', updateCaptureStageSize);
    elements.mindBasicCalibration.hidden = true;
    releaseCamera();
    stopMindArSystem();
    if (state.planeUrl) URL.revokeObjectURL(state.planeUrl);
    state.planeUrl = null;
  }, { once: true });

  root.addEventListener('pageshow', (event) => {
    if (event.persisted && state.system && !state.isRunning && !state.isBusy) {
      void startSelectedTarget();
    }
  });

  void initialize();
})(window);
