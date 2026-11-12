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
    const state = { holographicTilt: { modelYaw: 0, modelPitch: 0, modelX: 0, modelY: 0, cameraX: 0, cameraY: 0 }, runtime: scene };
    const publish = new Function('state', `${wrapper.slice(wrapperStart, wrapperEnd)}; return setHolographicTilt;`)(state);
    publish({ modelYaw: 0.25, modelPitch: -0.4, modelX: 0.2, modelY: -0.1, cameraX: 0.4 });
    assert.equal(scene.holographicTilt.modelX, 0.14);
    assert.equal(scene.holographicTilt.modelY, -0.1);
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
    assert.ok(Math.abs(displacement.dot(right) - 0.14 * 1.75 * 4) < 0.001);
    assert.ok(Math.abs(displacement.dot(up) + 0.14 * 1.75 * 4) < 0.001);
    assert.ok(orientation.angleTo(scene.camera.quaternion) < 1e-6);
    scene.setHolographicTilt({});
    for (let i = 0; i < 100; i++) scene.updateCameraView(0.016);
    assert.ok(scene.camera.position.distanceTo(position) < 0.001);
    assert.ok(orientation.angleTo(scene.camera.quaternion) < 1e-6);
  });
}

test('壁纸内置自测检查真实加速度资源并识别缺失文件', async () => {
  const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
  const source = fs.readFileSync(path.join(root, 'js/self-test.js'), 'utf8');
  const id = source.indexOf("id: 'wallpaper_controls_structure'");
  const start = source.lastIndexOf('        {', id);
  const end = source.indexOf('\n        },\n        {', id);
  assert.ok(start >= 0 && end > start);
  const definition = source.slice(start, end + '\n        }'.length);
  let missing = false;
  const fetch = async url => {
    if (missing && url === '/js/display-wallpaper-motion.js') return { ok: false };
    return { ok: true, text: async () => fs.readFileSync(path.join(root, url.slice(1)), 'utf8') };
  };
  const check = new Function('fetch', `return (${definition});`)(fetch);
  assert.equal((await check.run()).success, true);
  missing = true;
  assert.equal((await check.run()).success, false);
});

test('镜头停止运动后按更快的回中系数衰减', () => {
  const file = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/display-wallpaper-controls.js');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('    function motionTick(now) {');
  const end = source.indexOf('    function onMotionSample(event)', start);
  assert.ok(start >= 0 && end > start);
  const state = { cameraX: 0.1, cameraY: -0.1 };
  const motion = { ax: 0, ay: 0, vx: 0, vy: 0, sampledAt: 0 };
  const tick = new Function('root', 'hologram', 'motion', `
    let motionFrame = null, motionListening = true, lastMotionFrame = 0;
    const hologramMove = { checked: false };
    const publishHologram = () => {};
    ${source.slice(start, end)}
    return motionTick;
  `)({ requestAnimationFrame: () => 1 }, state, motion);
  tick(50);
  assert.ok(Math.abs(state.cameraX - 0.1 * Math.exp(-15 * 0.05)) < 1e-12);
  assert.ok(Math.abs(state.cameraY + 0.1 * Math.exp(-15 * 0.05)) < 1e-12);
});


test('角色平移按相机方向叠加，不覆盖手动及 AR 位置，回中不累积', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/display-mmd-ar-pose.js'), 'utf8');
  const start = source.indexOf('export function createArFootAnchor');
  assert.ok(start >= 0);
  const create = new Function('THREE', `${source.slice(start).replace('export function', 'function')}; return createArFootAnchor;`)(THREE);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(2, 2, 5); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  const scene = new THREE.Scene();
  const root = new THREE.Group(); root.position.set(1, 2, 0);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1))); scene.add(root);
  const anchor = create({ camera, getModelRoot: () => root, getViewport: () => ({ width: 500, height: 800 }), startRendering: () => {} });
  assert.equal(anchor.translateBy(new THREE.Vector3(0.2, 0.1, 0)), true);
  const manual = root.position.clone();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  assert.equal(anchor.setHolographicOffset(0.5, -0.25), true);
  assert.ok(root.position.clone().sub(manual).distanceTo(right.clone().multiplyScalar(0.5).addScaledVector(up, -0.25)) < 1e-9);
  assert.equal(anchor.setHolographicOffset(0.5, -0.25), false);
  assert.equal(anchor.translateBy(new THREE.Vector3(0.1, 0, 0)), true);
  assert.equal(anchor.setHolographicOffset(0, 0), true);
  assert.ok(root.position.distanceTo(manual.clone().add(new THREE.Vector3(0.1, 0, 0))) < 1e-9);
  assert.equal(anchor.setPose({ x: 0.4, y: 0.7, scale: 1 }), true);
  const positioned = root.position.clone();
  anchor.setHolographicOffset(-0.4, 0.2); anchor.setHolographicOffset(0, 0);
  assert.ok(root.position.distanceTo(positioned) < 1e-9);
  anchor.reset();
  assert.ok(root.position.distanceTo(new THREE.Vector3(1, 2, 0)) < 1e-9);
});
