'use strict';

// 正式核心复用后，只为独立测试包追加顶点后端及阴影诊断。
const once = (source, anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error(`测试扩展锚点缺失或重复：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
};

function addClothSupport(source, operation, args) {
    source = source.replace('function normalizePhysicsSolver(value) {',
        "function normalizePhysicsSolver(value) {\n    if (['vertex-cloth', 'vertex-cloth-gpu'].includes(value)) return value;");
    const handlers = {
        addSolverHelper: text => text.replace("physics.engine === 'xpbd'", "physics.engine === 'xpbd' || ['vertex-cloth', 'vertex-cloth-gpu'].includes(physics.engine)"),
        addSolverAnimationHelper: text => `import { VertexClothPmxPhysics } from '${args[1]}';\n` +
            once(text, '\t_createMMDPhysics( mesh, params ) {', `\t_createMMDPhysics( mesh, params ) {
        if (['vertex-cloth', 'vertex-cloth-gpu'].includes(params.physicsSolver)) return new VertexClothPmxPhysics(mesh, params,
            (target, bodies, joints, options) => new MMDPhysics(target, bodies, joints, options));`),
        addSolverRuntime: text => once(once(text, '    const setPhysicsSolver =', `    const timedPhysics = new WeakSet();
    const timePhysics = physics => {
        if (!physics || timedPhysics.has(physics)) return;
        const update = physics.update;
        physics.update = function(delta) {
            const begin = performance.now();
            try { return update.call(this, delta); }
            finally { this.frameMs = performance.now() - begin; }
        };
        timedPhysics.add(physics);
    };
    const setPhysicsSolver =`).replace('        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);',
            '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);\n        timePhysics(frameHelper?.objects?.get(currentMesh)?.physics);'), '        setPhysicsSolver,', `        setVertexClothGroup: (id, enabled) => {
            const result = helper.current?.objects?.get(currentMesh)?.physics?.setGroupEnabled?.(id, enabled) === true;
            startRendering(); return result;
        },
        setVertexClothPreview: value => helper.current?.objects?.get(currentMesh)?.physics?.setPreview?.(value) || false,
        setPhysicsSolver,`),
        addSolverDisplay: text => once(text, '        setPhysicsSolver,', `        setVertexClothGroup: (id, enabled) => !physicsConfigurationBusy && (state.runtime?.setVertexClothGroup?.(id, enabled) || false),
        setVertexClothPreview: value => state.runtime?.setVertexClothPreview?.(value) || false,
        setPhysicsSolver,`)
    };
    let output = handlers[operation]?.(source) || source;
    if (operation === 'addSolverRuntime') output = once(output,
        '        const prepared = await createPmxMotionHelper({',
        '        mesh._aascVertexClothRenderer = renderer;\n        const prepared = await createPmxMotionHelper({');
    return output;
}

function addShadowDiagnostics(source, moduleUrl) {
    const diagnostic = `
    const shadowMapPreview = createShadowMapPreview({ THREE, renderer, lights: [keyLight, fillLight],
        getStatus: (index, enabled) => {
            if (!enabled) return '阴影已关闭';
            if (index === 0) return keyLight.castShadow ? '' : '主光阴影已关闭';
            if (!lightingState.fillEnabled) return '补光已关闭';
            if (shadowSource === 'key') return '沿用主光阴影（复用上图）';
            return fillLight.castShadow ? '' : '补光不生成阴影';
        } });
    const shadowMapDiagnostic = () => ({
        size: keyLight.shadow.mapSize.x, limit: shadowMapLimit,
        cameraScale: normalizeShadowCameraScale(window.MmdArTestShadowMapSettings?.cameraScale),
        jointFit: jointShadowCameraFitter.getState(),
        follow: { position: shadowFollowRoot ? shadowFollowPosition.toArray() : null,
            scale: shadowFollowRoot ? shadowFollowScale.toArray() : null,
            fitCount: shadowFitCount, translationCount: shadowTranslationCount, planePosition: shadowPlane.position.toArray() },
        maps: [keyLight, fillLight].map(light => ({ width: light.shadow.map?.width || 0,
            height: light.shadow.map?.height || 0, castShadow: light.castShadow,
            position: light.position.toArray(), target: light.target.position.toArray(),
            originPixel: (() => { const origin = new THREE.Vector3().project(light.shadow.camera);
                return [(origin.x * .5 + .5) * light.shadow.mapSize.x, (origin.y * .5 + .5) * light.shadow.mapSize.y]; })(),
            camera: { left: light.shadow.camera.left, right: light.shadow.camera.right,
                top: light.shadow.camera.top, bottom: light.shadow.camera.bottom,
                near: light.shadow.camera.near, far: light.shadow.camera.far } })),
        memory: { ...renderer.info.memory }, preview: shadowMapPreview.getState()
    });
    window.MmdArTestShadowMapDiagnostic = shadowMapDiagnostic;
`;
    let output = once(source, '    // 初次同步发生', diagnostic + '    // 初次同步发生');
    output = once(output, '    const applyShadowMode = () => {', `    const jointShadowCameraFitter = createJointShadowCameraFitter({
        THREE, camera, lights: [keyLight, fillLight],
        getRoot: () => currentRotationPivot || currentMesh,
        getModelBounds, receiver: shadowPlane,
        getCameraScale: () => normalizeShadowCameraScale(window.MmdArTestShadowMapSettings?.cameraScale),
        targetModelHeight: TARGET_MODEL_HEIGHT
    });
    const applyShadowMode = () => {`);
    output = once(output, '            followTestShadowRoot();',
        '            followTestShadowRoot();\n            jointShadowCameraFitter.update();');
    output = once(output, '        syncTestShadowMapSize();',
        '        syncTestShadowMapSize();\n        shadowMapPreview.setEnabled(window.MmdArTestShadowMapSettings?.previewEnabled === true);');
    output = once(output, '        ambientOcclusion.dispose();', `        shadowMapPreview.dispose();
        if (window.MmdArTestShadowMapDiagnostic === shadowMapDiagnostic) delete window.MmdArTestShadowMapDiagnostic;
        ambientOcclusion.dispose();`);
    output = once(output, '            if (firstFramePivot) firstFramePivot.visible = firstFramePivotVisible;\n        }',
        '            if (firstFramePivot) firstFramePivot.visible = firstFramePivotVisible;\n        }\n        shadowMapPreview.update(now);');
    return `import { createShadowMapPreview, createJointShadowCameraFitter } from '${moduleUrl}';\n${output}`;
}

module.exports = { addClothSupport, addShadowDiagnostics };
