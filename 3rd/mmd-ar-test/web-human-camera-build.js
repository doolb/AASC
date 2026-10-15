'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {hashFile}=require('./apk-artifact');
const once=(source,anchor,value)=>{
    if(source.split(anchor).length!==2) throw new Error('图片相机桥接缺少唯一锚点：'+anchor);
    return source.replace(anchor,value);
};
// 只改独立网页生成副本，直接复用运行时闭包中的普通视角状态，不扫描场景或污染全局。
function injectImageCameraControl(source,version) {
    let result="import { createImageCameraControl } from './web-human-camera-control.mjs?v="+version+"';\n"+source;
    result=once(result,'    const editorCameraControl = { view: null };',`    const editorCameraControl = { view: null };
    const imageCameraControl = createImageCameraControl({ camera, maxPitch: MAX_CAMERA_PITCH_RADIANS,
        rotation: () => window.DisplayStage?.getRotationGeometry?.()?.rotation || 0,
        ownership: () => arCameraState.active ? 'AR正在控制相机，请先退出定位'
            : editorCameraControl.view ? '编辑器正在控制相机，请先恢复预览视角'
            : cameraMotion.isImageCameraOwned() ? '请先暂停相机动作，再匹配图片视角' : '',
        readControl: () => ({ target: cameraTarget.toArray(), distance: cameraDistance, zoom: cameraZoomFactor,
            yaw: cameraViewState.currentYaw, pitch: cameraViewState.currentPitch,
            targetYaw: cameraViewState.targetYaw, targetPitch: cameraViewState.targetPitch,
            up: camera.up.toArray(), fov: camera.fov, cameraZoom: camera.zoom }),
        writeControl: value => {
            cameraTarget.fromArray(value.target); cameraDistance = value.distance; cameraZoomFactor = value.zoom;
            Object.assign(cameraViewState, { currentYaw: value.yaw, currentPitch: value.pitch,
                targetYaw: value.targetYaw, targetPitch: value.targetPitch });
            camera.up.fromArray(value.up); camera.fov = value.fov; camera.zoom = value.cameraZoom;
            camera.updateProjectionMatrix(); applyCameraView(); camera.updateMatrixWorld(true);
        }, wake: () => startRendering() });`);
    result=once(result,'getCamera: () => camera, getScene: () => scene, canvas, manualExpressions',
        'getCamera: () => camera, getScene: () => scene, getImageCameraControl: () => imageCameraControl, canvas, manualExpressions');
    return result;
}
// 播放进度会把零时长片段返回为空，必须直接查询相机动作的有效控制状态。
function exposeCameraOwnership(source) {
    return once(source,'    return Object.freeze({ advanceCameraMotion, loadCameraMotion, setCameraMotionPlaybackEnabled,',
        '    return Object.freeze({ isImageCameraOwned: () => cameraMotionEnabled && cameraMotionState?.hasClip === true,\n'
        + '        advanceCameraMotion, loadCameraMotion, setCameraMotionPlaybackEnabled,');
}
async function stageImageCameraControl(folder,source,version) {
    const file=path.join(folder,'mmd-camera-motion.mjs');
    await fs.writeFile(file,exposeCameraOwnership(await fs.readFile(file,'utf8')));
    const hash=(await hashFile(file)).sha256.slice(0,12);
    const imports=source.match(/\.\/mmd-camera-motion\.mjs(?:\?v=[a-f0-9]+)?/gu);
    if(imports?.length!==1) throw new Error('图片相机桥接缺少唯一相机动作导入');
    return injectImageCameraControl(source.replace(imports[0],'./mmd-camera-motion.mjs?v='+hash),version);
}
module.exports={injectImageCameraControl,exposeCameraOwnership,stageImageCameraControl};
