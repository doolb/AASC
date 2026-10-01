'use strict';

// 在骨骼适配之后只修改网页生成副本；唯一锚点失败时停止构建，避免漏掉释放。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`碰撞体显示适配缺少唯一锚点：${anchor}`);
    return source.replace(anchor, replacement);
}

function addRigidBodyRuntime(source, moduleUrl) {
    let output = `import { createRigidBodyOverlay } from '${moduleUrl}';\n${source}`;
    output = once(output, '    let currentMesh = null;',
        '    const rigidBodyOverlay = createRigidBodyOverlay({ THREE, renderer, camera });\n    let currentMesh = null;');
    output = once(output, '    const disposeCurrentModel = () => {',
        '    const disposeCurrentModel = () => {\n        rigidBodyOverlay.setModel(null);');
    output = once(output, '            currentRotationPivot = stagedPivot;',
        '            currentRotationPivot = stagedPivot;\n            rigidBodyOverlay.setModel(currentMesh);');
    output = once(output, '            skeletonOverlay.render(currentRotationPivot?.visible === true);',
        '            rigidBodyOverlay.setBodyFilter(skeletonOverlay.getBodyFilter());\n            rigidBodyOverlay.render(currentRotationPivot?.visible === true, physicsEnabled ? helper.current?.objects?.get(currentMesh)?.physics : null);\n            skeletonOverlay.render(currentRotationPivot?.visible === true);');
    output = once(output, '        renderer.dispose();', '        rigidBodyOverlay.dispose();\n        renderer.dispose();');
    return once(output, '        setMotionPlaybackEnabled,',
        '        setRigidBodyVisible: rigidBodyOverlay.setVisible,\n        getRigidBodyState: rigidBodyOverlay.getState,\n        setMotionPlaybackEnabled,');
}

function addRigidBodyDisplay(source) {
    let output = once(source, '    function setMotionPlaybackEnabled(enabled) {', `    let rigidBodyVisible = false;
    function setRigidBodyVisible(enabled) {
        rigidBodyVisible = enabled === true;
        state.runtime?.setRigidBodyVisible?.(rigidBodyVisible);
        return rigidBodyVisible;
    }

    function setMotionPlaybackEnabled(enabled) {`);
    output = once(output, '                state.runtime.setVisible(state.visible);',
        '                state.runtime.setRigidBodyVisible?.(rigidBodyVisible);\n                state.runtime.setVisible(state.visible);');
    return once(output, '        setMotionPlaybackEnabled,',
        '        setRigidBodyVisible,\n        getRigidBodyState: () => state.runtime?.getRigidBodyState?.() || { enabled: rigidBodyVisible, bodyCount: 0, poseMode: "none" },\n        setMotionPlaybackEnabled,');
}

module.exports = { addRigidBodyRuntime, addRigidBodyDisplay };
