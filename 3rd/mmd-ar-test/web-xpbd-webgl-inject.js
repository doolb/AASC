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
        addSolverAnimationHelper: text => `import { createWebglPmxPhysics } from '${url}';\n` +
            once(text, '\t_createMMDPhysics( mesh, params ) {', `\t_createMMDPhysics( mesh, params ) {
        if (params.physicsSolver === 'xpbd-webgl') return createWebglPmxPhysics(mesh,
            mesh.geometry.userData.MMD.rigidBodies, mesh.geometry.userData.MMD.constraints, params);`),
        addSolverRuntime: text => `import { bindWebglRenderer } from '${url}';\n` +
            once(text, '        const prepared = await createPmxMotionHelper({',
                '        bindWebglRenderer(mesh, renderer);\n        const prepared = await createPmxMotionHelper({')
                .replaceAll("physicsSolver === 'xpbd' ? async () => {}", "['xpbd', 'xpbd-webgl'].includes(physicsSolver) ? async () => {}")
    };
    return handlers[operation]?.(source) || source;
}
module.exports = { applyWebglSolver };
