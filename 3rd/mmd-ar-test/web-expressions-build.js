'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');

function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`表情构建缺少唯一锚点：${anchor.slice(0, 80)}`);
    return source.replace(anchor, replacement);
}

async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js');
    const versions = new Map();
    for (const name of ['web-expressions.mjs', 'web-expressions-ui.mjs']) {
        await fs.copyFile(path.join(__dirname, name), path.join(folder, name));
        versions.set(name, (await hashFile(path.join(folder, name))).sha256.slice(0, 12));
    }
    const runtimeFile = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimeFile, 'utf8');
    runtime = `import { createManualExpressions } from './web-expressions.mjs?v=${versions.get('web-expressions.mjs')}';\n` + runtime;
    runtime = once(runtime, '    const helper = { current: null };', `    const helper = { current: null };
    const manualExpressions = createManualExpressions({ getMesh: () => currentMesh, getHelper: () => helper.current,
        getProfile: () => currentProfile, onChanged: () => {
            ambientOcclusion.invalidateTemporal(); startRendering();
        } });`);
    runtime = once(runtime, '        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);',
        '        manualExpressions.before(frameHelper);\n        syncPhysicsWind(frameHelper?.objects?.get(currentMesh)?.physics);');
    runtime = once(runtime, '            if (delayInitialMotion) setPmxMotionPlaybackEnabled(frameHelper, motionPlaybackEnabled);',
        '            manualExpressions.after();\n            if (delayInitialMotion) setPmxMotionPlaybackEnabled(frameHelper, motionPlaybackEnabled);');
    runtime = once(runtime, '    const dispose = () => {', '    const dispose = () => {\n        manualExpressions.dispose();');
    runtime = once(runtime, '        getMotionProgress: () => {', `        getManualExpressions: () => manualExpressions.getState(),
        setManualExpression: (index, weight) => manualExpressions.set(index, weight),
        clearManualExpressions: () => manualExpressions.clear(),
        getMotionProgress: () => {`);
    await fs.writeFile(runtimeFile, runtime);
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    display = once(display, '        DEFAULT_MMD_LIGHTING,', `        getManualExpressions: () => state.modelReady && state.runtimeType === 'pmx'
            ? state.runtime?.getManualExpressions?.() : { token: '', ready: false, items: [] },
        setManualExpression: (index, weight) => state.modelReady && state.runtimeType === 'pmx'
            && state.runtime?.setManualExpression?.(index, weight),
        clearManualExpressions: () => state.modelReady && state.runtimeType === 'pmx'
            && state.runtime?.clearManualExpressions?.(),
        DEFAULT_MMD_LIGHTING,`);
    display += `\nimport('./web-expressions-ui.mjs?v=${versions.get('web-expressions-ui.mjs')}');\n`;
    await fs.writeFile(displayFile, display);
}

async function stageVendor(root, { webMode = false } = {}) {
    if (!webMode) return '';
    const file = path.join(root, 'js/vendor/three/loaders/MMDLoader.js');
    let source = await fs.readFile(file, 'utf8');
    source = once(source, '\t\tgeometry.userData.MMD = {', `\t\tgeometry.userData.MMD = {
            // 仅独立网页保存表情简表，不复制完整顶点数据，也不修改源PMX。
            morphs: data.morphs.map(morph => ({ name: morph.name, englishName: morph.englishName || '',
                type: morph.type, panel: morph.panel, supported: morph.elementCount > 0 && (morph.type === 1
                    || (morph.type === 0 && morph.elements.every(element => data.morphs[element.index]?.type === 1))) })),`);
    await fs.writeFile(file, source);
    return (await hashFile(file)).sha256.slice(0, 12);
}

module.exports = { stageRuntime, stageVendor };
