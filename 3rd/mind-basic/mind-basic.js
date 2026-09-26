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
    'mindBasicScene', 'mindBasicTargetPlane', 'mindBasicTargetAnchor'
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
    operationId: 0
  };

  function setStatus(message) {
    elements.mindBasicStatus.textContent = message;
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
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  async function startSelectedTarget() {
    if (state.isBusy || !state.system) return;
    const operationId = ++state.operationId;
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
      setStatus(`已识别“${findSelectedTarget()?.name || 'MindAR 官方示例卡片'}”，Softmind 模型已锚定。`);
    });
    elements.mindBasicTargetAnchor.addEventListener('targetLost', () => {
      if (state.isRunning) setStatus('定位运行中，正在寻找图片…');
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
