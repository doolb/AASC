'use strict';

// 只修改独立测试生成副本。renderer按网格绑定，覆盖首次加载与本地VMD重建同一入口。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error('WebGL XPBD缺少唯一构建锚点：' + anchor);
    return source.replace(anchor, replacement);
}
function applyWebglSolver(source, operation, url) {
    if (source.includes('function normalizePhysicsSolver(value) {') && !source.includes("if (value === 'xpbd-webgl')")) {
        source = source.replace('function normalizePhysicsSolver(value) {',
            "function normalizePhysicsSolver(value) {\n    if (value === 'xpbd-webgl') return value;");
    }
    const handlers = {
        addSolverHelper: text => text.replace("if (physicsSolver !== 'xpbd') await ensurePhysics();",
            "if (!['xpbd', 'xpbd-webgl'].includes(physicsSolver)) await ensurePhysics();"),
        addSolverAnimationHelper: text => once(`import { createWebglPmxPhysics } from '${url}';\n` +
            once(text, '\t_createMMDPhysics( mesh, params ) {', `\t_createMMDPhysics( mesh, params ) {
        if (params.physicsSolver === 'xpbd-webgl') return createWebglPmxPhysics(mesh,
            mesh.geometry.userData.MMD.rigidBodies, mesh.geometry.userData.MMD.constraints, params);`),
            'physics.update( delta );', 'physics.setDirectPoseAnimated?.(Boolean(mixer && this.enabled.animation));\n\t\t\tphysics.update( delta );'),
        addSolverRuntime: text => {
            let output = `import { bindWebglRenderer } from '${url}';\n` +
                once(text, '        const prepared = await createPmxMotionHelper({',
                    '        bindWebglRenderer(mesh, renderer);\n        const prepared = await createPmxMotionHelper({')
                    .replaceAll("physicsSolver === 'xpbd' ? async () => {}", "['xpbd', 'xpbd-webgl'].includes(physicsSolver) ? async () => {}");
            output = once(output, '    const setPhysicsSolver = (value) => {', `    const directBonesKey = 'aasc.mmdArTest.gpuPhysicsBoneTexture.v1';
    let directBonesRequested = false;
    try { directBonesRequested = localStorage.getItem(directBonesKey) === 'true'; }
    catch (error) { /* 隐私模式下保留默认关闭。 */ }
    const setPhysicsSolver = (value) => {`);
            output = once(output, '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);',
                '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);\n        framePhysics?.setDirectCpuPoseRequired?.(skeletonOverlay.getState().enabled || rigidBodyOverlay.getState().enabled);\n        framePhysics?.setDirectBoneTexture?.(directBonesRequested);');
            for (const [method, overlay] of [['setSkeletonVisible', 'skeletonOverlay'], ['setRigidBodyVisible', 'rigidBodyOverlay']]) {
                output = once(output, `        ${method}: ${overlay}.setVisible,`, `        ${method}: value => {
            // 开启CPU诊断立即同步，后续帧由Overlay状态维持同步兼容。
            if (value) helper.current?.objects?.get(currentMesh)?.physics?.syncGpuPose?.();
            ${overlay}.setVisible(value);
        },`);
            }
            output = once(output, '        setMotionPlaybackEnabled,', `        setGpuPhysicsBoneTextureEnabled: value => {
            directBonesRequested = value === true;
            helper.current?.objects?.get(currentMesh)?.physics?.setDirectBoneTexture?.(directBonesRequested);
            startRendering(); return directBonesRequested;
        },
        getGpuPhysicsBoneTextureRequested: () => directBonesRequested,
        syncGpuPhysicsPose: () => helper.current?.objects?.get(currentMesh)?.physics?.syncGpuPose?.() || false,
        setMotionPlaybackEnabled,`);
            output = once(output, '    const raycast = (point) => {', `    const raycast = (point) => {
        // Three的Raycaster在CPU计算蒙皮顶点，点击时只同步这一次物理姿态。
        helper.current?.objects?.get(currentMesh)?.physics?.syncGpuPose?.();`);
            return output;
        },
        addSolverDisplay: text => once(text, '        getPhysicsSolverState: () =>', `        setGpuPhysicsBoneTextureEnabled: value => state.runtime?.setGpuPhysicsBoneTextureEnabled?.(value) === true,
        getGpuPhysicsBoneTextureRequested: () => state.runtime?.getGpuPhysicsBoneTextureRequested?.(),
        syncGpuPhysicsPose: () => state.runtime?.syncGpuPhysicsPose?.() === true,
        getPhysicsSolverState: () =>`)
    };
    return handlers[operation]?.(source) || source;
}
module.exports = { applyWebglSolver };
