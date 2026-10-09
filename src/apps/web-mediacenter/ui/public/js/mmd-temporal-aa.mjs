import { vertexShader, resolveShader, depthShader, presentShader } from './mmd-temporal-aa-shader.mjs';
import { isCameraCut } from './mmd-screen-lighting.mjs';
import { normalizeRenderSettings, jitterSampleCounts } from './mmd-render-settings.mjs';

// 异步等待期间旧动作仍可绘制，提交后的再次失效防止重播同一ID复用旧姿态历史。
export async function runTemporalAction(invalidate, action) {
    invalidate();
    try { return await action(); }
    finally { invalidate(); }
}

// Halton(2,3)八相位。仅修改clip空间平移，兼容已有AR裁切与正交相机。
export const jitterSamples = Object.freeze([[0,-1/6],[-1/4,1/6],[1/4,-7/18],[-3/8,-1/18],
    [1/8,5/18],[-1/8,-5/18],[3/8,1/18],[-7/16,7/18]]);
// 扩展Halton序列只在模块初始化时生成；保留原八相位，避免默认浮点舍入改变画面。
const radicalInverse = (index, base) => {
    let result = 0, fraction = 1;
    while (index > 0) { fraction /= base; result += (index % base) * fraction; index = Math.floor(index / base); }
    return result;
};
const extendedSamples = Array.from({ length: 32 }, (_, index) => jitterSamples[index]
    || Object.freeze([radicalInverse(index + 1, 2) - .5, radicalInverse(index + 1, 3) - .5]));
const jitterSequences = new Map(jitterSampleCounts.map(count => [count, Object.freeze(extendedSamples.slice(0, count))]));
export function createTemporalAA({ THREE, renderer, camera, getSettings = () => window.DisplayMmdRenderSettings || {} }) {
    let resources = null, phase = 0, valid = false, lastSignature = '', lastHistoryUsed = false;
    const base = new THREE.Matrix4(), inverse = new THREE.Matrix4(), inputSize = new THREE.Vector2(), outputSize = new THREE.Vector2();
    const previousBase = new THREE.Matrix4(), previousWorld = new THREE.Matrix4();
    const supported = renderer.capabilities.isWebGL2 === true;
    const invalidate = () => { valid = false; phase = 0; };
    const release = () => {
        if (resources) {
            for (const target of [resources.current, ...resources.colors, ...resources.depths]) target.dispose();
            for (const material of [resources.resolve, resources.depth, resources.present]) material.dispose();
            resources.geometry.dispose(); resources = null;
        }
        invalidate();
    };
    const create = (inputWidth, inputHeight, outputWidth, outputHeight) => {
        if (resources?.current.width === inputWidth && resources.current.height === inputHeight
            && resources.colors[0].width === outputWidth && resources.colors[0].height === outputHeight) return;
        release();
        const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const target = (targetType, filter, width, height) => new THREE.WebGLRenderTarget(width, height, {
            depthBuffer: false, type: targetType, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter });
        const material = (fragmentShader, uniforms, toneMapped = false) => new THREE.ShaderMaterial({
            vertexShader, fragmentShader, uniforms, toneMapped, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
        const uniforms = { tCurrent: { value: null }, tHistory: { value: null }, tHistoryDepth: { value: null }, tDepth: { value: null },
            inverseProjection: { value: camera.projectionMatrixInverse }, cameraWorld: { value: camera.matrixWorld },
            previousView: { value: new THREE.Matrix4() }, previousProjection: { value: new THREE.Matrix4() },
            previousInverseProjection: { value: new THREE.Matrix4() }, inputSize: { value: inputSize }, outputSize: { value: outputSize },
            historyWeight: { value: .9 }, historyValid: { value: false }, upscaleEnabled: { value: false } };
        const resolve = material(resolveShader, uniforms);
        const depth = material(depthShader, { tDepth: uniforms.tDepth });
        const present = material(presentShader, { tColor: { value: null }, outputSize: { value: new THREE.Vector2(outputWidth, outputHeight) }, edgeAaEnabled: { value: false } }, true);
        const geometry = new THREE.PlaneGeometry(2, 2), quad = new THREE.Mesh(geometry, resolve);
        const passScene = new THREE.Scene(); passScene.add(quad);
        resources = { current: target(type, THREE.NearestFilter, inputWidth, inputHeight),
            colors: [target(type, THREE.LinearFilter, outputWidth, outputHeight), target(type, THREE.LinearFilter, outputWidth, outputHeight)],
            depths: [target(THREE.UnsignedByteType, THREE.NearestFilter, outputWidth, outputHeight),
                target(THREE.UnsignedByteType, THREE.NearestFilter, outputWidth, outputHeight)],
            resolve, depth, present, geometry, quad, passScene, passCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), readIndex: 0 };
    };
    const render = (draw, getDepth, { bypass = false, signature = '' } = {}) => {
        const config = normalizeRenderSettings(getSettings());
        if (!supported || !config.taaEnabled || bypass) {
            release();
            const oldUpscale = camera.userData.mmdArTaaUpscaleActive;
            camera.userData.mmdArTaaUpscaleActive = false;
            try { draw(); }
            finally {
                if (oldUpscale === undefined) delete camera.userData.mmdArTaaUpscaleActive;
                else camera.userData.mmdArTaaUpscaleActive = oldUpscale;
            }
            return;
        }
        renderer.getDrawingBufferSize(outputSize);
        const upscaleEnabled = config.aaMode === 'fsr2';
        const inputScale = upscaleEnabled ? config.fsr2Scale : 1;
        inputSize.set(Math.max(1, Math.floor(outputSize.x * inputScale)), Math.max(1, Math.floor(outputSize.y * inputScale)));
        create(inputSize.x, inputSize.y, outputSize.x, outputSize.y);
        const nextSignature = `${config.aaMode}:${config.fsr2Scale}:${config.taaHistoryWeight}:${config.taaJitterScale}:${config.taaJitterSamples}:${signature}`;
        if (lastSignature !== nextSignature) invalidate(); lastSignature = nextSignature;
        camera.updateMatrixWorld(true); base.copy(camera.projectionMatrix); inverse.copy(camera.projectionMatrixInverse);
        if (valid && isCameraCut(previousWorld, camera.matrixWorld, previousBase, base)) invalidate();
        const previousTarget = renderer.getRenderTarget();
        const oldBase = camera.userData.mmdArTaaBaseProjection, oldPhase = camera.userData.mmdArTaaPhase;
        const oldUpscale = camera.userData.mmdArTaaUpscaleActive;
        const read = resources.readIndex, write = 1 - read, uniforms = resources.resolve.uniforms;
        try {
            const sequence = jitterSequences.get(config.taaJitterSamples), sampleIndex = phase % sequence.length;
            const [x, y] = sequence[sampleIndex];
            // 抖动以当前场景输入像素为单位；FSR2模式下按内部目标尺寸计算。
            const elements = camera.projectionMatrix.elements;
            for (let column = 0; column < 4; column += 1) {
                elements[column * 4] += 2 * x * config.taaJitterScale / inputSize.x * base.elements[column * 4 + 3];
                elements[column * 4 + 1] += 2 * y * config.taaJitterScale / inputSize.y * base.elements[column * 4 + 3];
            }
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
            camera.userData.mmdArTaaBaseProjection = base; camera.userData.mmdArTaaPhase = sampleIndex;
            camera.userData.mmdArTaaUpscaleActive = upscaleEnabled;
            renderer.setRenderTarget(resources.current); draw();
            const depth = getDepth();
            if (!depth) throw new Error('TAA缺少当前场景深度');
            uniforms.tCurrent.value = resources.current.texture; uniforms.tDepth.value = depth;
            uniforms.tHistory.value = resources.colors[read].texture; uniforms.tHistoryDepth.value = resources.depths[read].texture;
            uniforms.inputSize.value.copy(inputSize); uniforms.outputSize.value.copy(outputSize); uniforms.upscaleEnabled.value = upscaleEnabled;
            uniforms.historyValid.value = valid; uniforms.historyWeight.value = Math.min(.95, Math.max(0, Number(config.taaHistoryWeight) || 0));
            lastHistoryUsed = valid;
            const pass = (material, target) => { resources.quad.material = material; renderer.setRenderTarget(target); renderer.clear(); renderer.render(resources.passScene, resources.passCamera); };
            pass(resources.resolve, resources.colors[write]); pass(resources.depth, resources.depths[write]);
            resources.present.uniforms.tColor.value = resources.colors[write].texture;
            resources.present.uniforms.outputSize.value.copy(outputSize);
            resources.present.uniforms.edgeAaEnabled.value = upscaleEnabled;
            pass(resources.present, previousTarget);
            uniforms.previousView.value.copy(camera.matrixWorldInverse); uniforms.previousProjection.value.copy(camera.projectionMatrix);
            uniforms.previousInverseProjection.value.copy(camera.projectionMatrixInverse);
            previousBase.copy(base); previousWorld.copy(camera.matrixWorld);
            resources.readIndex = write; valid = true; phase += 1;
        } catch (error) { invalidate(); throw error; }
        finally {
            camera.projectionMatrix.copy(base); camera.projectionMatrixInverse.copy(inverse);
            if (oldBase === undefined) delete camera.userData.mmdArTaaBaseProjection; else camera.userData.mmdArTaaBaseProjection = oldBase;
            if (oldPhase === undefined) delete camera.userData.mmdArTaaPhase; else camera.userData.mmdArTaaPhase = oldPhase;
            if (oldUpscale === undefined) delete camera.userData.mmdArTaaUpscaleActive; else camera.userData.mmdArTaaUpscaleActive = oldUpscale;
            renderer.setRenderTarget(previousTarget);
        }
    };
    const handlers = [];
    const listen = (target, name) => { target?.addEventListener(name, invalidate); if (target) handlers.push([target, name]); };
    listen(renderer.domElement, 'webglcontextlost'); listen(renderer.domElement, 'webglcontextrestored');
    if (typeof window !== 'undefined') for (const name of ['pagehide', 'pageshow', 'mmd-ar-render-settings']) listen(window, name);
    if (typeof document !== 'undefined') listen(document, 'visibilitychange');
    const dispose = () => { release(); for (const [target, name] of handlers) target.removeEventListener(name, invalidate); handlers.length = 0; };
    return { render, invalidate, dispose, active: () => supported && getSettings().taaEnabled === true,
        getState: () => ({ supported, historyValid: valid, lastHistoryUsed, phase, targetCount: resources ? 5 : 0,
            mode: getSettings().aaMode === 'fsr2' ? 'fsr2' : 'taa',
            width: resources?.colors[0].width || 0, height: resources?.colors[0].height || 0,
            inputWidth: resources?.current.width || 0, inputHeight: resources?.current.height || 0 }) };
}
