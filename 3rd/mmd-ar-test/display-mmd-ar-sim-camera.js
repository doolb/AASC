/* HTTPS MMD AR 测试页：把本地图片变换为可供 MindAR 使用的模拟摄像头视频流。 */
(function exposeMmdArSimCamera(root) {
    'use strict';

    const mode = document.getElementById('mmdArInputMode');
    const controls = document.getElementById('mmdArSimControls');
    const fileInput = document.getElementById('mmdArSimFile');
    const canvas = document.getElementById('mmdArSimCanvas');
    const preview = document.getElementById('mmdArSimPreview');
    const zoomControl = document.getElementById('mmdArSimZoom');
    const latitudeControl = document.getElementById('mmdArSimLatitude');
    const longitudeControl = document.getElementById('mmdArSimLongitude');
    const horizontalRotationControl = document.getElementById('mmdArSimHorizontalRotation');
    const zoomValue = document.getElementById('mmdArSimZoomValue');
    const latitudeValue = document.getElementById('mmdArSimLatitudeValue');
    const longitudeValue = document.getElementById('mmdArSimLongitudeValue');
    const horizontalRotationValue = document.getElementById('mmdArSimHorizontalRotationValue');
    const reset = document.getElementById('mmdArSimReset');
    const status = document.getElementById('mmdArSimStatus');
    if (!mode || !controls || !fileInput || !canvas || !preview || !zoomControl || !latitudeControl
        || !longitudeControl || !horizontalRotationControl || !zoomValue || !latitudeValue
        || !longitudeValue || !horizontalRotationValue || !reset || !status) return;

    const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
    const corners = [{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }];
    const pose = { zoom: 1, latitude: 0, longitude: 0, horizontalRotation: 0, panX: 0, panY: 0 };
    let imageReady = false;
    let imageWidth = 0;
    let imageHeight = 0;
    let timer = null;
    let stream = null;
    let panDrag = null;
    let projection = null;
    let program = null;
    let texture = null;
    let matrixLocation = null;

    function setStatus(message) {
        status.textContent = message;
    }

    function updateVerticalSliderLength() {
        // 左右竖条以底部水平旋转条为基准，按所选原图比例计算；无图时使用占位画布比例。
        const horizontal = horizontalRotationControl.getBoundingClientRect().width;
        const maximum = preview.getBoundingClientRect().height;
        if (horizontal <= 0 || maximum <= 0) return;
        const ratio = imageReady ? imageHeight / imageWidth : canvas.height / canvas.width;
        const length = `${Math.min(maximum, Math.max(48, horizontal * ratio))}px`;
        longitudeControl.style.height = length;
        latitudeControl.style.height = length;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function solveProjection(points) {
        // 将画面中的任意四边形映射回原图单位矩形，逐列消元求 3×3 单应矩阵。
        const source = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const rows = [];
        points.forEach((point, index) => {
            const [u, v] = source[index];
            rows.push([point.x, point.y, 1, 0, 0, 0, -u * point.x, -u * point.y, u]);
            rows.push([0, 0, 0, point.x, point.y, 1, -v * point.x, -v * point.y, v]);
        });
        for (let column = 0; column < 8; column += 1) {
            let pivot = column;
            for (let row = column + 1; row < 8; row += 1) {
                if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
            }
            if (Math.abs(rows[pivot][column]) < 1e-8) throw new Error('透视四角不能重合');
            [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
            const divisor = rows[column][column];
            for (let item = column; item <= 8; item += 1) rows[column][item] /= divisor;
            for (let row = 0; row < 8; row += 1) {
                if (row === column) continue;
                const multiplier = rows[row][column];
                for (let item = column; item <= 8; item += 1) rows[row][item] -= multiplier * rows[column][item];
            }
        }
        const values = rows.map((row) => row[8]);
        return new Float32Array([values[0], values[3], values[6], values[1], values[4], values[7], values[2], values[5], 1]);
    }

    function validCorners(points) {
        let orientation = 0;
        let area = 0;
        for (let index = 0; index < 4; index += 1) {
            const current = points[index];
            const next = points[(index + 1) % 4];
            const following = points[(index + 2) % 4];
            const cross = (next.x - current.x) * (following.y - next.y)
                - (next.y - current.y) * (following.x - next.x);
            if (Math.abs(cross) < 0.001 || (orientation && Math.sign(cross) !== orientation)) return false;
            orientation = Math.sign(cross);
            area += current.x * next.y - next.x * current.y;
        }
        return Math.abs(area) > 0.03;
    }

    function projectedCorners(candidate) {
        // 先在等长的三维平面坐标中旋转原图，再做经纬度透视；不可直接旋转非方形画布的归一化坐标。
        const imageAspect = imageWidth / imageHeight;
        const frameAspect = canvas.width / canvas.height;
        const width = imageAspect >= frameAspect ? 0.9 : 0.9 * imageAspect / frameAspect;
        const height = imageAspect >= frameAspect ? 0.9 * frameAspect / imageAspect : 0.9;
        const yaw = candidate.longitude * Math.PI / 180;
        const pitch = candidate.latitude * Math.PI / 180;
        const horizontalRotation = candidate.horizontalRotation * Math.PI / 180;
        const spinCos = Math.cos(horizontalRotation);
        const spinSin = Math.sin(horizontalRotation);
        const yawCos = Math.cos(yaw);
        const yawSin = Math.sin(yaw);
        const pitchCos = Math.cos(pitch);
        const pitchSin = Math.sin(pitch);
        const cameraDistance = 1.6;
        return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => {
            const localX = u * width * frameAspect;
            const localY = v * height;
            const spunX = localX * spinCos - localY * spinSin;
            const spunY = localX * spinSin + localY * spinCos;
            const rotatedX = spunX * yawCos;
            const yawDepth = -spunX * yawSin;
            const rotatedY = spunY * pitchCos - yawDepth * pitchSin;
            const depth = spunY * pitchSin + yawDepth * pitchCos;
            const perspective = cameraDistance / (cameraDistance + depth);
            return {
                x: 0.5 + candidate.panX + candidate.zoom * rotatedX * perspective / frameAspect,
                y: 0.5 + candidate.panY + candidate.zoom * rotatedY * perspective
            };
        });
    }

    function syncControls() {
        zoomControl.value = String(Math.round(pose.zoom * 100));
        latitudeControl.value = String(pose.latitude);
        longitudeControl.value = String(pose.longitude);
        horizontalRotationControl.value = String(pose.horizontalRotation);
        zoomValue.textContent = `${Math.round(pose.zoom * 100)}%`;
        latitudeValue.textContent = `${pose.latitude}°`;
        longitudeValue.textContent = `${pose.longitude}°`;
        horizontalRotationValue.textContent = `${pose.horizontalRotation}°`;
    }

    function setPose(candidate) {
        if (!imageReady) return false;
        const points = projectedCorners(candidate);
        if (!validCorners(points)) return false;
        try {
            projection = solveProjection(points);
        } catch (error) {
            setStatus(`当前视角无法投影：${error.message}`);
            return false;
        }
        Object.assign(pose, candidate);
        points.forEach((point, index) => { corners[index] = point; });
        syncControls();
        draw();
        return true;
    }

    function resetPose() {
        setPose({ zoom: 1, latitude: 0, longitude: 0, horizontalRotation: 0, panX: 0, panY: 0 });
    }

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`模拟画面着色器失败：${message}`);
        }
        return shader;
    }

    function initializeGraphics() {
        if (!gl) throw new Error('浏览器不支持 WebGL，无法模拟透视摄像头');
        if (program) return;
        const vertex = compileShader(gl.VERTEX_SHADER, 'attribute vec2 aPosition; void main(){ gl_Position=vec4(aPosition,0.0,1.0); }');
        const fragment = compileShader(gl.FRAGMENT_SHADER, `precision highp float;
            uniform sampler2D uImage;
            uniform mat3 uProjection;
            uniform vec2 uSize;
            void main() {
                vec2 point = vec2(gl_FragCoord.x / uSize.x, 1.0 - gl_FragCoord.y / uSize.y);
                vec3 mapped = uProjection * vec3(point, 1.0);
                vec2 uv = mapped.xy / mapped.z;
                if (mapped.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.32, 0.32, 0.32, 1.0);
                } else {
                    gl_FragColor = texture2D(uImage, uv);
                }
            }`);
        program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`模拟画面程序失败：${gl.getProgramInfoLog(program)}`);
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'aPosition');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        matrixLocation = gl.getUniformLocation(program, 'uProjection');
        gl.uniform2f(gl.getUniformLocation(program, 'uSize'), canvas.width, canvas.height);
        gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function draw() {
        if (!imageReady || !projection || !program) return;
        gl.useProgram(program);
        gl.uniformMatrix3fv(matrixLocation, false, projection);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
    }

    async function loadImage(file) {
        if (!file) return;
        if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) {
            setStatus('请选择不超过 25 MB 的图片文件。');
            return;
        }
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
            initializeGraphics();
            const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (bitmap.width > maxTexture || bitmap.height > maxTexture) throw new Error(`图片超过 GPU 纹理上限 ${maxTexture}px`);
            const frameWidth = 960;
            const frameHeight = Math.max(1, Math.round(frameWidth * bitmap.height / bitmap.width));
            const viewportLimits = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
            if (frameHeight > viewportLimits[1]) throw new Error(`原图比例需要 ${frameHeight}px 取景高度，超过 GPU 视口上限 ${viewportLimits[1]}px`);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            canvas.width = frameWidth;
            canvas.height = frameHeight;
            preview.style.aspectRatio = `${bitmap.width} / ${bitmap.height}`;
            gl.useProgram(program);
            gl.viewport(0, 0, frameWidth, frameHeight);
            gl.uniform2f(gl.getUniformLocation(program, 'uSize'), frameWidth, frameHeight);
            imageWidth = bitmap.width;
            imageHeight = bitmap.height;
            imageReady = true;
            resetPose();
            root.requestAnimationFrame(updateVerticalSliderLength);
            setStatus(`已加载 ${file.name}（${imageWidth}×${imageHeight}）；用滑条调整视角，拖动画面平移。`);
        } catch (error) {
            setStatus(`图片加载失败：${error.message || '未知错误'}`);
        } finally {
            bitmap?.close?.();
        }
    }

    function releaseStream() {
        if (timer) clearInterval(timer);
        timer = null;
        for (const track of stream?.getTracks?.() || []) track.stop();
        stream = null;
    }

    async function getStream() {
        if (mode.value !== 'simulated') return root.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
        if (!imageReady) throw new Error('请先选择模拟摄像头图片');
        if (typeof canvas.captureStream !== 'function') throw new Error('浏览器不支持画布视频流');
        releaseStream();
        draw();
        stream = canvas.captureStream(20);
        timer = setInterval(draw, 50);
        return stream;
    }

    mode.addEventListener('change', () => {
        controls.hidden = mode.value !== 'simulated';
        root.requestAnimationFrame(updateVerticalSliderLength);
        void Promise.resolve(root.DisplayMmdAr?.stop?.()).catch((error) => setStatus(`切换输入失败：${error.message}`));
    });
    root.addEventListener('resize', updateVerticalSliderLength);
    if (typeof root.ResizeObserver === 'function') {
        const sizeObserver = new root.ResizeObserver(updateVerticalSliderLength);
        sizeObserver.observe(horizontalRotationControl);
        sizeObserver.observe(preview);
        root.addEventListener('pagehide', () => sizeObserver.disconnect(), { once: true });
    }
    fileInput.addEventListener('change', () => {
        void (async () => {
            await root.DisplayMmdAr?.stop?.();
            await loadImage(fileInput.files?.[0]);
        })().catch((error) => setStatus(`图片加载失败：${error.message}`));
    });
    for (const slider of [zoomControl, latitudeControl, longitudeControl, horizontalRotationControl]) {
        slider.addEventListener('input', () => {
            const candidate = {
                ...pose,
                zoom: Number(zoomControl.value) / 100,
                latitude: Number(latitudeControl.value),
                longitude: Number(longitudeControl.value),
                horizontalRotation: Number(horizontalRotationControl.value)
            };
            if (!setPose(candidate)) syncControls();
        });
    }
    reset.addEventListener('click', () => { if (imageReady) resetPose(); });
    canvas.addEventListener('pointerdown', (event) => {
        if (!imageReady || panDrag || event.isPrimary === false || event.button !== 0) return;
        panDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pose.panX, panY: pose.panY };
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (_error) {
            // 拒绝指针捕获时仍保留画布内拖动能力。
        }
        event.preventDefault();
    });
    document.addEventListener('pointermove', (event) => {
        if (!panDrag || panDrag.pointerId !== event.pointerId) return;
        const bounds = preview.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        setPose({
            ...pose,
            panX: clamp(panDrag.panX + (event.clientX - panDrag.x) / bounds.width, -0.45, 0.45),
            panY: clamp(panDrag.panY + (event.clientY - panDrag.y) / bounds.height, -0.45, 0.45)
        });
        event.preventDefault();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        const eventTarget = eventName === 'lostpointercapture' ? canvas : document;
        eventTarget.addEventListener(eventName, (event) => {
            if (panDrag?.pointerId !== event.pointerId) return;
            panDrag = null;
            if (eventName !== 'lostpointercapture' && canvas.hasPointerCapture?.(event.pointerId)) {
                canvas.releasePointerCapture(event.pointerId);
            }
        });
    }
    root.addEventListener('pagehide', releaseStream);
    root.MmdArTestSimCamera = Object.freeze({ getStream, releaseStream, isSimulated: () => mode.value === 'simulated',
        getState: () => ({ imageReady, imageWidth, imageHeight,
            corners: corners.map((point) => ({ ...point })), pose: { ...pose }, streaming: Boolean(timer) }) });
})(window);
