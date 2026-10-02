'use strict';

// 只改网页生成副本；固定源锚点必须唯一，防止正式代码升级后只放开部分限幅。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`网页物理频率适配缺少唯一锚点：${anchor}`);
    return source.replace(anchor, replacement);
}

function addPhysicsRateDisplay(source) {
    let output = once(source, 'physicsFps: 65,', 'physicsFps: 90,');
    output = once(output, '    function normalizePhysicsFps(value) {', `    function normalizePhysicsFps(value) {
        // 缺失或空白频率恢复测试默认，避免Number(null/空串)被当作0后落到30Hz。
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
            return DEFAULT_MMD_LIGHTING.physicsFps;
        }`);
    return once(output, 'clamp(value, 30, 90, DEFAULT_MMD_LIGHTING.physicsFps)',
        'clamp(value, 30, 180, DEFAULT_MMD_LIGHTING.physicsFps)');
}

function addPhysicsRateLighting(source) {
    return once(source, 'const DEFAULT_PHYSICS_FPS = 65;', 'const DEFAULT_PHYSICS_FPS = 90;');
}

function addPhysicsRateHelper(source, moduleUrl) {
    let output = `import { getWebPhysicsStepOptions } from '${moduleUrl}';\n${source}`;
    output = once(output, 'const DEFAULT_PMX_PHYSICS_FPS = 65;', 'const DEFAULT_PMX_PHYSICS_FPS = 90;');
    output = once(output, 'const normalizePmxPhysicsFps = (value) => {', `const normalizePmxPhysicsFps = (value) => {
    if (value === null || (typeof value === 'string' && value.trim() === '')) return DEFAULT_PMX_PHYSICS_FPS;`);
    output = once(output, 'Math.min(90, Math.max(30, number))', 'Math.min(180, Math.max(30, number))');
    return once(output, `        options.unitStep = 1 / normalizePmxPhysicsFps(physicsFps);
        options.maxStepNum = 3;`,
        '        Object.assign(options, getWebPhysicsStepOptions(normalizePmxPhysicsFps(physicsFps)));');
}

// 在本地资源适配之后接入；模型初始化、当前物理实时调节均使用同一预算。
// 步进参数同时携带关节纠错基准Hz（由稳定性注入声明），参考值变更时物理实例属性一起更新。
function addPhysicsRateRuntime(source, moduleUrl) {
    let output = `import { getWebPhysicsStepOptions, normalizeWebStabilityReference } from '${moduleUrl}';\n${source}`;
    output = once(output, 'physicsFps: 65,', 'physicsFps: 90,');
    output = once(output, '    const normalizePhysicsFps = (value) => {', `    const normalizePhysicsFps = (value) => {
        // 更新其他灯光参数时保留当前物理频率；初始化的当前值为测试默认90Hz。
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
            return lightingState.physicsFps;
        }`);
    output = once(output, 'normalizeLightNumber(value, 30, 90, lightingState.physicsFps)',
        'normalizeLightNumber(value, 30, 180, lightingState.physicsFps)');
    output = once(output, 'if (currentPhysics) currentPhysics.unitStep = 1 / lightingState.physicsFps;',
        'if (currentPhysics) Object.assign(currentPhysics, getWebPhysicsStepOptions(lightingState.physicsFps, physicsStabilityReferenceHz));');
    return once(output, '            physics.unitStep = 1 / lightingState.physicsFps;',
        '            Object.assign(physics, getWebPhysicsStepOptions(lightingState.physicsFps, physicsStabilityReferenceHz));');
}

module.exports = { addPhysicsRateDisplay, addPhysicsRateLighting, addPhysicsRateHelper, addPhysicsRateRuntime };

// 正式源码已包含此功能时复用共享实现，仅更新构建指纹。
module.exports = require('./web-production-shared').reuseAdapters(module.exports);
