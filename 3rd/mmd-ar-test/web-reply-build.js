'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
const once = (source, anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error(`回复构建缺少唯一锚点：${anchor}`);
    return source.replace(anchor, replacement);
};
async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js');
    const controllerFile = path.join(folder, 'mmd-expressions.mjs');
    let controller = await fs.readFile(controllerFile, 'utf8');
    controller = once(controller, '    let transient = new Map();', '    let transient = new Map();\n    let automatic = new Map();');
    controller = once(controller, '        transient.clear();', '        transient.clear();\n        automatic.clear();');
    controller = once(controller, '...selected, ...transient', '...automatic, ...selected, ...transient');
    const start = controller.indexOf('    function setTransient('), end = controller.indexOf('\n    return {', start);
    if (start < 0 || end < 0) throw new Error('回复构建缺少共享临时层函数');
    const automatic = controller.slice(start, end).replace('function setTransient(', 'function setAutomatic(')
        .replace('transient = next;', 'automatic = next;').replaceAll('口型', '自动表情');
    controller = controller.slice(0, end) + '\n' + automatic + controller.slice(end);
    controller = once(controller, '        setTransient,', '        setTransient,\n        setAutomatic,');
    controller = once(controller, 'transient.clear(); selected.clear();', 'transient.clear(); automatic.clear(); selected.clear();');
    await fs.writeFile(controllerFile, controller);
    const runtimeFile = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimeFile, 'utf8');
    runtime = once(runtime, '        setLipSyncExpressions:', '        setReplyExpressions: (token, weights) => manualExpressions.setAutomatic(token, weights),\n        setLipSyncExpressions:');
    runtime = once(runtime, 'motionResourceId: motion.motionResourceId };', "motionResourceId: motion.motionResourceId, playMode: motion.playMode || currentProfile.playMode };");
    await fs.writeFile(runtimeFile, runtime);
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    display = once(display, '        setLipSyncExpressions:', `        setReplyExpressions: (token, weights) => state.modelReady && state.runtimeType === 'pmx'
            && state.runtime?.setReplyExpressions?.(token, weights),
        setLipSyncExpressions:`);
    await fs.writeFile(displayFile, display);
    // 独立生成副本暴露现有口型player，避免AI回复另建一个嘴型写入者。
    const playerFile = path.join(folder, 'mmd-lipsync-player.mjs');
    let player = await fs.readFile(playerFile, 'utf8');
    player = once(player, '            void start(text);', '            return start(text);');
    player = once(player, '        get isTts()', `        get previewState() { return { sequence: generation, phase, token: ownedToken,
            time: entry ? audio.currentTime : Math.max(0, (performance.now() - startAt) / 1000),
            duration: entry ? audio.duration : timeline?.duration || 0,
            units: (timeline?.units || []).map(unit => ({ label: unit.label, start: unit.start, end: unit.end })) }; },
        get isTts()`);
    await fs.writeFile(playerFile, player);
    const uiFile = path.join(folder, 'mmd-lipsync-ui.mjs');
    let ui = await fs.readFile(uiFile, 'utf8');
    ui = once(ui, "    play.addEventListener('click',", `    window.MmdArLipSyncPreview = Object.freeze({
        async play(text) { sync(); input.value = text; await player.preview(text); return player.previewState; },
        getState: () => player.previewState,
        stop(sequence) { if (sequence === undefined || sequence === player.previewState.sequence) player.stop(); }
    });
    window.dispatchEvent(new Event('mmd-ar-lipsync-ready'));
    play.addEventListener('click',`);
    await fs.writeFile(uiFile, ui);
}
async function stage(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js');
    const names = ['web-reply-parser.mjs', 'web-reply-expressions.mjs', 'web-reply-actions.mjs', 'web-reply-player.mjs', 'web-reply-ui.mjs'];
    const versions = new Map();
    versions.set('mmd-lipsync-timeline.mjs', (await hashFile(path.join(folder, 'mmd-lipsync-timeline.mjs'))).sha256.slice(0, 12));
    for (const name of names) {
        let source = await fs.readFile(path.join(__dirname, name), 'utf8');
        for (const [dependency, hash] of versions) source = source.replaceAll(`./${dependency}`, `./${dependency}?v=${hash}`);
        await fs.writeFile(path.join(folder, name), source);
        versions.set(name, (await hashFile(path.join(folder, name))).sha256.slice(0, 12));
    }
    const file = path.join(folder, 'display-mmd.js');
    await fs.appendFile(file, `\nimport('./web-reply-ui.mjs?v=${versions.get('web-reply-ui.mjs')}').catch(error => console.warn('[MMD] 回复预览加载失败:', error));\n`);
}
module.exports = { stageRuntime, stage };
