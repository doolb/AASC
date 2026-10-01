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
    output = once(output, '        const delayInitialMotion = frameHelper && pendingInitialMotionHelper === frameHelper;',
        '        skeletonOverlay.observePhysics(physicsEnabled ? frameHelper?.objects?.get(currentMesh)?.physics : null);\n        const delayInitialMotion = frameHelper && pendingInitialMotionHelper === frameHelper;');
    output = once(output, '        visible = nextVisible === true;',
        '        visible = nextVisible === true;\n        if (!visible) skeletonOverlay.hide();');
    output = once(output, '        renderer.dispose();',
        '        skeletonOverlay.dispose();\n        renderer.dispose();');
    return once(output, '        setMotionPlaybackEnabled,',
        '        setSkeletonVisible: skeletonOverlay.setVisible,\n        setSkeletonSize: skeletonOverlay.setSize,\n        setSkeletonNamesVisible: skeletonOverlay.setNamesVisible,\n        pickSkeleton: skeletonOverlay.pick,\n        clearSkeletonContacts: skeletonOverlay.clearContacts,\n        getSkeletonBodyFilter: skeletonOverlay.getBodyFilter,\n        getSkeletonState: skeletonOverlay.getState,\n        setMotionPlaybackEnabled,');
}

function addSkeletonDisplay(source) {
    let output = once(source, '    function setMotionPlaybackEnabled(enabled) {', `    let skeletonVisible = false;
    let skeletonSize = 1;
    let skeletonNamesVisible = false;
    function setSkeletonSize(value) {
        skeletonSize = typeof value === 'number' && Number.isFinite(value)
            ? Math.round(Math.max(0.2, Math.min(3, value)) * 10) / 10 : 1;
        state.runtime?.setSkeletonSize?.(skeletonSize);
        return skeletonSize;
    }
    function setSkeletonNamesVisible(value) {
        skeletonNamesVisible = value === true;
        state.runtime?.setSkeletonNamesVisible?.(skeletonNamesVisible);
        return skeletonNamesVisible;
    }
    function setSkeletonVisible(enabled) {
        skeletonVisible = enabled === true;
        state.runtime?.setSkeletonVisible?.(skeletonVisible);
        return skeletonVisible;
    }

    function setMotionPlaybackEnabled(enabled) {`);
    output = once(output, '                state.runtime.setVisible(state.visible);',
        '                state.runtime.setSkeletonVisible?.(skeletonVisible);\n                state.runtime.setSkeletonSize?.(skeletonSize);\n                state.runtime.setSkeletonNamesVisible?.(skeletonNamesVisible);\n                state.runtime.setVisible(state.visible);');
    output = once(output, '        if (finishTranslationDrag(event.pointerId)) {',
        '        const skeletonTapCandidate = state.rotationDrag?.pointerId === event.pointerId;\n        if (finishTranslationDrag(event.pointerId)) {');
    output = once(output, '        const pressedPoint = state.pressedPoint;', `        // 复用原轻点/拖动/多指判定；只消费同一指针的主键轻点，右键平移或游离抬起不选中。
        if (skeletonTapCandidate && state.runtime?.pickSkeleton?.(getCanvasPoint(event)) === true) {
            state.pressedPoint = null;
            releasePointerCapture(event.pointerId);
            return;
        }
        const pressedPoint = state.pressedPoint;`);
    return once(output, '        setMotionPlaybackEnabled,',
        '        setSkeletonVisible,\n        setSkeletonSize,\n        setSkeletonNamesVisible,\n        clearSkeletonContacts: () => state.runtime?.clearSkeletonContacts?.(),\n        getSkeletonState: () => state.runtime?.getSkeletonState?.() || { enabled: skeletonVisible, sizeMultiplier: skeletonSize, namesVisible: skeletonNamesVisible, selectedBoneIndex: -1, boneCount: 0 },\n        setMotionPlaybackEnabled,');
}

module.exports = { addSkeletonRuntime, addSkeletonDisplay };
