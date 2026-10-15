'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

test('实际骨架读取真实PMX世界位置，姿态改变后投影更新且不改绑定骨长', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const T = await import('three');
    const { readActualPose, projectPose, fitPoseAlignment } = await import('../3rd/mmd-ar-test/web-human-pose-projection.mjs');
    const { model } = await makeModel(), camera = new T.PerspectiveCamera(28, 1.6, .01, 100);
    camera.position.set(0, 10, 65); camera.lookAt(0, 10, 0); camera.updateMatrixWorld(true);
    const before = readActualPose(model, camera), wrist = before.points.find(p => p.key === 'leftWrist');
    assert.ok(before.points.length >= 16); assert.deepEqual(wrist.world, model.bindings['bones:leftWrist'].bone.getWorldPosition(new T.Vector3()).toArray());
    const projected = projectPose(before.points, before.view), alignment = fitPoseAlignment(projected, 400, 300);
    assert.ok(alignment.scale > 0 && [alignment.x, alignment.y].every(Number.isFinite));
    model.bindings['bones:leftElbow'].bone.rotation.z += .4;
    const after = readActualPose(model, camera);
    assert.notDeepEqual(after.points.find(p => p.key === 'leftWrist').world, wrist.world);
    assert.notDeepEqual(projectPose(after.points, before.view), projected);
    assert.deepEqual(before.view, after.view, '实际姿态更新不应改变固定相机');
});

test('投影保持源宽高比、舞台旋转和裁剪规则，不因图片比例拉伸', async () => {
    const T = await import('three');
    const { readActualPose, projectPose, fitPoseAlignment } = await import('../3rd/mmd-ar-test/web-human-pose-projection.mjs');
    const camera = new T.PerspectiveCamera(40, 2, .1, 100); camera.position.z = 5; camera.updateMatrixWorld(true);
    const model = { token: 'x', mesh: new T.Group(), bindings: {} };
    const { view } = readActualPose(model, camera);
    const points = [{ key: 'x', world: [1, 0, 0] }, { key: 'y', world: [0, 1, 0] }, { key: 'behind', world: [0, 0, 10] }];
    const a = projectPose(points, view);
    assert.ok(Math.abs(a[0].x + a[1].y) < 1e-10, '等距离横纵轴不等比'); assert.equal(a[2].visible, false);
    const b = projectPose(points, { ...view, rotation: 90 });
    assert.ok(Math.abs(b[0].y - a[0].x) < 1e-10);
    assert.ok(Math.abs(b[0].x + a[0].y) < 1e-10);
    assert.throws(() => fitPoseAlignment([], 400, 300), /骨架/u);
    const ortho=new T.OrthographicCamera(-2,2,1,-1,.1,100);ortho.position.z=5;ortho.updateMatrixWorld(true);
    const orthographic=projectPose(points,readActualPose(model,ortho).view);
    assert.ok(Math.abs(orthographic[0].x+orthographic[1].y)<1e-10,'正交相机源比例未保持');
});
