/* 正式显示端 MindAR 锚点：本地懒加载、目标编译与相机生命周期。 */
(function exposeDisplayMmdMindAr(root) {
    'use strict';

    const scriptBase = new URL('.', document.currentScript.src);
    const host = document.getElementById('displayArAframeHost');
    const scriptUrls = [
        new URL('vendor/aframe-1.5.0/aframe.min.js', scriptBase).href,
        new URL('vendor/mind-ar-1.2.5/mindar-image-aframe.prod.js', scriptBase).href
    ];
    const compilerUrl = new URL('vendor/mind-ar-1.2.5/mindar-image.prod.js', scriptBase).href;
    let loadPromise = null;
    let scene = null;
    let anchor = null;
    let generation = 0;
    let rejectStart = null;
    let cleanupSession = null;

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`无法加载本地 AR 脚本：${url}`));
            document.head.appendChild(script);
        });
    }

    async function load() {
        if (!host) throw new Error('正式显示端缺少 A-Frame 容器');
        if (!loadPromise) {
            loadPromise = (async () => {
                if (!root.AFRAME) await loadScript(scriptUrls[0]);
                if (!root.AFRAME?.components?.['mindar-image-target']) await loadScript(scriptUrls[1]);
                if (!root.AFRAME?.components?.['mindar-image-target']) throw new Error('本地 MindAR 未注册');
            })().catch((error) => {
                loadPromise = null;
                throw error;
            });
        }
        return loadPromise;
    }

    function waitForScene(token) {
        if (scene.hasLoaded) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('A-Frame 场景初始化超时')), 30000);
            scene.addEventListener('loaded', () => {
                clearTimeout(timer);
                if (token === generation) resolve();
                else reject(new Error('定位任务已取消'));
            }, { once: true });
        });
    }

    function createScene() {
        if (scene) return;
        scene = document.createElement('a-scene');
        scene.setAttribute('embedded', '');
        scene.setAttribute('mindar-image', 'imageTargetSrc: ; autoStart: false; uiLoading: no; uiScanning: no; uiError: no;');
        scene.setAttribute('renderer', 'colorManagement: true;');
        scene.setAttribute('vr-mode-ui', 'enabled: false');
        scene.setAttribute('device-orientation-permission-ui', 'enabled: false');
        const camera = document.createElement('a-camera');
        camera.setAttribute('position', '0 0 0');
        camera.setAttribute('look-controls', 'enabled: false');
        scene.appendChild(camera);
        anchor = document.createElement('a-entity');
        anchor.setAttribute('mindar-image-target', 'targetIndex: 0');
        scene.appendChild(anchor);
        host.appendChild(scene);
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function distance(left, right) {
        return Math.hypot(right.x - left.x, right.y - left.y);
    }

    function solveHomography(destination, source) {
        const rows = [];
        for (let index = 0; index < 4; index += 1) {
            const { x, y } = destination[index];
            const { x: u, y: v } = source[index];
            rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
            rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
        }
        for (let column = 0; column < 8; column += 1) {
            let pivot = column;
            for (let row = column + 1; row < 8; row += 1) {
                if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
            }
            if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error('定位选区无法透视校正');
            [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
            const divisor = rows[column][column];
            for (let index = column; index <= 8; index += 1) rows[column][index] /= divisor;
            for (let row = 0; row < 8; row += 1) {
                if (row === column) continue;
                const factor = rows[row][column];
                for (let index = column; index <= 8; index += 1) rows[row][index] -= factor * rows[column][index];
            }
        }
        return rows.map((row) => row[8]);
    }

    function sampleChannel(pixels, width, height, x, y, channel) {
        const px = clamp(x, 0, width - 1);
        const py = clamp(y, 0, height - 1);
        const left = Math.floor(px);
        const top = Math.floor(py);
        const right = Math.min(width - 1, left + 1);
        const bottom = Math.min(height - 1, top + 1);
        const dx = px - left;
        const dy = py - top;
        const at = (column, row) => pixels[(row * width + column) * 4 + channel];
        return (at(left, top) * (1 - dx) + at(right, top) * dx) * (1 - dy)
            + (at(left, bottom) * (1 - dx) + at(right, bottom) * dx) * dy;
    }

    async function rectifyTarget(target) {
        let objectUrl = null;
        let bitmap;
        if (typeof root.createImageBitmap === 'function') bitmap = await root.createImageBitmap(target.referenceImageBlob);
        else {
            objectUrl = URL.createObjectURL(target.referenceImageBlob);
            bitmap = new Image();
            bitmap.src = objectUrl;
            await bitmap.decode();
        }
        try {
            const scale = Math.min(1, 640 / bitmap.width);
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            const source = document.createElement('canvas');
            source.width = width;
            source.height = height;
            const sourceContext = source.getContext('2d', { willReadFrequently: true });
            sourceContext.drawImage(bitmap, 0, 0, width, height);
            const pixels = sourceContext.getImageData(0, 0, width, height).data;
            const quad = target.selectedQuad.map((point) => ({ x: point.x * width, y: point.y * height }));
            const quadWidth = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
            const quadHeight = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
            const aspect = quadHeight / quadWidth;
            if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('定位图选区无效');
            const output = document.createElement('canvas');
            output.width = aspect <= 1 ? 512 : Math.max(96, Math.round(512 / aspect));
            output.height = aspect <= 1 ? Math.max(96, Math.round(512 * aspect)) : 512;
            const destination = [
                { x: 0, y: 0 }, { x: output.width - 1, y: 0 },
                { x: output.width - 1, y: output.height - 1 }, { x: 0, y: output.height - 1 }
            ];
            const matrix = solveHomography(destination, quad);
            const context = output.getContext('2d', { willReadFrequently: true });
            const image = context.createImageData(output.width, output.height);
            for (let y = 0; y < output.height; y += 1) {
                for (let x = 0; x < output.width; x += 1) {
                    const divisor = matrix[6] * x + matrix[7] * y + 1;
                    if (Math.abs(divisor) < 1e-8) continue;
                    const sx = (matrix[0] * x + matrix[1] * y + matrix[2]) / divisor;
                    const sy = (matrix[3] * x + matrix[4] * y + matrix[5]) / divisor;
                    const offset = (y * output.width + x) * 4;
                    for (let channel = 0; channel < 3; channel += 1) {
                        image.data[offset + channel] = sampleChannel(pixels, width, height, sx, sy, channel);
                    }
                    image.data[offset + 3] = 255;
                }
            }
            context.putImageData(image, 0, 0);
            return { canvas: output, aspect: output.height / output.width };
        } finally {
            bitmap.close?.();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
    }

    async function compileTarget(target) {
        if (!target?.referenceImageBlob || !Array.isArray(target.selectedQuad)
            || target.selectedQuad.length !== 4) throw new Error('定位图数据不完整');
        const { Compiler } = await import(compilerUrl);
        const rectified = await rectifyTarget(target);
        const compiler = new Compiler();
        // MindAR 1.2.5 即使不展示进度，也需要提供进度回调。
        await compiler.compileImageTargets([rectified.canvas], () => {});
        return { data: await compiler.exportData(), aspect: rectified.aspect };
    }

    function cancelPending() {
        generation += 1;
        rejectStart?.(new Error('定位任务已取消'));
        rejectStart = null;
        cleanupSession?.();
        cleanupSession = null;
        if (host) host.hidden = true;
    }

    async function start(target) {
        cancelPending();
        const token = generation;
        await load();
        const compiled = await compileTarget(target);
        if (token !== generation) throw new Error('定位任务已取消');
        host.hidden = false;
        createScene();
        await waitForScene(token);
        if (token !== generation) throw new Error('定位任务已取消');
        const system = scene.systems?.['mindar-image-system'];
        if (!system || !root.navigator.mediaDevices?.getUserMedia) throw new Error('MindAR 或摄像头不可用');
        const originalStartVideo = system._startVideo;
        const originalResize = system._resize;
        let resizeHandler = null;
        let poseFrame = 0;
        let targetUrl = URL.createObjectURL(new Blob([compiled.data], { type: 'application/octet-stream' }));
        let visible = false;
        let sample = 0;
        let lastSample = -1;
        let lastAnchor = null;
        let lastProjection = null;
        let synced = false;
        const onResize = originalResize.bind(system);
        const trackedResize = function trackedResize(...args) { return originalResize.apply(this, args); };
        Object.defineProperty(trackedResize, 'bind', { value: () => onResize });
        system._resize = trackedResize;
        resizeHandler = onResize;
        system._startVideo = function startVideo() {
            const video = document.createElement('video');
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.className = 'display-mmd-ar-mindar-video';
            system.video = video;
            host.appendChild(video);
            root.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } })
                .then((stream) => {
                    if (token !== generation) {
                        stream.getTracks().forEach((track) => track.stop());
                        video.remove();
                        return;
                    }
                    video.addEventListener('loadedmetadata', () => {
                        if (token !== generation) return;
                        video.setAttribute('width', video.videoWidth);
                        video.setAttribute('height', video.videoHeight);
                        void system._startAR().catch((error) => scene.emit('arError', { error: error.message }));
                    }, { once: true });
                    video.srcObject = stream;
                }).catch((error) => {
                    if (token === generation) scene.emit('arError', { error: error.message || 'VIDEO_FAIL' });
                });
        };
        system.imageTargetSrc = targetUrl;
        const syncPose = () => {
            if (token !== generation || !anchor.object3D?.visible || !scene.camera) return;
            const anchorMatrix = Array.from(anchor.object3D.matrix.elements);
            const projectionMatrix = Array.from(scene.camera.projectionMatrix.elements);
            synced = root.DisplayMmd?.setArCameraPose?.({
                anchorMatrix, projectionMatrix, targetAspect: compiled.aspect
            }) === true;
            if (synced) {
                lastAnchor = anchorMatrix;
                lastProjection = projectionMatrix;
                sample += 1;
            }
        };
        const checkPose = () => {
            if (token !== generation) return;
            if (anchor.object3D?.visible && scene.camera) {
                const matrix = anchor.object3D.matrix.elements;
                const projection = scene.camera.projectionMatrix.elements;
                const changed = !lastAnchor || !lastProjection
                    || matrix.some((value, index) => value !== lastAnchor[index])
                    || projection.some((value, index) => value !== lastProjection[index]);
                const pmx = root.DisplayMmd?.getArCameraSyncState?.();
                if (!synced || changed || (pmx && (!pmx.active || pmx.trackingLost))) syncPose();
            }
            poseFrame = root.requestAnimationFrame(checkPose);
        };
        const onUpdate = () => queueMicrotask(syncPose);
        const onFound = () => {
            visible = true;
            synced = false;
            lastAnchor = null;
            sample += 1;
        };
        const onLost = () => {
            visible = false;
            synced = false;
            lastAnchor = null;
            sample += 1;
            root.DisplayMmd?.suspendArCameraPose?.();
        };
        anchor.addEventListener('targetUpdate', onUpdate);
        anchor.addEventListener('targetFound', onFound);
        anchor.addEventListener('targetLost', onLost);
        poseFrame = root.requestAnimationFrame(checkPose);
        cleanupSession = () => {
            if (poseFrame) root.cancelAnimationFrame(poseFrame);
            anchor.removeEventListener('targetUpdate', onUpdate);
            anchor.removeEventListener('targetFound', onFound);
            anchor.removeEventListener('targetLost', onLost);
            root.removeEventListener('resize', resizeHandler);
            system._startVideo = originalStartVideo;
            system._resize = originalResize;
            try { if (system.video && system.controller) system.pause(); }
            catch (error) { console.warn('[显示端 MindAR] 暂停识别失败:', error); }
            system.video?.srcObject?.getTracks?.().forEach((track) => track.stop());
            system.video?.remove();
            system.video = null;
            try { system.controller?.dispose?.(); }
            catch (error) { console.warn('[显示端 MindAR] 销毁识别器失败:', error); }
            system.controller = null;
            if (system.mainStats?.domElement?.isConnected) system.mainStats.domElement.remove();
            system.mainStats = null;
            if (anchor.object3D) anchor.object3D.visible = false;
            if (targetUrl) URL.revokeObjectURL(targetUrl);
            targetUrl = null;
            host.hidden = true;
            root.DisplayMmd?.resetArCameraPose?.();
        };
        try {
            await new Promise((resolve, reject) => {
                const finish = () => {
                    clearTimeout(timer);
                    scene.removeEventListener('arReady', onReady);
                    scene.removeEventListener('arError', onError);
                    if (rejectStart === onCancel) rejectStart = null;
                };
                const onReady = () => { finish(); resolve(); };
                const onError = (event) => {
                    finish();
                    reject(new Error(`MindAR 启动失败：${event.detail?.error || '摄像头不可用'}`));
                };
                const onCancel = (error) => { finish(); reject(error); };
                const timer = setTimeout(() => onError({ detail: { error: '启动超时' } }), 120000);
                rejectStart = onCancel;
                scene.addEventListener('arReady', onReady, { once: true });
                scene.addEventListener('arError', onError, { once: true });
                try { system.start(); } catch (error) { onCancel(error); }
            });
            if (token !== generation) throw new Error('定位任务已取消');
            return {
                get hasLocated() { return sample > 0; },
                set hasLocated(_value) {},
                async processFrame() {
                    const newSample = sample !== lastSample;
                    lastSample = sample;
                    return { visible, newSample, reason: visible ? null : 'searching' };
                },
                async stop() { if (token === generation) cancelPending(); }
            };
        } catch (error) {
            if (token === generation) cancelPending();
            throw error;
        }
    }

    root.DisplayMmdMindArTracker = Object.freeze({ load, start, cancelPending });
    root.addEventListener('pagehide', cancelPending);
})(window);
