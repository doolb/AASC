import { Quaternion, Vector3 } from 'three';

// 相机匹配写入原环绕状态，避免下一帧弹回，也避免永久覆盖造成手动旋转失效。
export function createImageCameraControl({camera,readControl,writeControl,ownership,wake,maxPitch=Math.PI/4,rotation=()=>0}) {
    let baseline=null;
    function read(token) {
        if(baseline && baseline.token!==token) baseline=null;
        const reason=ownership() || '', state=readControl();
        return {available:!reason,reason,revision:JSON.stringify({state,reason,rotation:rotation()}),maxPitch,canRestore:!!baseline};
    }
    function apply(view,revision,token) {
        const current=read(token);
        if(!current.available) throw new Error(current.reason);
        if(revision!==current.revision) throw new Error('相机视角已变化，请重新匹配');
        if(![...view.position,...view.target,...view.up,view.distance,view.yaw,view.pitch,view.fov,view.cameraZoom].every(Number.isFinite)
            ||view.distance<=0||Math.abs(view.pitch)>maxPitch+.0001) throw new Error('相机匹配结果超出可用范围');
        const state={...readControl(),target:[...view.target],distance:view.distance,zoom:1,yaw:view.yaw,pitch:view.pitch,
            targetYaw:view.yaw,targetPitch:view.pitch,up:[...view.up],fov:view.fov,cameraZoom:view.cameraZoom};
        // 舞台旋转由屏幕映射完成；相机绕视线反向补偿，参考图仍保持原方向。
        const angle=rotation()*Math.PI/180;
        if(angle) state.up=new Vector3().fromArray(view.up).applyQuaternion(new Quaternion().setFromAxisAngle(
            new Vector3().fromArray(view.target).sub(new Vector3().fromArray(view.position)).normalize().negate(),-angle)).toArray();
        const saved=readControl();
        try {writeControl(state);} catch(error) {writeControl(saved);throw error;}
        if(!baseline) baseline={token,state:saved};
        camera.updateMatrixWorld(true); wake(); return read(token);
    }
    function restore(token) {
        const current=read(token); if(!current.available) throw new Error(current.reason);
        if(!baseline) throw new Error('没有可恢复的匹配前视角');
        writeControl(baseline.state); baseline=null; wake(); return read(token);
    }
    return {read,apply,restore};
}
