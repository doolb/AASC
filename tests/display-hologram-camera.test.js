'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');

for (const type of ['pmx', 'vrm']) {
  test(`${type.toUpperCase()} 实际相机代码沿画面坐标平移并保持朝向，关闭后恢复`, () => {
    const file = path.resolve(__dirname, `../src/apps/web-mediacenter/ui/public/js/display-${type}-runtime.js`);
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('    const cameraViewState = {');
    const end = source.indexOf('    const setCameraViewRotation', start);
    assert.ok(start >= 0 && end > start);
    // 在真实 Three.js 相机上运行两个运行时的实际相机计算，而不依赖图形硬件。
    const create = new Function('THREE', `
      const TARGET_MODEL_HEIGHT = 1.75, ROTATION_SETTLE_EPSILON = 0.0005, ROTATION_EASING_PER_SECOND = 1 / 0.14;
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      const cameraTarget = new THREE.Vector3(0, 0.8, 0);
      let cameraZoomFactor = 1, cameraDistance = 4.9, initialCameraDistance = 4.9;
      const syncCameraClip = () => {}, startRendering = () => {};
      ${source.slice(start, end)}
      return { camera, cameraTarget, cameraViewState, holographicTilt, setHolographicTilt, updateCameraView };
    `);
    const scene = create(THREE);
    // 实际公开入口也要纳入验证，避免控件和运行时之间再次截断角色角度。
    const wrapper = fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/display-mmd.js'), 'utf8');
    const wrapperStart = wrapper.indexOf('    function setHolographicTilt(value = {}) {');
    const wrapperEnd = wrapper.indexOf('    function setCameraViewRotation', wrapperStart);
    assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart);
    const state = { holographicTilt: { modelYaw: 0, modelPitch: 0, cameraX: 0, cameraY: 0 }, runtime: scene };
    const publish = new Function('state', `${wrapper.slice(wrapperStart, wrapperEnd)}; return setHolographicTilt;`)(state);
    publish({ modelYaw: 0.25, modelPitch: -0.4, cameraX: 0.4 });
    assert.equal(scene.holographicTilt.modelYaw, 0.25);
    assert.equal(scene.holographicTilt.modelPitch, -0.28);
    assert.equal(scene.holographicTilt.cameraX, 0.14);
    scene.setHolographicTilt({ modelYaw: 0.2, modelPitch: -0.4, cameraX: 0.4 });
    assert.equal(scene.holographicTilt.modelYaw, 0.2);
    assert.equal(scene.holographicTilt.modelPitch, -0.28);
    assert.equal(scene.holographicTilt.cameraX, 0.14);
    scene.setHolographicTilt({});
    scene.cameraViewState.targetYaw = scene.cameraViewState.currentYaw = 0.6;
    scene.cameraViewState.targetPitch = scene.cameraViewState.currentPitch = 0.2;
    scene.updateCameraView(1);
    const position = scene.camera.position.clone();
    const orientation = scene.camera.quaternion.clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    scene.setHolographicTilt({ cameraX: 4, cameraY: -4 });
    for (let i = 0; i < 100; i++) scene.updateCameraView(0.016);
    const displacement = scene.camera.position.clone().sub(position);
    assert.ok(Math.abs(displacement.dot(right) - 0.14 * 1.75 * 0.4) < 0.001);
    assert.ok(Math.abs(displacement.dot(up) + 0.14 * 1.75 * 0.4) < 0.001);
    assert.ok(orientation.angleTo(scene.camera.quaternion) < 1e-6);
    scene.setHolographicTilt({});
    for (let i = 0; i < 100; i++) scene.updateCameraView(0.016);
    assert.ok(scene.camera.position.distanceTo(position) < 0.001);
    assert.ok(orientation.angleTo(scene.camera.quaternion) < 1e-6);
  });
}
