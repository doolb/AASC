'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

async function fixture() {
    const T = await import('three');
    const keys = ['leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];
    const values = [[-.4,.8,.1],[.4,.8,0],[-.7,.4,.3],[.7,.3,-.2],[-.6,.1,.6],[.8,.1,.3],[-.2,0,0],[.2,0,.1],[-.25,-.5,.3],[.3,-.5,-.2],[-.25,-1,.1],[.35,-1,.2]];
    const indices = [11,12,13,14,15,16,23,24,25,26,27,28];
    const points = values.map((world, i) => ({ key: keys[i], world, landmark: indices[i] }));
    const camera = new T.PerspectiveCamera(35, 1.4, .01, 100);
    camera.position.set(2.2, 1.1, 5); camera.lookAt(.1, -.05, .1); camera.rotateZ(.18); camera.updateMatrixWorld(true);
    const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, world: [0,0,0], visibility: 0, presence: 0 }));
    points.forEach(p => { const n = new T.Vector3().fromArray(p.world).project(camera);
        landmarks[p.landmark] = { x: (n.x+1)/2, y: (1-n.y)/2, world: [0,0,0], visibility: 1, presence: 1 }; });
    return { T, points, camera, pose: { landmarks, confidence: 1 }, snapshot: { token: 'model-a', points,
        view: { fov: 35, zoom: 1, aspect: 1.4, viewMatrix: new T.Matrix4().makeTranslation(0,0,-6).toArray() } } };
}

test('固定FOV从Three已知投影恢复相机朝向与取景，不修改输入', async () => {
    const { fitImageCamera } = await import('../3rd/mmd-ar-test/web-human-pose-camera.mjs');
    const f = await fixture(), saved = JSON.stringify(f.snapshot);
    const result = await fitImageCamera(f.snapshot, f.pose, { aspect: 1.4 });
    assert.ok(result.error < .002, String(result.error)); assert.ok(result.inliers >= 11);
    assert.ok(new f.T.Quaternion().fromArray(result.view.quaternion).angleTo(f.camera.quaternion) < .025);
    assert.ok(new f.T.Vector3().fromArray(result.view.position).distanceTo(f.camera.position) < .06);
    assert.equal(JSON.stringify(f.snapshot), saved);
});

test('相机拟合容忍单个离群点，但拒绝缺点、共线、严重姿态冲突并支持取消', async () => {
    const { fitImageCamera } = await import('../3rd/mmd-ar-test/web-human-pose-camera.mjs');
    const f = await fixture(); f.pose.landmarks[15].x += .18;
    const result = await fitImageCamera(f.snapshot, f.pose, { aspect: 1.4 });
    assert.ok(result.inliers >= 10 && result.error < .025);
    await assert.rejects(fitImageCamera(f.snapshot, f.pose, { aspect: 1.4, isCurrent: () => false }), { name: 'AbortError' });
    const short = { ...f.snapshot, points: f.points.slice(0, 5) };
    await assert.rejects(fitImageCamera(short, f.pose, { aspect: 1.4 }), /关键点/u);
    const line = { ...f.snapshot, points: f.points.map((p,i) => ({ ...p, world: [0,i*.1,0] })) };
    await assert.rejects(fitImageCamera(line, f.pose, { aspect: 1.4 }), /退化/u);
    const tiltedLine = { ...f.snapshot, points: f.points.map((p,i) => ({ ...p, world: [i*.1,i*.1,i*.1] })) };
    await assert.rejects(fitImageCamera(tiltedLine, f.pose, { aspect: 1.4 }), /退化/u);
    f.points.forEach((p,i) => { f.pose.landmarks[p.landmark].x = (i%3)*.35+.1; f.pose.landmarks[p.landmark].y = ((i*7)%5)*.18+.1; });
    await assert.rejects(fitImageCamera(f.snapshot, f.pose, { aspect: 1.4 }), /匹配|误差/u);
});

test('背侧相机与竖图仍恢复正确朝向，支持大于90度的旋转',async()=>{
    const {fitImageCamera}=await import('../3rd/mmd-ar-test/web-human-pose-camera.mjs'),f=await fixture();
    f.camera.aspect=.7;f.camera.position.set(2,.7,-5);f.camera.lookAt(.1,-.05,.1);f.camera.rotateZ(-.2);f.camera.updateProjectionMatrix();f.camera.updateMatrixWorld(true);
    for(const p of f.points){const n=new f.T.Vector3().fromArray(p.world).project(f.camera);f.pose.landmarks[p.landmark].x=(n.x+1)/2;f.pose.landmarks[p.landmark].y=(1-n.y)/2;}
    const result=await fitImageCamera(f.snapshot,f.pose,{aspect:.7});
    assert.ok(result.error<.002);
    assert.ok(new f.T.Quaternion().fromArray(result.view.quaternion).angleTo(f.camera.quaternion)<.025);
});

test('相机桥接同步普通控制状态，后续手动更新不弹回，恢复首个基线且拒绝接管', async () => {
    const T = await import('three');
    const { createImageCameraControl } = await import('../3rd/mmd-ar-test/web-human-camera-control.mjs');
    const f = await fixture(), camera = f.camera.clone();
    let state = { target: [0,0,0], distance: 6, zoom: 1, yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, up: [0,1,0], fov: 35, cameraZoom: 1 }, owner = '';
    const applyOrdinary = () => {
        const d = state.distance/state.zoom, c = Math.cos(state.pitch);
        camera.position.set(state.target[0]+Math.sin(state.yaw)*c*d,state.target[1]+Math.sin(state.pitch)*d,state.target[2]+Math.cos(state.yaw)*c*d);
        camera.up.fromArray(state.up); camera.fov = state.fov; camera.lookAt(new T.Vector3().fromArray(state.target)); camera.updateMatrixWorld(true);
    };
    const control = createImageCameraControl({ camera, readControl: () => structuredClone(state),
        writeControl: value => { state = structuredClone(value); applyOrdinary(); }, ownership: () => owner, wake() {}, maxPitch: Math.PI/4 });
    const before = structuredClone(state), revision = control.read('a').revision;
    const { fitImageCamera } = await import('../3rd/mmd-ar-test/web-human-pose-camera.mjs');
    const fit = await fitImageCamera(f.snapshot, f.pose, { aspect: 1.4 });
    control.apply(fit.view, revision, 'a'); applyOrdinary();
    assert.ok(camera.position.distanceTo(f.camera.position) < .06);
    const matched = camera.position.toArray(); state.yaw += .1; applyOrdinary(); assert.notDeepEqual(camera.position.toArray(), matched);
    control.restore('a'); assert.deepEqual(state, before);
    owner = 'AR正在控制相机'; assert.throws(() => control.apply(fit.view, control.read('a').revision, 'a'), /AR/u);
    owner = ''; const old = control.read('a').revision; state.zoom = 2;
    assert.throws(() => control.apply(fit.view, old, 'a'), /视角/u);
    control.apply(fit.view,control.read('a').revision,'a');
    assert.throws(()=>control.restore('different-model'),/恢复/u,'换模型后不应恢复旧模型视角');
});
