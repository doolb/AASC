'use strict';

// 在骨骼适配之后只修改网页生成副本；唯一锚点失败时停止构建，避免漏掉释放。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`碰撞体显示适配缺少唯一锚点：${anchor}`);
    return source.replace(anchor, replacement);
}

function addRigidBodyRuntime(source, moduleUrl) {
    let output = `import { createRigidBodyOverlay } from '${moduleUrl}';\n${source}`;
    output = once(output, '    let currentMesh = null;', `    const rigidBodyOverlay = createRigidBodyOverlay({ THREE, renderer, camera });
    let currentMesh = null;
    // 碰撞体实体需要角色深度，AO离屏合成后补一遍深度直写；骨骼小球使用本层深度。
    // 关闭阴影自动更新，复用本帧AO场景已生成的阴影贴图，避免重复阴影渲染。
    let rigidBodyDepthMaterial = null;
    const prepareRigidBodySceneDepth = (modelVisible) => {
        if (!rigidBodyOverlay.needsSceneDepth?.(modelVisible)) return;
        if (!(pmxAoEnabled || window.MmdArTestNormalPreview === true) || !ambientOcclusion.supported) return;
        if (!rigidBodyDepthMaterial) rigidBodyDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
        const previousAutoClear = renderer.autoClear;
        const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        const previousOverride = scene.overrideMaterial;
        try {
            renderer.autoClear = false;
            renderer.shadowMap.autoUpdate = false;
            renderer.clearDepth();
            scene.overrideMaterial = rigidBodyDepthMaterial;
            renderer.render(scene, camera);
        } finally {
            scene.overrideMaterial = previousOverride;
            renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
            renderer.autoClear = previousAutoClear;
        }
    };`);
    output = once(output, '    const disposeCurrentModel = () => {',
        '    const disposeCurrentModel = () => {\n        rigidBodyOverlay.setModel(null);');
    output = once(output, '            currentRotationPivot = stagedPivot;',
        '            currentRotationPivot = stagedPivot;\n            rigidBodyOverlay.setModel(currentMesh);');
    output = once(output, '            skeletonOverlay.render(currentRotationPivot?.visible === true);',
        '            rigidBodyOverlay.setBodyFilter(skeletonOverlay.getBodyFilter());\n            prepareRigidBodySceneDepth(currentRotationPivot?.visible === true);\n            rigidBodyOverlay.render(currentRotationPivot?.visible === true, physicsEnabled ? helper.current?.objects?.get(currentMesh)?.physics : null);\n            skeletonOverlay.render(currentRotationPivot?.visible === true);');
    output = once(output, '        renderer.dispose();', '        rigidBodyOverlay.dispose();\n        rigidBodyDepthMaterial?.dispose();\n        renderer.dispose();');
    return once(output, '        setMotionPlaybackEnabled,',
        `        setRigidBodyVisible: rigidBodyOverlay.setVisible,
        setRigidBodyStyle: rigidBodyOverlay.setStyle,
        setCharacterHidden: rigidBodyOverlay.setCharacterHidden,
        getRigidBodyState: rigidBodyOverlay.getState,
        setMotionPlaybackEnabled,`);
}

function addRigidBodyDisplay(source) {
    let output = once(source, '    function setMotionPlaybackEnabled(enabled) {', `    let rigidBodyVisible = false;
    let rigidBodyStyle = 'solid';
    let characterHidden = false;
    function setRigidBodyVisible(enabled) {
        rigidBodyVisible = enabled === true;
        state.runtime?.setRigidBodyVisible?.(rigidBodyVisible);
        return rigidBodyVisible;
    }

    function setRigidBodyStyle(style) {
        rigidBodyStyle = style === 'wireframe' ? 'wireframe' : 'solid';
        state.runtime?.setRigidBodyStyle?.(rigidBodyStyle);
        return rigidBodyStyle;
    }

    function setCharacterHidden(hidden) {
        characterHidden = hidden === true;
        state.runtime?.setCharacterHidden?.(characterHidden);
        return characterHidden;
    }

    function setMotionPlaybackEnabled(enabled) {`);
    output = once(output, '                state.runtime.setVisible(state.visible);',
        '                state.runtime.setRigidBodyVisible?.(rigidBodyVisible);\n                state.runtime.setRigidBodyStyle?.(rigidBodyStyle);\n                state.runtime.setCharacterHidden?.(characterHidden);\n                state.runtime.setVisible(state.visible);');
    return once(output, '        setMotionPlaybackEnabled,',
        `        setRigidBodyVisible,
        setRigidBodyStyle,
        setCharacterHidden,
        getRigidBodyState: () => state.runtime?.getRigidBodyState?.() || { enabled: rigidBodyVisible, bodyCount: 0, poseMode: "none" },
        setMotionPlaybackEnabled,`);
}

module.exports = { addRigidBodyRuntime, addRigidBodyDisplay };
