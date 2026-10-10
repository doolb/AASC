'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');

async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js');
    const runtime = await fs.readFile(path.join(folder, 'display-pmx-runtime.js'), 'utf8');
    if (!runtime.includes("from './mmd-expressions.mjs'")
        || !runtime.includes('manualExpressions.before(frameHelper)')
        || !runtime.includes('manualExpressions.after()')) {
        throw new Error('正式PMX运行时缺少共享表情控制器');
    }
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    const anchor = "import('./mmd-expressions-ui.mjs')";
    if (display.split(anchor).length !== 2 || !display.includes('getManualExpressions:')) {
        throw new Error('正式显示模块缺少共享表情接口或面板入口');
    }
    const version = (await hashFile(path.join(folder, 'mmd-expressions-ui.mjs'))).sha256.slice(0, 12);
    display = display.replace(anchor, `import('./mmd-expressions-ui.mjs?v=${version}')`);
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
