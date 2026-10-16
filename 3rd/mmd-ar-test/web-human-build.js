'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
const once = (source, anchor, value) => {
    if (source.split(anchor).length !== 2) throw new Error('Human构建缺少唯一锚点：' + anchor);
    return source.replace(anchor, value);
};
async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    if ((await fs.readFile(path.join(root, 'js/display-pmx-runtime.js'), 'utf8')).includes('aasc-shared:human-runtime')) return;
    const folder = path.join(root, 'js'), controllerFile = path.join(folder, 'mmd-expressions.mjs');
    let controller = await fs.readFile(controllerFile, 'utf8');
    controller = once(controller, '    let automatic = new Map();', '    let automatic = new Map();\n    let human = new Map();');
    controller = once(controller, '        automatic.clear();', '        automatic.clear();\n        human.clear();');
    controller = once(controller, '...automatic, ...selected, ...transient', '...automatic, ...human, ...selected, ...transient');
    const start = controller.indexOf('    function setTransient('), end = controller.indexOf('    function setAutomatic(', start);
    if (start < 0 || end < 0) throw new Error('Human构建缺少共享Morph通道');
    const human = controller.slice(start, end).replace('function setTransient(', 'function setHuman(')
        .replace('transient = next;', 'human = next;').replaceAll('口型', 'Human')
        .replace('        onTransientChanged?.();', '        // Human在当前渲染帧内合成，不再次排队渲染；外部操作自行唤醒。');
    controller = controller.slice(0, end) + human + controller.slice(end);
    controller = once(controller, '        setAutomatic,', '        setAutomatic,\n        setHuman,');
    controller = once(controller, 'automatic.clear(); selected.clear();', 'automatic.clear(); human.clear(); selected.clear();');
    await fs.writeFile(controllerFile, controller);
    const runtimeFile = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimeFile, 'utf8');
    runtime = "import { createHumanInterfaceElement } from './web-human-interface.mjs';\n" + runtime;
    runtime = once(runtime, '    const physicsGate =', '    const human = createHumanInterfaceElement({ getMesh: () => currentMesh,\n'
        + '        getHelper: () => helper.current, getProfile: () => currentProfile, getCamera: () => camera, getScene: () => scene, canvas, manualExpressions,\n'
        + '        startRendering: () => startRendering() });\n    const physicsGate =');
    runtime = once(runtime, '        manualExpressions.before(frameHelper);', '        human.before(delta, frameHelper);\n        manualExpressions.before(frameHelper);');
    // 物理/表情回调可能在帧内唤醒渲染，帧末复用已排队的帧，保持单一RAF循环。
    runtime = once(runtime, '        shadowMapPreview.update(now);\n        frameHandle = requestAnimationFrame(renderFrame);',
        '        shadowMapPreview.update(now);\n        if (!frameHandle) frameHandle = requestAnimationFrame(renderFrame);');
    runtime = once(runtime, '        manualExpressions.dispose();', '        human.dispose();\n        manualExpressions.dispose();');
    runtime = once(runtime, 'manualExpressions.setAutomatic(token, weights)', "human.setExpressionWeights('reply', token, weights)");
    runtime = once(runtime, 'manualExpressions.setTransient(token, weights)', 'human.mouth.setWeights(token, weights)');
    runtime = once(runtime, 'manualExpressions.set(index, weight)', 'human.face.set(index, weight)');
    runtime = once(runtime, 'manualExpressions.clear()', 'human.face.clear()');
    runtime = once(runtime, '    const setVisible = (nextVisible) => {', '    const setVisible = (nextVisible) => {\n        human.setVisible(nextVisible);');
    runtime = once(runtime, '        getManualExpressions:', '        getHumanInterface: () => human,\n        getManualExpressions:');
    await fs.writeFile(runtimeFile, runtime);
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    display = once(display, '        setReplyExpressions:', "        getHumanInterface: () => state.runtimeType === 'pmx' ? state.runtime?.getHumanInterface?.() : null,\n        setReplyExpressions:");
    await fs.writeFile(displayFile, display);
}
async function stage(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js'), version = async file => (await hashFile(path.join(folder, file))).sha256.slice(0, 12);
    await require('./web-human-pose-assets').stagePoseAssets(root);
    const versions = new Map();
    for (const file of ['web-reply-gestures.mjs', 'web-reply-actions.mjs', 'web-reply-expressions.mjs', 'web-local-assets.mjs',
        'mmd-mpl-worker.mjs', 'vendor/three/libs/mmdparser.module.js', 'web-xpbd-collision.mjs',
        'web-rigid-body-debug.mjs', 'mmd-ammo-physics.mjs']) versions.set(file, await version(file));
    const names = ['server-actions', 'rigid-snapshot', 'arm-avoidance', 'model', 'compiler', 'vmd', 'mixer', 'storage', 'physiology', 'reflex', 'gaze', 'ik-pbd', 'ik-markers', 'physics-rig', 'body-damping', 'physics-drive', 'pose-core', 'pose-rtmpose', 'pose-worker', 'pose-client', 'pose-lift', 'pose-retarget', 'pose-projection', 'pose-camera', 'camera-control', 'pose-overlay', 'ik', 'interface', 'pose-ui', 'ik-mode', 'ik-ui', 'ui'];
    for (const suffix of names) {
        const file = 'web-human-' + suffix + '.mjs';
        let source = await fs.readFile(path.join(__dirname, file), 'utf8');
        for (const [dependency, hash] of versions) source = source.replaceAll('./' + dependency, './' + dependency + '?v=' + hash);
        await fs.writeFile(path.join(folder, file), source); versions.set(file, await version(file));
    }
    const runtimeFile = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimeFile, 'utf8');
    // Human共享桥接已存在时只在独立WEB副本补入场景引用，不修改正式显示端源码。
    if (runtime.includes("getCamera: () => camera, canvas, manualExpressions")) {
        runtime = once(runtime, 'getCamera: () => camera, canvas, manualExpressions', 'getCamera: () => camera, getScene: () => scene, canvas, manualExpressions');
    }
    const oldHash = await version('display-pmx-runtime.js');
    runtime = await require('./web-human-camera-build').stageImageCameraControl(folder, runtime, versions.get('web-human-camera-control.mjs'));
    if (runtime.includes('./mmd-human-runtime.mjs')) {
        // 正式桥接在测试副本继续使用独立Human核心，保留测试页尚在编辑的功能。
        const bridgeFile = path.join(folder, 'mmd-human-runtime.mjs');
        const bridge = (await fs.readFile(bridgeFile, 'utf8')).replace('./mmd-human-interface.mjs', './web-human-interface.mjs?v=' + versions.get('web-human-interface.mjs'));
        await fs.writeFile(bridgeFile, bridge);
        runtime = runtime.replace(/\.\/mmd-human-runtime\.mjs(?:\?v=[a-f0-9]+)?/u, './mmd-human-runtime.mjs?v=' + await version('mmd-human-runtime.mjs'));
    } else {
        runtime = once(runtime, './web-human-interface.mjs', './web-human-interface.mjs?v=' + versions.get('web-human-interface.mjs'));
    }
    await fs.writeFile(runtimeFile, runtime);
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    display = once(display, './display-pmx-runtime.js?v=' + oldHash, './display-pmx-runtime.js?v=' + await version('display-pmx-runtime.js'));
    display += "\nimport('./web-human-ui.mjs?v=" + versions.get('web-human-ui.mjs') + "').catch(error => console.warn('[MMD] Human面板加载失败:', error));\n";
    display += "\nimport('./web-human-ik-ui.mjs?v=" + versions.get('web-human-ik-ui.mjs') + "').catch(error => console.warn('[MMD] IK面板加载失败:', error));\n";
    await fs.writeFile(displayFile, display);
    const helperFile = path.join(folder, 'vendor/three/animation/MMDAnimationHelper.js');
    let helper = await fs.readFile(helperFile, 'utf8');
    if (helper.includes('aasc-shared:human-helper')) return;
    // 基础姿态备份不含Human增量；每帧只从当前基础姿态合成一次，再进行IK/grant和物理。
    helper = once(helper, '\t\t\t// PMX animation system special path',
        '\t\t}\n\n\t\tif ( this.onHumanPose ) {\n'
        + '\t\t\tif ( ! mixer || ! this.enabled.animation ) {\n'
        + '\t\t\t\tif ( ! objects.backupBones ) this._saveBones( mesh );\n'
        + '\t\t\t\telse this._restoreBones( mesh );\n\t\t\t}\n'
        + '\t\t\tthis.onHumanPose( mesh, delta );\n\t\t}\n\n'
        + '\t\tif ( ( mixer && this.enabled.animation ) || this.onHumanPose ) {\n'
        + '\t\t\t// PMX animation system special path');
    helper = once(helper, '\t\tif ( looped === true && this.enabled.physics ) {',
        '\t\tif ( this.onHumanAfterIK ) this.onHumanAfterIK( mesh, delta, physics );\n\n\t\tif ( looped === true && this.enabled.physics ) {');
    helper = once(helper, '\t\t\tphysics.update( delta );\n\n\t\t}',
        '\t\t\tphysics.update( delta );\n\n\t\t}\n\n\t\tif ( this.onHumanAfterPhysics ) this.onHumanAfterPhysics( mesh, physics );');
    await fs.writeFile(helperFile, helper);
}
module.exports = { stageRuntime, stage };
