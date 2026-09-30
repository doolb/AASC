'use strict';

// 只注入 WEB_MODE 副本；源文件锚点变化时中止构建，避免漏掉清理或首帧门控。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`骨骼显示适配缺少唯一锚点：${anchor}`);
    return source.replace(anchor, replacement);
}

function addSkeletonRuntime(source, moduleUrl) {
    let output = `import { createSkeletonOverlay } from '${moduleUrl}';\n${source}`;
    output = once(output, '    let currentMesh = null;',
        '    const skeletonOverlay = createSkeletonOverlay({ THREE, renderer, camera });\n    let currentMesh = null;');
    output = once(output, '    const disposeCurrentModel = () => {',
        '    const disposeCurrentModel = () => {\n        skeletonOverlay.setModel(null);');
    output = once(output, '            currentRotationPivot = stagedPivot;',
        '            currentRotationPivot = stagedPivot;\n            skeletonOverlay.setModel(currentMesh);');
    output = once(output, '            else renderer.render(scene, camera);',
        '            else renderer.render(scene, camera);\n            skeletonOverlay.render(currentRotationPivot?.visible === true);');
    output = once(output, '        renderer.dispose();',
        '        skeletonOverlay.dispose();\n        renderer.dispose();');
    return once(output, '        setMotionPlaybackEnabled,',
        '        setSkeletonVisible: skeletonOverlay.setVisible,\n        getSkeletonState: skeletonOverlay.getState,\n        setMotionPlaybackEnabled,');
}

function addSkeletonDisplay(source) {
    let output = once(source, '    function setMotionPlaybackEnabled(enabled) {', `    let skeletonVisible = false;
    function setSkeletonVisible(enabled) {
        skeletonVisible = enabled === true;
        state.runtime?.setSkeletonVisible?.(skeletonVisible);
        return skeletonVisible;
    }

    function setMotionPlaybackEnabled(enabled) {`);
    output = once(output, '                state.runtime.setVisible(state.visible);',
        '                state.runtime.setSkeletonVisible?.(skeletonVisible);\n                state.runtime.setVisible(state.visible);');
    return once(output, '        setMotionPlaybackEnabled,',
        '        setSkeletonVisible,\n        getSkeletonState: () => state.runtime?.getSkeletonState?.() || { enabled: skeletonVisible, boneCount: 0 },\n        setMotionPlaybackEnabled,');
}

module.exports = { addSkeletonRuntime, addSkeletonDisplay };
