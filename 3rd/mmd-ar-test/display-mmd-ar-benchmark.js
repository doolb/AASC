/* MindAR 与现有图片跟踪器的独立 APK A/B 适配层。 */
(function exposeMmdArBenchmark(root) {
    'use strict';

    const MINDAR_VERSION = '1.2.5';
    // 动态 import 相对当前脚本解析；从脚本 URL 求同目录 vendor，兼容任意网页挂载前缀。
    const MINDAR_BASE = typeof document === 'object' && document.currentScript?.src
        ? new URL(`./vendor/mind-ar-${MINDAR_VERSION}`, document.currentScript.src).href
        : `/js/vendor/mind-ar-${MINDAR_VERSION}`;
    const ENGINE_LABELS = Object.freeze({ current: '当前 JS', mindar: 'MindAR' });
    const MINDAR_IMAGE_MAX_WIDTH = 512;
    const SOURCE_MAX_WIDTH = 640;
    const MINDAR_INPUT_MAX_PIXELS = 640 * 480;
    const MINDAR_INPUT_SCALE_KEY = 'aasc.mmdArTest.inputScalePercent.v1';
    const MINDAR_INPUT_SCALE_OPTIONS = Object.freeze([25, 35, 50, 75, 100]);
    const MINDAR_INPUT_REFRESH_MS = 100;
    const MINDAR_POSE_REFRESH_MS = 100;
    const benchmark = {
        currentEngine: root.MmdArTestMindArOnly === true ? 'mindar' : 'current',
        currentRun: null,
        reports: new Map(),
        lastRenderAt: 0,
        resources: new Map(),
        inputScalePercent: 100,
        activeInput: null
    };

    const originalTracker = root.DisplayMmdImageTargetTracker;
    const mindArOnly = root.MmdArTestMindArOnly === true;
    const metricsApi = root.MmdArBenchmarkMetrics;
    const compilerApi = root.MmdArBenchmarkCompiler;
    if ((!originalTracker && !mindArOnly) || !metricsApi || !compilerApi) {
        console.error('[MMD AR A/B] 测试跟踪器、指标模块或 MindAR 编译适配器未加载');
        return;
    }

    function mapPoseToCover(pose, video, layer) {
        if (originalTracker) return originalTracker.mapPoseToCover(pose, video, layer);
        // 仅 MindAR 网页不加载旧跟踪器；仍需把相机原始帧坐标映射到 cover 裁切后的舞台。
        const width = Math.max(1, layer.clientWidth);
        const height = Math.max(1, layer.clientHeight);
        const coverScale = Math.max(width / Math.max(1, video.videoWidth), height / Math.max(1, video.videoHeight));
        const renderedWidth = video.videoWidth * coverScale;
        const renderedHeight = video.videoHeight * coverScale;
        return {
            ...pose,
            x: (pose.x * renderedWidth - (renderedWidth - width) / 2) / width,
            y: (pose.y * renderedHeight - (renderedHeight - height) / 2) / height
        };
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    function readInputScalePercent() {
        try {
            const saved = Number(root.localStorage?.getItem(MINDAR_INPUT_SCALE_KEY));
            return MINDAR_INPUT_SCALE_OPTIONS.includes(saved) ? saved : 100;
        } catch (error) {
            console.warn('[MMD AR] 读取识别分辨率失败，使用 100%:', error);
            return 100;
        }
    }

    function updateInputResolutionLabel() {
        const label = getElement('mmdArInputResolution');
        if (!label) return;
        const active = benchmark.activeInput;
        if (!active) {
            label.textContent = `已选 ${benchmark.inputScalePercent}%；开始定位后显示实际识别尺寸。`;
            return;
        }
        const pending = benchmark.inputScalePercent !== active.percent
            ? `；已选 ${benchmark.inputScalePercent}% 将在下次开始定位时生效` : '';
        label.textContent = `摄像头 ${active.sourceWidth}×${active.sourceHeight} → `
            + `本次识别 ${active.inputWidth}×${active.inputHeight}（${active.percent}%）${pending}`;
    }

    if (mindArOnly) benchmark.inputScalePercent = readInputScalePercent();

    function showMindArPreparationStatus(message) {
        const statusLabel = getElement('displayArTargetStatus');
        const statusMessage = getElement('displayArTargetMessage');
        const liveMessage = getElement('mmdArBenchmarkLive');
        if (statusLabel) statusLabel.textContent = 'MindAR 准备中';
        if (statusMessage) statusMessage.textContent = message;
        if (liveMessage) liveMessage.textContent = `MindAR：${message}`;
    }

    function showMindArSearchingStatus() {
        const liveMessage = getElement('mmdArBenchmarkLive');
        if (liveMessage) liveMessage.textContent = 'MindAR：识别引擎已启动，正在寻找定位图…';
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function distance(left, right) {
        return Math.hypot(right.x - left.x, right.y - left.y);
    }

    function getQuadAspect(quad) {
        const width = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
        const height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
        return width > 0 ? height / width : 1;
    }

    function solveLinearSystem(matrix, values) {
        const rows = matrix.map((row, index) => [...row, values[index]]);
        const size = values.length;
        for (let column = 0; column < size; column += 1) {
            let pivot = column;
            for (let row = column + 1; row < size; row += 1) {
                if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
            }
            if (Math.abs(rows[pivot][column]) < 1e-10) return null;
            [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
            const divisor = rows[column][column];
            for (let index = column; index <= size; index += 1) rows[column][index] /= divisor;
            for (let row = 0; row < size; row += 1) {
                if (row === column) continue;
                const factor = rows[row][column];
                for (let index = column; index <= size; index += 1) {
                    rows[row][index] -= factor * rows[column][index];
                }
            }
        }
        return rows.map((row) => row[size]);
    }

    function createDestinationToSourceHomography(destination, source) {
        const matrix = [];
        const values = [];
        for (let index = 0; index < 4; index += 1) {
            const { x, y } = destination[index];
            const { x: u, y: v } = source[index];
            matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
            values.push(u);
            matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
            values.push(v);
        }
        return solveLinearSystem(matrix, values);
    }

    function projectHomography(matrix, x, y) {
        const divisor = matrix[6] * x + matrix[7] * y + 1;
        if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-8) return null;
        return {
            x: (matrix[0] * x + matrix[1] * y + matrix[2]) / divisor,
            y: (matrix[3] * x + matrix[4] * y + matrix[5]) / divisor
        };
    }

    function bilinearChannel(data, width, height, x, y, channel) {
        const px = clamp(x, 0, width - 1);
        const py = clamp(y, 0, height - 1);
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const x1 = Math.min(width - 1, x0 + 1);
        const y1 = Math.min(height - 1, y0 + 1);
        const dx = px - x0;
        const dy = py - y0;
        const topLeft = data[(y0 * width + x0) * 4 + channel];
        const topRight = data[(y0 * width + x1) * 4 + channel];
        const bottomLeft = data[(y1 * width + x0) * 4 + channel];
        const bottomRight = data[(y1 * width + x1) * 4 + channel];
        return Math.round((topLeft * (1 - dx) + topRight * dx) * (1 - dy)
            + (bottomLeft * (1 - dx) + bottomRight * dx) * dy);
    }

    async function loadImage(blob) {
        if (typeof root.createImageBitmap === 'function') return root.createImageBitmap(blob);
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return image;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async function createRectifiedTarget(target) {
        const image = await loadImage(target.referenceImageBlob);
        try {
            const sourceScale = Math.min(1, SOURCE_MAX_WIDTH / image.width);
            const sourceWidth = Math.max(1, Math.round(image.width * sourceScale));
            const sourceHeight = Math.max(1, Math.round(image.height * sourceScale));
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = sourceWidth;
            sourceCanvas.height = sourceHeight;
            const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
            sourceContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);
            const sourcePixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
            const quad = target.selectedQuad.map((point) => ({
                x: point.x * sourceWidth,
                y: point.y * sourceHeight
            }));
            const aspect = getQuadAspect(quad);
            const outputWidth = aspect <= 1
                ? MINDAR_IMAGE_MAX_WIDTH
                : Math.max(96, Math.round(MINDAR_IMAGE_MAX_WIDTH / aspect));
            const outputHeight = aspect <= 1
                ? Math.max(96, Math.round(MINDAR_IMAGE_MAX_WIDTH * aspect))
                : MINDAR_IMAGE_MAX_WIDTH;
            const destination = [
                { x: 0, y: 0 },
                { x: outputWidth - 1, y: 0 },
                { x: outputWidth - 1, y: outputHeight - 1 },
                { x: 0, y: outputHeight - 1 }
            ];
            const inverse = createDestinationToSourceHomography(destination, quad);
            if (!inverse) throw new Error('定位选区无法透视校正');

            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = outputWidth;
            outputCanvas.height = outputHeight;
            const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
            const outputPixels = outputContext.createImageData(outputWidth, outputHeight);
            for (let y = 0; y < outputHeight; y += 1) {
                for (let x = 0; x < outputWidth; x += 1) {
                    const sourcePoint = projectHomography(inverse, x, y);
                    if (!sourcePoint) continue;
                    const destinationOffset = (y * outputWidth + x) * 4;
                    for (let channel = 0; channel < 3; channel += 1) {
                        outputPixels.data[destinationOffset + channel] = bilinearChannel(
                            sourcePixels, sourceWidth, sourceHeight,
                            sourcePoint.x, sourcePoint.y, channel
                        );
                    }
                    outputPixels.data[destinationOffset + 3] = 255;
                }
            }
            outputContext.putImageData(outputPixels, 0, 0);
            return {
                canvas: outputCanvas,
                referenceWidth: image.width,
                referenceHeight: image.height,
                sampledWidth: sourceWidth,
                sourceWidth: (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2
            };
        } finally {
            image.close?.();
        }
    }

    async function compileTarget(target) {
        const modules = await loadMindArModules();
        const startedAt = performance.now();
        const rectified = await createRectifiedTarget(target);
        const compiler = new modules.Compiler();
        await compilerApi.compileImageTargets(compiler, [rectified.canvas], (progress) => {
            if (!Number.isFinite(progress)) return;
            const percentage = Math.round(clamp(progress, 0, 100));
            showMindArPreparationStatus(`正在编译定位图 ${percentage}%…`);
        });
        const data = await compiler.exportData();
        const compiled = {
            data,
            compilationMs: performance.now() - startedAt,
            referenceWidth: rectified.referenceWidth,
            referenceHeight: rectified.referenceHeight,
            sampledWidth: rectified.sampledWidth,
            selectedSourceWidth: rectified.sourceWidth,
            aspect: rectified.canvas.height / rectified.canvas.width
        };
        return compiled;
    }

    async function loadMindArModules() {
        if (benchmark.resources.has('modules')) return benchmark.resources.get('modules');
        const pending = Promise.all([
            import(`${MINDAR_BASE}/mindar-image.prod.js`)
        ]).then(([imageTools]) => ({
            Compiler: imageTools.Compiler,
            Controller: imageTools.Controller
        }));
        benchmark.resources.set('modules', pending);
        try {
            return await pending;
        } catch (error) {
            benchmark.resources.delete('modules');
            throw error;
        }
    }

    function transformMatrixPoint(matrix, point) {
        const inputW = Number.isFinite(point.w) ? point.w : 1;
        return {
            x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12] * inputW,
            y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13] * inputW,
            z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14] * inputW,
            w: matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15] * inputW
        };
    }

    function projectMindArPoint(worldMatrix, projectionMatrix, point) {
        const cameraPoint = transformMatrixPoint(worldMatrix, point);
        const clipPoint = transformMatrixPoint(projectionMatrix, cameraPoint);
        if (!Number.isFinite(clipPoint.w) || Math.abs(clipPoint.w) < 1e-8) return null;
        return {
            x: (clipPoint.x / clipPoint.w + 1) / 2,
            y: (1 - clipPoint.y / clipPoint.w) / 2
        };
    }

    function calculateMindArPose(controller, worldMatrix, targetDimensions, compiled, video) {
        if (!Array.isArray(worldMatrix) || worldMatrix.length !== 16
            || !video.videoWidth || !video.videoHeight) return null;
        const [targetWidth, targetHeight] = targetDimensions;
        const projectionMatrix = controller.getProjectionMatrix();
        if (!projectionMatrix) return null;
        const center = projectMindArPoint(worldMatrix, projectionMatrix, {
            x: targetWidth / 2,
            y: targetHeight / 2,
            z: 0
        });
        if (!center) return null;

        // 复刻 MindARThree 的 postMatrix，将目标局部平面四角还原为图像像素坐标，仅供模型跟踪模式。
        const targetPoints = [
            { x: 0, y: targetHeight, z: 0 },
            { x: targetWidth, y: targetHeight, z: 0 },
            { x: targetWidth, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 }
        ];
        const corners = targetPoints.map((point) => projectMindArPoint(worldMatrix, projectionMatrix, point));
        if (corners.some((point) => !point)) return null;

        const rawCorners = corners.map((point) => ({
            x: point.x * video.videoWidth,
            y: point.y * video.videoHeight
        }));
        const width = (distance(rawCorners[0], rawCorners[1])
            + distance(rawCorners[3], rawCorners[2])) / 2;
        const referenceWidth = Math.max(1, compiled.selectedSourceWidth
            * compiled.referenceWidth / Math.max(1, compiled.sampledWidth));
        const scale = width / referenceWidth;
        if (!Number.isFinite(scale) || scale <= 0) return null;

        return {
            x: center.x,
            y: center.y,
            width: width / video.videoWidth,
            scale,
            rotation: Math.atan2(
                rawCorners[1].y - rawCorners[0].y,
                rawCorners[1].x - rawCorners[0].x
            ),
            videoAspect: video.videoWidth / video.videoHeight
        };
    }

    async function startMindArTracker(target, options) {
        const video = options?.video;
        if (!video) throw new Error('MindAR 适配器没有收到共享摄像头画面');
        if (!video.videoWidth || !video.videoHeight) throw new Error('摄像头画面尚未就绪');
        showMindArPreparationStatus('摄像头已就绪，正在加载识别引擎并编译定位图…');
        const setupStartedAt = performance.now();
        const compiled = await compileTarget(target);
        const modules = await loadMindArModules();
        // 手机相机可达数百万像素；识别只需要等比例的有限画布，预览仍使用原始视频。
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight)
            || sourceWidth <= 0 || sourceHeight <= 0) {
            throw new Error('摄像头原始画面尺寸无效，请重新开始定位');
        }
        const inputPercent = mindArOnly ? benchmark.inputScalePercent : null;
        const inputScale = mindArOnly ? inputPercent / 100
            : Math.min(1, Math.sqrt(MINDAR_INPUT_MAX_PIXELS / (sourceWidth * sourceHeight)));
        const inputWidth = Math.max(1, Math.floor(sourceWidth * inputScale));
        const inputHeight = Math.max(1, Math.floor(sourceHeight * inputScale));
        const inputCanvas = document.createElement('canvas');
        inputCanvas.width = inputWidth;
        inputCanvas.height = inputHeight;
        const inputContext = inputCanvas.getContext('2d', { alpha: false });
        if (!inputContext) throw new Error('无法创建 MindAR 识别画布');
        inputContext.drawImage(video, 0, 0, inputWidth, inputHeight);
        let latest = { visible: false, reason: 'searching', confidence: null };
        let pendingResult = latest;
        let hasLocated = false;
        let active = true;
        let controller;
        let targetDimensions;
        let lastSampleTimestamp = null;
        let lastPoseDeliveryAt = -Infinity;
        let inputRefreshHandle = null;
        const refreshInput = () => {
            if (!active) return;
            if (video.readyState >= 2) {
                inputContext.drawImage(video, 0, 0, inputWidth, inputHeight);
            }
            inputRefreshHandle = setTimeout(refreshInput, MINDAR_INPUT_REFRESH_MS);
        };
        controller = new modules.Controller({
            inputWidth,
            inputHeight,
            maxTrack: 1,
            onUpdate(data) {
                if (data.type === 'processDone') {
                    latest = { ...pendingResult, sampleTimestamp: performance.now() };
                    return;
                }
                if (!active || data.type !== 'updateMatrix' || data.targetIndex !== 0) return;
                if (!data.worldMatrix) {
                    pendingResult = { visible: false, reason: hasLocated ? 'lost' : 'searching', confidence: null };
                    return;
                }
                const pose = calculateMindArPose(controller, data.worldMatrix, targetDimensions, compiled, video);
                if (!pose) {
                    pendingResult = { visible: false, reason: 'unstableGeometry', confidence: null };
                    return;
                }
                hasLocated = true;
                pendingResult = { visible: true, confidence: null, pose, reason: null };
            }
        });
        try {
            const loadedTargets = controller.addImageTargetsFromBuffer(compiled.data);
            targetDimensions = loadedTargets.dimensions?.[0];
            if (!targetDimensions) throw new Error('MindAR 未能读取编译后的定位图');
            await controller.dummyRun(inputCanvas);
            controller.processVideo(inputCanvas);
            inputRefreshHandle = setTimeout(refreshInput, MINDAR_INPUT_REFRESH_MS);
            if (mindArOnly) {
                benchmark.activeInput = { sourceWidth, sourceHeight, inputWidth, inputHeight, percent: inputPercent };
                updateInputResolutionLabel();
            }
            showMindArSearchingStatus();
            return {
                get hasLocated() { return hasLocated; },
                inputSize: { width: inputWidth, height: inputHeight },
                compilationMs: compiled.compilationMs,
                setupMs: performance.now() - setupStartedAt,
                async processFrame() {
                    if (!active) return { visible: false, reason: 'stopped' };
                    const isNewSample = Number.isFinite(latest.sampleTimestamp)
                        && latest.sampleTimestamp !== lastSampleTimestamp;
                    if (isNewSample) lastSampleTimestamp = latest.sampleTimestamp;
                    const poseUpdate = isNewSample && latest.visible
                        && latest.sampleTimestamp - lastPoseDeliveryAt >= MINDAR_POSE_REFRESH_MS;
                    if (poseUpdate) lastPoseDeliveryAt = latest.sampleTimestamp;
                    if (isNewSample && !latest.visible) lastPoseDeliveryAt = -Infinity;
                    return { ...latest, newSample: isNewSample, poseUpdate };
                },
                async stop() {
                    if (!active) return;
                    active = false;
                    clearTimeout(inputRefreshHandle);
                    controller.dispose();
                    if (mindArOnly) {
                        benchmark.activeInput = null;
                        updateInputResolutionLabel();
                    }
                }
            };
        } catch (error) {
            active = false;
            clearTimeout(inputRefreshHandle);
            controller.dispose();
            if (mindArOnly) {
                benchmark.activeInput = null;
                updateInputResolutionLabel();
            }
            throw error;
        }
    }

    function formatMs(value) {
        return Number.isFinite(value) ? `${Math.round(value)} ms` : '—';
    }

    function formatNumber(value, digits = 1) {
        return Number.isFinite(value) ? value.toFixed(digits) : '—';
    }

    function renderReports() {
        const container = getElement('mmdArBenchmarkResults');
        if (!container) return;
        container.replaceChildren();
        for (const engine of mindArOnly ? ['mindar'] : ['current', 'mindar']) {
            const report = benchmark.reports.get(engine);
            const section = document.createElement('section');
            section.className = 'mmd-ar-benchmark-result';
            const title = document.createElement('strong');
            title.textContent = ENGINE_LABELS[engine];
            section.appendChild(title);
            const content = document.createElement('span');
            if (!report) {
                content.textContent = '尚未测试';
            } else {
                content.textContent = [
                    `编译 ${formatMs(report.compilationMs)}`,
                    `首次识别 ${formatMs(report.firstDetectionMs)}`,
                    `识别 ${formatNumber(report.trackingFps)} fps`,
                    `可见 ${formatNumber(report.visiblePercent)}%`,
                    `丢失 ${report.lostCount} 次`,
                    `抖动 ${formatNumber(report.jitterPx)} px`
                ].join(' · ');
            }
            section.appendChild(content);
            container.appendChild(section);
        }
    }

    function updateLiveReport(run) {
        if (!run) return;
        const now = performance.now();
        if (now - benchmark.lastRenderAt < 500) return;
        benchmark.lastRenderAt = now;
        const current = metricsApi.finishRun(run, now);
        const label = getElement('mmdArBenchmarkLive');
        if (label) {
            label.textContent = `${ENGINE_LABELS[run.engine]}：识别 ${formatMs(current.firstDetectionMs)}，`
                + `可见 ${formatNumber(current.visiblePercent)}%，丢失 ${current.lostCount} 次`;
        }
    }

    function recordSample(run, result, video, processingMs, timestamp) {
        let screenPose = null;
        if (result?.visible && result.pose) {
            const stage = getElement('displayStageLayers');
            screenPose = mapPoseToCover(result.pose, video, stage);
        }
        metricsApi.recordSample(run, {
            timestamp: Number.isFinite(result?.sampleTimestamp) ? result.sampleTimestamp : timestamp,
            visible: result?.visible === true,
            processingMs,
            x: screenPose ? screenPose.x * getElement('displayStageLayers').clientWidth : NaN,
            y: screenPose ? screenPose.y * getElement('displayStageLayers').clientHeight : NaN
        });
        updateLiveReport(run);
    }

    function installTrackerAdapter() {
        root.DisplayMmdImageTargetTracker = Object.freeze({
            mapPoseToCover,
            async start(target, options) {
                const engine = mindArOnly || getElement('mmdArTrackerEngine')?.value === 'mindar' ? 'mindar' : 'current';
                benchmark.currentEngine = engine;
                const run = metricsApi.createRun(engine, performance.now());
                benchmark.currentRun = run;
                let session;
                try {
                    const preparationStartedAt = performance.now();
                    session = engine === 'mindar'
                        ? await startMindArTracker(target, options)
                        : await originalTracker.start(target, options);
                    if (engine === 'current') session.compilationMs = performance.now() - preparationStartedAt;
                    if (Number.isFinite(session.compilationMs)) run.compilationMs = session.compilationMs;
                    const delegate = session;
                    return {
                        get hasLocated() { return delegate.hasLocated === true || this._hasLocated === true; },
                        set hasLocated(value) { this._hasLocated = value === true; },
                        inputSize: delegate.inputSize,
                        async processFrame(video, timestamp) {
                            const startedAt = performance.now();
                            const result = await delegate.processFrame(video, timestamp);
                            if (result?.newSample !== false) {
                                recordSample(run, result, video, performance.now() - startedAt, performance.now());
                            }
                            return result;
                        },
                        async stop() {
                            try {
                                await delegate.stop?.();
                            } finally {
                                benchmark.reports.set(engine, metricsApi.finishRun(run, performance.now()));
                                if (benchmark.currentRun === run) benchmark.currentRun = null;
                                if (!mindArOnly) getElement('mmdArTrackerEngine').disabled = false;
                                renderReports();
                            }
                        }
                    };
                } catch (error) {
                    if (session?.stop) await session.stop().catch(() => {});
                    benchmark.reports.set(engine, metricsApi.finishRun(run, performance.now()));
                    if (benchmark.currentRun === run) benchmark.currentRun = null;
                    const live = getElement('mmdArBenchmarkLive');
                    if (live) live.textContent = `${ENGINE_LABELS[engine]}：启动失败，${error?.message || String(error)}`;
                    if (!mindArOnly) getElement('mmdArTrackerEngine').disabled = false;
                    renderReports();
                    throw error;
                }
            }
        });
    }

    function installUi() {
        const engineSelect = getElement('mmdArTrackerEngine');
        const startButton = getElement('displayArStartButton');
        const stopButton = getElement('displayArStopButton');
        const resetButton = getElement('mmdArBenchmarkReset');
        if ((!engineSelect && !mindArOnly) || !startButton || !stopButton || !resetButton) return;
        const inputScale = getElement('mmdArInputScale');
        if (mindArOnly && inputScale) {
            inputScale.value = String(benchmark.inputScalePercent);
            updateInputResolutionLabel();
            inputScale.addEventListener('change', () => {
                const selected = Number(inputScale.value);
                benchmark.inputScalePercent = MINDAR_INPUT_SCALE_OPTIONS.includes(selected) ? selected : 100;
                inputScale.value = String(benchmark.inputScalePercent);
                try {
                    root.localStorage?.setItem(MINDAR_INPUT_SCALE_KEY, String(benchmark.inputScalePercent));
                } catch (error) {
                    console.warn('[MMD AR] 保存识别分辨率失败:', error);
                }
                updateInputResolutionLabel();
            });
        }
        engineSelect?.addEventListener('change', () => {
            benchmark.currentEngine = engineSelect.value === 'mindar' ? 'mindar' : 'current';
        });
        startButton.addEventListener('click', () => {
            const engine = mindArOnly || engineSelect?.value === 'mindar' ? 'mindar' : 'current';
            benchmark.currentEngine = engine;
            benchmark.currentRun = null;
            if (engineSelect) engineSelect.disabled = true;
            const live = getElement('mmdArBenchmarkLive');
            if (live) live.textContent = `${ENGINE_LABELS[engine]}：正在准备测试…`;
        }, true);
        stopButton.addEventListener('click', () => {
            // 指标由 tracker session.stop 收口；这里仅允许停止后切换算法。
            window.setTimeout(() => {
                if (!getElement('displayArStopButton')?.disabled) return;
                if (engineSelect) engineSelect.disabled = false;
            }, 0);
        }, true);
        resetButton.addEventListener('click', () => {
            if (!engineSelect?.disabled) {
                benchmark.reports.clear();
                renderReports();
                const live = getElement('mmdArBenchmarkLive');
                if (live) live.textContent = mindArOnly ? '运行 MindAR 后显示定位指标。' : '分别运行两种算法后会显示对比结果。';
            }
        });
        const statusMessage = getElement('displayArTargetMessage');
        if (statusMessage) {
            new MutationObserver(() => {
                if (benchmark.currentEngine === 'mindar'
                    && statusMessage.textContent.includes('置信度')) {
                    statusMessage.textContent = 'MindAR 正在跟踪（库不提供置信度指标）';
                }
            }).observe(statusMessage, { childList: true, characterData: true, subtree: true });
        }
        renderReports();
    }

    if (root.MmdArTestAframeMode === true) {
        // 网页定位由 A-Frame 接管；这里只复用已验证的选区裁剪与 MindAR 编译。
        root.MmdArTestCompileTarget = compileTarget;
    } else {
        installTrackerAdapter();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', installUi, { once: true });
        } else {
            installUi();
        }
    }
    root.addEventListener('pagehide', () => {
        for (const resource of benchmark.resources.values()) {
            if (resource && typeof resource.then !== 'function') resource.dispose?.();
        }
    }, { once: true });
}(window));
