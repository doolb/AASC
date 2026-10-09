import {
    vertexShader,
    fragmentShader,
    filterShader,
    colorReductionShader,
    depthReductionShader,
    contactDepthReductionShader
} from './web-screen-lighting-shader.mjs';

export const MAX_HZB_LEVELS = 12;

function createBlurPassPlan(settings, channel, initialIndex = 0) {
    if (settings[`${channel}Enabled`] !== true) return { steps: [], targetIndex: initialIndex };
    const rawCount = settings[`${channel}BlurPassCount`];
    const passCount = rawCount == null || rawCount === '' || !Number.isFinite(Number(rawCount))
        ? 1 : Math.round(Math.max(0, Math.min(3, Number(rawCount))));
    const radii = [0, 1, 2].map(index => {
        const raw = settings[`${channel}BlurRadii`]?.[index];
        return raw == null || raw === '' || !Number.isFinite(Number(raw))
            ? 3 : Math.round(Math.max(1, Math.min(5, Number(raw))));
    });
    const steps = [];
    let inputIndex = initialIndex;
    for (let round = 0; round < passCount; round += 1) {
        for (const axis of ['horizontal', 'vertical']) {
            const outputIndex = inputIndex === 1 ? 2 : 1;
            steps.push({ inputIndex, outputIndex, radius: radii[round], axis });
            inputIndex = outputIndex;
        }
    }
    return { steps, targetIndex: inputIndex };
}

export function createGiBlurPassPlan(settings = {}) { return createBlurPassPlan(settings, 'gi'); }

// 两种滤波串行读取前一结果，仅切换要处理的通道，避免互相覆盖或反馈。
export function createScreenLightingBlurPassPlan(settings = {}) {
    const gi = createBlurPassPlan(settings, 'gi');
    const contact = createBlurPassPlan(settings, 'contact', gi.targetIndex);
    return { steps: [...gi.steps.map(step => ({ ...step, channel: 'gi' })),
        ...contact.steps.map(step => ({ ...step, channel: 'contact' }))], targetIndex: contact.targetIndex };
}

// 逐级缩小颜色/深度输入，每个 pass 至多将任一维缩小一半。
export function createReductionSteps(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    let width = Math.max(1, Math.floor(Number(sourceWidth) || 1));
    let height = Math.max(1, Math.floor(Number(sourceHeight) || 1));
    const targetW = Math.max(1, Math.floor(Number(targetWidth) || 1));
    const targetH = Math.max(1, Math.floor(Number(targetHeight) || 1));
    const steps = [];
    while (width !== targetW || height !== targetH) {
        const nextWidth = Math.max(targetW, Math.ceil(width / 2));
        const nextHeight = Math.max(targetH, Math.ceil(height / 2));
        if (nextWidth === width && nextHeight === height) break;
        steps.push({ width: nextWidth, height: nextHeight });
        width = nextWidth;
        height = nextHeight;
    }
    if (steps.length === 0) steps.push({ width: targetW, height: targetH });
    return steps;
}

// HZB 以效果分辨率为第0级，逐级归约到1x1，最多绑定固定数量的采样器。
export function createHzbLevelSizes(width, height, maxLevels = MAX_HZB_LEVELS) {
    let currentWidth = Math.max(1, Math.floor(Number(width) || 1));
    let currentHeight = Math.max(1, Math.floor(Number(height) || 1));
    const levels = [];
    for (let index = 0; index < maxLevels; index += 1) {
        levels.push({ width: currentWidth, height: currentHeight });
        if (currentWidth === 1 && currentHeight === 1) break;
        currentWidth = Math.max(1, Math.ceil(currentWidth / 2));
        currentHeight = Math.max(1, Math.ceil(currentHeight / 2));
    }
    return levels;
}

// 大幅平移/转向或投影突变视为相机切断，避免复用不相关的历史颜色。
export function isCameraCut(previousWorld, currentWorld, previousProjection, currentProjection, options = {}) {
    if (!previousWorld || !currentWorld || !previousProjection || !currentProjection) return true;
    const previous = previousWorld.elements || previousWorld;
    const current = currentWorld.elements || currentWorld;
    const oldProjection = previousProjection.elements || previousProjection;
    const nextProjection = currentProjection.elements || currentProjection;
    if (previous.length < 16 || current.length < 16 || oldProjection.length < 16 || nextProjection.length < 16) return true;
    const maxTranslation = Number.isFinite(options.maxTranslation) ? options.maxTranslation : 8;
    const positionDelta = Math.hypot(current[12] - previous[12], current[13] - previous[13], current[14] - previous[14]);
    if (positionDelta > maxTranslation) return true;
    const previousForward = [-previous[8], -previous[9], -previous[10]];
    const currentForward = [-current[8], -current[9], -current[10]];
    const previousLength = Math.hypot(...previousForward), currentLength = Math.hypot(...currentForward);
    if (previousLength < 1e-6 || currentLength < 1e-6) return true;
    const forwardDot = previousForward.reduce((sum, value, index) => sum + value * currentForward[index], 0) / (previousLength * currentLength);
    if (forwardDot < (Number.isFinite(options.minimumForwardDot) ? options.minimumForwardDot : .5)) return true;
    return oldProjection.some((value, index) => Math.abs(value - nextProjection[index]) > 1e-4);
}

function createRenderTarget(THREE, width, height, type) {
    return new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type
    });
}

export function createScreenLighting({ THREE, renderer, camera, keyLight }) {
    let resources = null;
    const direction = new THREE.Vector3();
    const lightTarget = new THREE.Vector3();
    const invalidateHistoryOnContextChange = () => { if (resources?.history) resources.history.valid = false; };
    const settings = () => window.MmdArScreenLighting || {};
    const active = () => settings().contactEnabled === true || settings().giEnabled === true;

    const disposeHistory = (history) => {
        if (!history) return;
        for (const set of history.sets) {
            set.colorTarget.dispose();
            for (const target of set.depthLevels) target.dispose();
        }
        for (const target of [...history.colorScratch, ...history.depthScratch]) target.dispose();
    };

    const dispose = () => {
        if (!resources) return;
        resources.contextTarget?.removeEventListener('webglcontextlost', invalidateHistoryOnContextChange);
        resources.contextTarget?.removeEventListener('webglcontextrestored', invalidateHistoryOnContextChange);
        for (const [target, name] of resources.lifecycleListeners || []) target.removeEventListener(name, invalidateHistoryOnContextChange);
        disposeHistory(resources.history);
        resources.contactDepthTarget?.dispose();
        for (const target of resources.targets) target.dispose();
        resources.filterMaterial.dispose();
        resources.material.dispose();
        resources.colorReductionMaterial.dispose();
        resources.depthReductionMaterial.dispose();
        resources.contactDepthMaterial.dispose();
        resources.geometry.dispose();
        resources = null;
    };

    const create = () => {
        if (resources) return;
        const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
        const targets = Array.from({ length: 3 }, () => createRenderTarget(THREE, 1, 1, type));
        const uniforms = {
            tDepth: { value: null }, tContactDepth: { value: null }, tColor: { value: null }, tHistoryColor: { value: null },
            inverseProjection: { value: camera.projectionMatrixInverse }, projection: { value: camera.projectionMatrix },
            cameraWorld: { value: camera.matrixWorld }, currentView: { value: camera.matrixWorldInverse },
            previousView: { value: new THREE.Matrix4() }, previousProjection: { value: new THREE.Matrix4() },
            previousInverseProjection: { value: new THREE.Matrix4() }, previousCameraWorld: { value: new THREE.Matrix4() },
            fullSize: { value: new THREE.Vector2(1, 1) }, effectSize: { value: new THREE.Vector2(1, 1) },
            lightDirection: { value: direction }, contactEnabled: { value: false }, giEnabled: { value: false },
            historyValid: { value: false }, contactStrength: { value: .5 }, contactDistance: { value: .3 }, contactFramePhase: { value: 0 },
            contactNormalBias: { value: 0 }, contactDepthBias: { value: 0 },
            giStrength: { value: 1 }, giRadius: { value: 2 }, lightWeight: { value: 1 },
            rayCount: { value: 4 }, stepCount: { value: 12 }, contactStepCount: { value: 12 }, hzbLevelCount: { value: 1 }
        };
        for (let index = 0; index < MAX_HZB_LEVELS; index += 1) uniforms[`tHistoryDepth${index}`] = { value: null };
        const material = new THREE.ShaderMaterial({
            vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false,
            blending: THREE.NoBlending, toneMapped: false
        });
        const filterMaterial = new THREE.ShaderMaterial({
            vertexShader, fragmentShader: filterShader,
            uniforms: {
                tInput: { value: null }, tDepth: uniforms.tDepth, inverseProjection: uniforms.inverseProjection,
                fullSize: uniforms.fullSize, effectSize: uniforms.effectSize,
                filterAxis: { value: new THREE.Vector2() }, blurRadius: { value: 3 }, filterContact: { value: false }
            }, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false
        });
        const colorReductionMaterial = new THREE.ShaderMaterial({
            vertexShader, fragmentShader: colorReductionShader,
            uniforms: {
                tInput: { value: null }, tDepthInput: { value: null }, depthIsRaw: { value: true },
                inverseProjection: { value: camera.projectionMatrixInverse },
                inputSize: { value: new THREE.Vector2() }, outputSize: { value: new THREE.Vector2() }
            },
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false
        });
        const depthReductionMaterial = new THREE.ShaderMaterial({
            vertexShader, fragmentShader: depthReductionShader,
            uniforms: {
                tInput: { value: null }, sourceIsDepth: { value: false },
                inputSize: { value: new THREE.Vector2() }, outputSize: { value: new THREE.Vector2() }
            }, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false
        });
        const geometry = new THREE.PlaneGeometry(2, 2);
        const contactDepthMaterial = new THREE.ShaderMaterial({
            vertexShader, fragmentShader: contactDepthReductionShader,
            uniforms: { tInput: { value: null }, inputSize: { value: new THREE.Vector2() } },
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false
        });
        const scene = new THREE.Scene();
        const quad = new THREE.Mesh(geometry, material);
        scene.add(quad);
        resources = {
            targets, material, filterMaterial, colorReductionMaterial, depthReductionMaterial, contactDepthMaterial, contactDepthTarget: null,
            quad, geometry, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), history: null,
            contextTarget: renderer.domElement || null
        };
        resources.contextTarget?.addEventListener('webglcontextlost', invalidateHistoryOnContextChange);
        resources.contextTarget?.addEventListener('webglcontextrestored', invalidateHistoryOnContextChange);
        // 后台/设置切换也清GI历史；按资源生命周期注册与注销，避免反复开关泄漏。
        resources.lifecycleListeners = [];
        const listen = (target, name) => {
            if (!target?.addEventListener) return;
            target.addEventListener(name, invalidateHistoryOnContextChange);
            resources.lifecycleListeners.push([target, name]);
        };
        if (typeof window !== 'undefined') for (const name of ['pagehide', 'pageshow', 'mmd-ar-render-settings']) listen(window, name);
        if (typeof document !== 'undefined') listen(document, 'visibilitychange');
    };

    const ensureHistory = (fullWidth, fullHeight, effectWidth, effectHeight, quality, type) => {
        const key = `${fullWidth}x${fullHeight}:${effectWidth}x${effectHeight}:${quality}`;
        if (resources.history?.key === key) return;
        disposeHistory(resources.history);
        const colorSteps = createReductionSteps(fullWidth, fullHeight, effectWidth, effectHeight);
        const depthSteps = colorSteps;
        const hzbSizes = createHzbLevelSizes(effectWidth, effectHeight);
        const createSet = () => ({
            colorTarget: createRenderTarget(THREE, effectWidth, effectHeight, type),
            depthLevels: hzbSizes.map(size => createRenderTarget(THREE, size.width, size.height, type))
        });
        resources.history = {
            key, valid: false, readIndex: 0, sets: [createSet(), createSet()],
            colorSteps, depthSteps, hzbSizes,
            colorScratch: colorSteps.slice(0, -1).map(size => createRenderTarget(THREE, size.width, size.height, type)),
            depthScratch: depthSteps.slice(0, -1).map(size => createRenderTarget(THREE, size.width, size.height, type)),
            previousWorld: new THREE.Matrix4(), previousView: new THREE.Matrix4(),
            previousProjection: new THREE.Matrix4(), previousInverseProjection: new THREE.Matrix4(), previousStableProjection: new THREE.Matrix4()
        };
    };

    const drawPass = (material, inputTexture, inputWidth, inputHeight, outputTarget, outputWidth, outputHeight, sourceIsDepth = false) => {
        material.uniforms.tInput.value = inputTexture;
        material.uniforms.inputSize.value.set(inputWidth, inputHeight);
        material.uniforms.outputSize.value.set(outputWidth, outputHeight);
        if (material.uniforms.sourceIsDepth) material.uniforms.sourceIsDepth.value = sourceIsDepth;
        resources.quad.material = material;
        // 目标自身的viewport已是实际纹理尺寸；setViewport会污染主画布的全局viewport。
        renderer.setRenderTarget(outputTarget);
        renderer.clear();
        renderer.render(resources.scene, resources.camera);
    };

    const captureHistory = (ao, history, writeIndex, fullWidth, fullHeight, effectWidth, effectHeight) => {
        const writeSet = history.sets[writeIndex];
        const depthMaterial = resources.depthReductionMaterial;
        let inputTexture = ao.depthTexture;
        let inputWidth = fullWidth;
        let inputHeight = fullHeight;
        for (let index = 0; index < history.depthSteps.length; index += 1) {
            const size = history.depthSteps[index];
            const output = index === history.depthSteps.length - 1 ? writeSet.depthLevels[0] : history.depthScratch[index];
            drawPass(depthMaterial, inputTexture, inputWidth, inputHeight, output, size.width, size.height, index === 0);
            inputTexture = output.texture;
            inputWidth = size.width;
            inputHeight = size.height;
        }
        for (let index = 1; index < history.hzbSizes.length; index += 1) {
            const previousSize = history.hzbSizes[index - 1];
            const size = history.hzbSizes[index];
            drawPass(depthMaterial, writeSet.depthLevels[index - 1].texture, previousSize.width, previousSize.height,
                writeSet.depthLevels[index], size.width, size.height);
        }
        const colorMaterial = resources.colorReductionMaterial;
        inputTexture = ao.colorTarget.texture;
        inputWidth = fullWidth;
        inputHeight = fullHeight;
        for (let index = 0; index < history.colorSteps.length; index += 1) {
            const size = history.colorSteps[index];
            const output = index === history.colorSteps.length - 1 ? writeSet.colorTarget : history.colorScratch[index];
            const depthInput = index === 0 ? ao.depthTexture : history.depthScratch[index - 1].texture;
            colorMaterial.uniforms.tDepthInput.value = depthInput;
            colorMaterial.uniforms.depthIsRaw.value = index === 0;
            colorMaterial.uniforms.inverseProjection.value = camera.projectionMatrixInverse;
            drawPass(colorMaterial, inputTexture, inputWidth, inputHeight, output, size.width, size.height);
            inputTexture = output.texture;
            inputWidth = size.width;
            inputHeight = size.height;
        }
        history.readIndex = writeIndex;
        history.valid = true;
    };

    const prepare = (ao, width, height, normalPreview, aoEnabled) => {
        const composite = ao.compositeMaterial.uniforms;
        const config = settings();
        const isActive = config.contactEnabled === true || config.giEnabled === true;
        composite.screenAoEnabled.value = aoEnabled ? 1 : 0;
        composite.screenLightingEnabled.value = isActive && !normalPreview;
        if (!composite.screenLightingEnabled.value) {
            composite.screenLightingTexture.value = ao.colorTarget.texture;
            if (normalPreview || !isActive) dispose();
            return;
        }
        create();
        const quality = ['low', 'medium', 'high'].includes(config.quality) ? config.quality : 'low';
        const maxSize = { low: 384, medium: 512, high: 640 }[quality];
        const scale = Math.min(.5, maxSize / Math.max(width, height));
        const effectWidth = Math.max(1, Math.round(width * scale));
        const effectHeight = Math.max(1, Math.round(height * scale));
        for (const target of resources.targets) if (target.width !== effectWidth || target.height !== effectHeight) target.setSize(effectWidth, effectHeight);
        const type = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
        if (config.giEnabled === true) ensureHistory(width, height, effectWidth, effectHeight, quality, type);
        else if (resources.history) { disposeHistory(resources.history); resources.history = null; }
        const history = resources.history;
        camera.updateMatrixWorld(true);
        const currentWorld = camera.matrixWorld;
        // TAA绘制期间提供基础投影，切断判断忽略亚像素抖动；历史采样仍保存真实投影。
        const stableProjection = camera.userData?.mmdArTaaBaseProjection || camera.projectionMatrix;
        const useHistory = config.giEnabled === true && history?.valid === true && !isCameraCut(
            history.previousWorld, currentWorld, history.previousStableProjection, stableProjection
        );
        if (history && !useHistory) history.valid = false;
        const uniforms = resources.material.uniforms;
        uniforms.tDepth.value = ao.depthTexture;
        uniforms.tColor.value = ao.colorTarget.texture;
        uniforms.fullSize.value.set(width, height);
        uniforms.effectSize.value.set(effectWidth, effectHeight);
        uniforms.inverseProjection.value = camera.projectionMatrixInverse;
        uniforms.projection.value = camera.projectionMatrix;
        uniforms.contactFramePhase.value = camera.userData?.mmdArTaaPhase || 0;
        uniforms.cameraWorld.value = camera.matrixWorld;
        uniforms.currentView.value = camera.matrixWorldInverse;
        uniforms.contactEnabled.value = config.contactEnabled === true;
        uniforms.giEnabled.value = config.giEnabled === true;
        uniforms.historyValid.value = useHistory;
        const ranges = { contactStrength: [0, 1, .5], contactDistance: [.02, 3, .3], giStrength: [0, 4, 1], giRadius: [.1, 10, 2] };
        for (const [name, [min, max, fallback]] of Object.entries(ranges)) {
            const value = Number(config[name]);
            uniforms[name].value = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
        }
        uniforms.rayCount.value = { low: 4, medium: 6, high: 8 }[quality];
        uniforms.stepCount.value = { low: 12, medium: 20, high: 32 }[quality];
        const rawSteps = config.contactStepCount;
        const validSteps = (typeof rawSteps === 'number' || typeof rawSteps === 'string')
            && String(rawSteps).trim() !== '' && Number.isFinite(Number(rawSteps));
        uniforms.contactStepCount.value = validSteps ? Math.round(Math.max(4, Math.min(64, Number(rawSteps)))) : uniforms.stepCount.value;
        uniforms.lightWeight.value = keyLight?.visible && keyLight.intensity > 0 ? Math.min(1, keyLight.intensity / (keyLight.intensity + 1)) : 0;
        if (keyLight) {
            keyLight.getWorldPosition(direction);
            keyLight.target.getWorldPosition(lightTarget);
            direction.sub(lightTarget).normalize().transformDirection(camera.matrixWorldInverse);
        }
        const shadow = keyLight?.shadow;
        const shadowCamera = shadow?.camera;
        const mainShadowActive = renderer.shadowMap?.enabled === true && keyLight?.castShadow === true
            && shadowCamera?.isOrthographicCamera === true;
        const normalBias = Number(shadow?.normalBias);
        const depthRange = Number(shadowCamera?.far) - Number(shadowCamera?.near);
        const depthBias = Number(shadow?.bias);
        uniforms.contactNormalBias.value = mainShadowActive && Number.isFinite(normalBias) ? normalBias : 0;
        // Three.js shadow.bias作用于正交阴影相机的归一化深度；换算成世界单位后沿光源方向偏移接收点。
        uniforms.contactDepthBias.value = mainShadowActive && Number.isFinite(depthBias)
            && Number.isFinite(depthRange) && depthRange > 0 ? -depthBias * depthRange : 0;
        if (history) {
            const readSet = history.sets[history.readIndex];
            uniforms.tHistoryColor.value = useHistory ? readSet.colorTarget.texture : ao.colorTarget.texture;
            uniforms.previousView.value.copy(useHistory ? history.previousView : camera.matrixWorldInverse);
            uniforms.previousProjection.value.copy(useHistory ? history.previousProjection : camera.projectionMatrix);
            uniforms.previousInverseProjection.value.copy(useHistory ? history.previousInverseProjection : camera.projectionMatrixInverse);
            uniforms.previousCameraWorld.value.copy(useHistory ? history.previousWorld : camera.matrixWorld);
            uniforms.hzbLevelCount.value = history.hzbSizes.length;
            for (let index = 0; index < MAX_HZB_LEVELS; index += 1) {
                const level = Math.min(index, history.hzbSizes.length - 1);
                uniforms[`tHistoryDepth${index}`].value = readSet.depthLevels[level].texture;
            }
        } else {
            uniforms.tHistoryColor.value = ao.colorTarget.texture;
            uniforms.hzbLevelCount.value = 1;
            for (let index = 0; index < MAX_HZB_LEVELS; index += 1) uniforms[`tHistoryDepth${index}`].value = ao.depthTexture;
        }
        const blurPlan = createScreenLightingBlurPassPlan(config);
        const previous = renderer.getRenderTarget();
        try {
            // 接触粗筛仅使用当前帧精确2×2范围，不混用SSGI前帧深度或效果分辨率。
            if (config.contactEnabled === true) {
                if (!resources.contactDepthTarget) resources.contactDepthTarget = createRenderTarget(THREE, 1, 1, THREE.UnsignedByteType);
                resources.contactDepthTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
                const reduction = resources.contactDepthMaterial.uniforms;
                reduction.tInput.value = ao.depthTexture;
                reduction.inputSize.value.set(width, height);
                resources.quad.material = resources.contactDepthMaterial;
                renderer.setRenderTarget(resources.contactDepthTarget);
                renderer.clear(); renderer.render(resources.scene, resources.camera);
                uniforms.tContactDepth.value = resources.contactDepthTarget.texture;
            } else {
                resources.contactDepthTarget?.dispose(); resources.contactDepthTarget = null;
                uniforms.tContactDepth.value = ao.depthTexture;
            }
            resources.quad.material = resources.material;
            renderer.setRenderTarget(resources.targets[0]);
            renderer.clear();
            renderer.render(resources.scene, resources.camera);
            if (blurPlan.steps.length > 0) {
                const filter = resources.filterMaterial.uniforms;
                filter.fullSize.value.set(width, height);
                filter.effectSize.value.set(effectWidth, effectHeight);
                resources.quad.material = resources.filterMaterial;
                for (const step of blurPlan.steps) {
                    filter.tInput.value = resources.targets[step.inputIndex].texture;
                    filter.blurRadius.value = step.radius;
                    filter.filterContact.value = step.channel === 'contact';
                    filter.filterAxis.value.set(step.axis === 'horizontal' ? 1 : 0, step.axis === 'vertical' ? 1 : 0);
                    renderer.setRenderTarget(resources.targets[step.outputIndex]);
                    renderer.clear();
                    renderer.render(resources.scene, resources.camera);
                }
            }
            if (config.giEnabled === true && history) {
                const writeIndex = history.valid ? 1 - history.readIndex : 1 - history.readIndex;
                captureHistory(ao, history, writeIndex, width, height, effectWidth, effectHeight);
                history.previousWorld.copy(camera.matrixWorld);
                history.previousView.copy(camera.matrixWorldInverse);
                history.previousProjection.copy(camera.projectionMatrix);
                history.previousStableProjection.copy(stableProjection);
                history.previousInverseProjection.copy(camera.projectionMatrixInverse);
            }
        } finally {
            renderer.setRenderTarget(previous);
        }
        composite.screenLightingTexture.value = resources.targets[blurPlan.targetIndex].texture;
        composite.screenLightingSize.value.set(effectWidth, effectHeight);
        composite.screenLightingFullSize.value.set(width, height);
    };

    return { active, prepare, dispose };
}
