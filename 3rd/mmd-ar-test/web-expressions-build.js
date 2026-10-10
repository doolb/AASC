'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');

// 调试接口仅写入独立网页生成副本，正式运行时只保留口型所需的状态与临时层。
function addDebugInterfaces(source, anchor, interfaces) {
    if (source.split(anchor).length !== 2) throw new Error(`独立表情构建缺少唯一接口锚点：${anchor}`);
    return source.replace(anchor, `${interfaces}\n${anchor}`);
}

async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js');
    const runtimeFile = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimeFile, 'utf8');
    if (!runtime.includes("from './mmd-expressions.mjs'")
        || !runtime.includes('manualExpressions.before(frameHelper)')
        || !runtime.includes('manualExpressions.after()')) {
        throw new Error('正式PMX运行时缺少共享表情控制器');
    }
    runtime = addDebugInterfaces(runtime, '        getManualExpressions: () =>', `        getMplModelState: () => {
            const state = manualExpressions.getState();
            const dictionary = currentMesh?.morphTargetDictionary || {};
            return { token: state.token, ready: state.ready,
                bones: (currentMesh?.skeleton?.bones || []).map(bone => bone.name),
                morphs: state.items.map(item => ({ name: item.name, type: item.type, panel: item.panel,
                    supported: item.supported && Object.hasOwn(dictionary, item.name)
                        && dictionary[item.name] === item.index })) };
        },
        setManualExpression: (index, weight) => manualExpressions.set(index, weight),
        clearManualExpressions: () => manualExpressions.clear(),`);
    await fs.writeFile(runtimeFile, runtime);
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    display = addDebugInterfaces(display, '        getManualExpressions: () =>', `        getMplModelState: () => state.modelReady && state.runtimeType === 'pmx'
            ? state.runtime?.getMplModelState?.() : { token: '', ready: false, bones: [], morphs: [] },
        setManualExpression: (index, weight) => state.modelReady && state.runtimeType === 'pmx'
            && state.runtime?.setManualExpression?.(index, weight),
        clearManualExpressions: () => state.modelReady && state.runtimeType === 'pmx'
            && state.runtime?.clearManualExpressions?.(),`);
    await fs.copyFile(path.join(__dirname, 'web-expressions-ui.mjs'), path.join(folder, 'mmd-expressions-ui.mjs'));
    const version = (await hashFile(path.join(folder, 'mmd-expressions-ui.mjs'))).sha256.slice(0, 12);
    display += `\n// 手动表情仅在独立网页构建加入，正式端不加载调试面板。\nimport('./mmd-expressions-ui.mjs?v=${version}').catch(error => console.warn('[MMD] 表情面板加载失败:', error));\n`;
    await fs.writeFile(displayFile, display);
}

async function stageVendor(root, { webMode = false } = {}) {
    if (!webMode) return '';
    const file = path.join(root, 'js/vendor/three/loaders/MMDLoader.js');
    const source = await fs.readFile(file, 'utf8');
    if (!source.includes('morphs: data.morphs.map(')) throw new Error('正式MMDLoader缺少表情简表');
    return (await hashFile(file)).sha256.slice(0, 12);
}

module.exports = { stageRuntime, stageVendor };
