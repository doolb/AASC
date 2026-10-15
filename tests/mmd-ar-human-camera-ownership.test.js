'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
test('零时长单帧相机VMD仍拥有相机，匹配应阻止，暂停/清除后释放',async()=>{
    const {exposeCameraOwnership}=require('../3rd/mmd-ar-test/web-human-camera-build');
    const source=fs.readFileSync(path.resolve(__dirname,'../src/apps/web-mediacenter/ui/public/js/mmd-camera-motion.mjs'),'utf8');
    const {createPmxCameraMotion}=await import('data:text/javascript;base64,'+Buffer.from(exposeCameraOwnership(source)).toString('base64'));
    const T=await import('three'),camera=new T.PerspectiveCamera(28,1,.01,100),objects=new Map();
    class Helper {
        constructor(){this.objects=objects;}
        add(value){this.camera=value;objects.set(value,{mixer:{_actions:[{time:0,getClip:()=>({duration:0})}]}});}
        remove(value){objects.delete(value);}
        update(){camera.position.x=42;}
    }
    const value=createPmxCameraMotion({THREE:T,camera,arCameraState:{active:false},PMX_CAMERA_NEAR:.01,MMDAnimationHelper:Helper,
        fitCameraToModel(){},getModelBounds:()=>new T.Box3(new T.Vector3(-1,-1,-1),new T.Vector3(1,1,1)),
        validateMotionResource(){},configureCameraMotionLoader(){},
        waitForManagedLoad:register=>new Promise((resolve,reject)=>register({
            loadVMD(url,callback){callback({cameras:[{frameNum:0,distance:4,position:[0,0,0]}]});},
            animationBuilder:{buildCameraAnimation:()=>new T.AnimationClip('still',0,[])}
        },resolve,reject,()=>{})),onProgress(){},onStatus(){},startRendering(){},currentMesh:{},currentProfile:{}});
    assert.equal(value.isImageCameraOwned(),false);
    await value.loadCameraMotion({motionUrl:'single-frame.vmd',motionResourceId:'single-frame'});value.setCameraMotionPlaybackEnabled(true);
    assert.equal(value.getCameraMotionProgress(),null,'单帧进度应保持原有null契约');
    assert.equal(value.isImageCameraOwned(),true,'零时长片段仍须阻止图片相机匹配');
    value.advanceCameraMotion(1/60);assert.equal(camera.position.x,42);
    value.setCameraMotionPlaybackEnabled(false);assert.equal(value.isImageCameraOwned(),false);
    value.setCameraMotionPlaybackEnabled(true);value.clearCameraMotion();assert.equal(value.isImageCameraOwned(),false);
});
