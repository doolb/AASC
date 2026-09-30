'use strict';

// 只改网页生成副本；固定源锚点必须唯一，防止正式代码升级后只放开部分限幅。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`网页物理频率适配缺少唯一锚点：${anchor}`);
    return source.replace(anchor, replacement);
}

function addPhysicsRateDisplay(source) {
    return once(source, 'clamp(value, 30, 90, DEFAULT_MMD_LIGHTING.physicsFps)',
        'clamp(value, 30, 480, DEFAULT_MMD_LIGHTING.physicsFps)');
}

function addPhysicsRateHelper(source, moduleUrl) {
    let output = `import { getWebPhysicsStepOptions } from '${moduleUrl}';\n${source}`;
    output = once(output, 'Math.min(90, Math.max(30, number))', 'Math.min(480, Math.max(30, number))');
    return once(output, `        options.unitStep = 1 / normalizePmxPhysicsFps(physicsFps);
        options.maxStepNum = 3;`,
        '        Object.assign(options, getWebPhysicsStepOptions(normalizePmxPhysicsFps(physicsFps)));');
}

// 在本地资源适配之后接入；模型初始化、当前物理实时调节均使用同一预算。
function addPhysicsRateRuntime(source, moduleUrl) {
    let output = `import { getWebPhysicsStepOptions } from '${moduleUrl}';\n${source}`;
    output = once(output, 'normalizeLightNumber(value, 30, 90, lightingState.physicsFps)',
        'normalizeLightNumber(value, 30, 480, lightingState.physicsFps)');
    output = once(output, 'if (currentPhysics) currentPhysics.unitStep = 1 / lightingState.physicsFps;',
        'if (currentPhysics) Object.assign(currentPhysics, getWebPhysicsStepOptions(lightingState.physicsFps));');
    return once(output, '            physics.unitStep = 1 / lightingState.physicsFps;',
        '            Object.assign(physics, getWebPhysicsStepOptions(lightingState.physicsFps));');
}

module.exports = { addPhysicsRateDisplay, addPhysicsRateHelper, addPhysicsRateRuntime };
