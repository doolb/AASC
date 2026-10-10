'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
const { prepare, stageVendor } = require('../../scripts/ops/mmd-lipsync-assets');

// 正式控制器已包含临时层，独立构建只复制资源并按依赖顺序补内容指纹。
async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    await stageVendor(root);
    const folder = path.join(root, 'js');
    const controller = await fs.readFile(path.join(folder, 'mmd-expressions.mjs'), 'utf8');
    if (!controller.includes('setTransient,') || !controller.includes('...selected, ...transient')) {
        throw new Error('正式表情控制器缺少共享口型层');
    }
    const timelineVersion = (await hashFile(path.join(folder, 'mmd-lipsync-timeline.mjs'))).sha256.slice(0, 12);
    const playerFile = path.join(folder, 'mmd-lipsync-player.mjs');
    let player = await fs.readFile(playerFile, 'utf8');
    player = player.replace('./mmd-lipsync-timeline.mjs', `./mmd-lipsync-timeline.mjs?v=${timelineVersion}`);
    await fs.writeFile(playerFile, player);
    const playerVersion = (await hashFile(playerFile)).sha256.slice(0, 12);
    const uiFile = path.join(folder, 'mmd-lipsync-ui.mjs');
    let ui = await fs.readFile(uiFile, 'utf8');
    ui = ui.replace('./mmd-lipsync-timeline.mjs', `./mmd-lipsync-timeline.mjs?v=${timelineVersion}`)
        .replace('./mmd-lipsync-player.mjs', `./mmd-lipsync-player.mjs?v=${playerVersion}`);
    await fs.writeFile(uiFile, ui);
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    const anchor = "import('./mmd-lipsync-ui.mjs')";
    if (display.split(anchor).length !== 2 || !display.includes('setLipSyncExpressions:')) {
        throw new Error('正式显示模块缺少口型入口');
    }
    display = display.replace(anchor, `import('./mmd-lipsync-ui.mjs?v=${(await hashFile(uiFile)).sha256.slice(0, 12)}')`);
    await fs.writeFile(displayFile, display);
}
module.exports = { prepare, stageRuntime };
if (require.main === module) prepare().then(files => process.stdout.write(`[mmd-ar-lipsync] 固定拼音资源已校验：${files.length}文件\n`))
    .catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
