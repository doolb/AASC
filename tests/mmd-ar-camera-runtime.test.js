'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));

test('平放定位图以锚点逆矩阵驱动 PMX 相机，丢失和停止恢复原状态', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'index.html')),
  timeout: 90000,
}, async () => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/mnt/mmd-ar/')) return void response.writeHead(404).end();
    const relative = decodeURIComponent(pathname.slice('/mnt/mmd-ar/'.length)) || 'index.html';
    const absolute = path.resolve(WEB_ROOT, relative);
    if (!absolute.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()) return void response.writeHead(404).end();
    response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
      : /\.html$/u.test(absolute) ? 'text/html'
        : /\.png$/u.test(absolute) ? 'image/png' : 'application/octet-stream');
    fs.createReadStream(absolute).pipe(response);
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmd?.getState?.().modelReady === true, { timeout: 40000 });
    const state = await page.evaluate(() => {
      const mmd = window.DisplayMmd;
      mmd.setArCameraSettings({
        translationDeadZonePercent: 0,
        rotationDeadZoneDegrees: 0,
        smoothingMs: 0,
        distancePercent: 100
      });
      const before = mmd.getArCameraState();
      const THREE = window.AFRAME.THREE;
      const projectionMatrix = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100)
        .projectionMatrix.toArray();
      const apply = (x) => mmd.setArCameraPose({
        anchorMatrix: new THREE.Matrix4().makeTranslation(x, 0, -3).toArray(),
        projectionMatrix
      });
      const firstApplied = apply(0);
      const first = mmd.getArCameraState();
      const secondApplied = apply(0.4);
      const second = mmd.getArCameraState();
      mmd.suspendArCameraPose();
      const lost = mmd.getArCameraState();
      mmd.resetArCameraPose();
      const restored = mmd.getArCameraState();
      return { before, firstApplied, first, secondApplied, second, lost, restored };
    });
    assert.equal(state.before.active, false);
    assert.equal(state.firstApplied, true);
    assert.equal(state.first.active, true);
    assert.equal(state.first.modelVisible, true);
    assert.deepEqual(state.first.modelPosition, state.before.modelPosition, '进入定位不得移动模型根节点');
    assert.deepEqual(state.first.modelScale, state.before.modelScale, '进入定位不得缩放模型根节点');
    assert.ok(Math.abs(state.first.modelFootY - state.before.modelFootY) < 0.01, '模型脚底原有世界位置应保持不变');
    assert.ok(Math.abs(state.first.cameraPosition[1] - state.before.modelFootY - 3 * state.first.targetWidth) < 0.01,
      '相机应按目标世界宽度位于平放定位图上方');
    assert.equal(state.secondApplied, true);
    assert.ok(Math.abs(state.second.cameraPosition[0] - state.first.cameraPosition[0]) > 0.3 * state.first.targetWidth,
      '目标相对相机横移时，世界相机位置应反向移动');
    assert.deepEqual(state.second.modelPosition, state.before.modelPosition);
    assert.deepEqual(state.second.modelScale, state.before.modelScale);
    assert.equal(state.lost.modelVisible, true, '失锁后模型应保持显示');
    assert.deepEqual(state.lost.cameraPosition, state.second.cameraPosition, '失锁后相机应停在最后视角');
    assert.deepEqual(state.lost.modelPosition, state.before.modelPosition);
    assert.equal(state.restored.active, false);
    assert.equal(state.restored.modelVisible, state.before.modelVisible);
    assert.deepEqual(state.restored.modelPosition, state.before.modelPosition);
    assert.deepEqual(state.restored.modelScale, state.before.modelScale);
    const tuning = await page.evaluate(async () => {
      const mmd = window.DisplayMmd;
      const THREE = window.AFRAME.THREE;
      const projectionMatrix = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100)
        .projectionMatrix.toArray();
      const apply = (matrix) => mmd.setArCameraPose({ anchorMatrix: matrix.toArray(), projectionMatrix });
      const anchor = (x, degrees = 0) => new THREE.Matrix4()
        .makeRotationY(THREE.MathUtils.degToRad(degrees)).setPosition(x, 0, -3);
      mmd.setArCameraSettings({ translationDeadZonePercent: 0, rotationDeadZoneDegrees: 0,
        smoothingMs: 0, distancePercent: 100 });
      apply(anchor(0.4));
      const originalDistance = mmd.getArCameraState();
      mmd.setArCameraSettings({ distancePercent: 50 });
      const nearer = mmd.getArCameraState();
      const markerCenter = new THREE.Vector3(0.4, 0, -3)
        .applyMatrix4(new THREE.Matrix4().fromArray(projectionMatrix)).toArray();
      const projectModelFoot = (state) => {
        const camera = new THREE.PerspectiveCamera();
        camera.position.fromArray(state.cameraPosition);
        camera.quaternion.fromArray(state.cameraQuaternion);
        camera.projectionMatrix.fromArray(projectionMatrix);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        camera.updateMatrixWorld(true);
        return new THREE.Vector3(...state.targetPosition).project(camera).toArray();
      };
      const footAtOriginalDistance = projectModelFoot(originalDistance);
      const footAtNearerDistance = projectModelFoot(nearer);
      mmd.resetArCameraPose();

      mmd.setArCameraSettings({ translationDeadZonePercent: 1, rotationDeadZoneDegrees: 1,
        smoothingMs: 0, distancePercent: 100 });
      apply(anchor(0));
      const stable = mmd.getArCameraState();
      apply(anchor(0.005, 0.2));
      const jitter = mmd.getArCameraState();
      mmd.setArCameraSettings({ distancePercent: 50 });
      const nearStable = mmd.getArCameraState();
      apply(anchor(0.012));
      const nearMoved = mmd.getArCameraState();
      apply(anchor(0.4, 5));
      const moved = mmd.getArCameraState();
      mmd.resetArCameraPose();

      mmd.setArCameraSettings({ translationDeadZonePercent: 0, rotationDeadZoneDegrees: 0,
        smoothingMs: 300, distancePercent: 100 });
      apply(anchor(0));
      const smoothStart = mmd.getArCameraState();
      apply(anchor(0.5));
      const smoothImmediate = mmd.getArCameraState();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const smoothNext = mmd.getArCameraState();
      mmd.suspendArCameraPose();
      const smoothFrozen = mmd.getArCameraState();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const smoothAfterLoss = mmd.getArCameraState();
      apply(anchor(0.8));
      const refoundImmediate = mmd.getArCameraState();
      const refoundSyncState = mmd.getArCameraSyncState();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const refoundFollowing = mmd.getArCameraState();
      mmd.resetArCameraPose();
      return { originalDistance, nearer, markerCenter, footAtOriginalDistance, footAtNearerDistance,
        stable, jitter, nearStable, nearMoved, moved, smoothStart, smoothImmediate,
        smoothNext, smoothFrozen, smoothAfterLoss, refoundImmediate, refoundSyncState, refoundFollowing };
    });
    const target = tuning.originalDistance.targetPosition;
    for (let axis = 0; axis < 3; axis += 1) {
      const oldOffset = tuning.originalDistance.cameraPosition[axis] - target[axis];
      const newOffset = tuning.nearer.cameraPosition[axis] - target[axis];
      assert.ok(Math.abs(newOffset - oldOffset * 0.5) < 0.01, '距离应沿相机到定位图中心的完整连线缩短');
    }
    assert.deepEqual(tuning.nearer.cameraQuaternion, tuning.originalDistance.cameraQuaternion);
    assert.deepEqual(tuning.nearer.modelPosition, tuning.originalDistance.modelPosition);
    for (const foot of [tuning.footAtOriginalDistance, tuning.footAtNearerDistance]) {
      assert.ok(Math.hypot(foot[0] - tuning.markerCenter[0], foot[1] - tuning.markerCenter[1]) < 1e-5,
        '静止时 PMX 脚底中心应投影到 A-Frame 定位图中心');
    }
    assert.deepEqual(tuning.jitter.cameraPosition, tuning.stable.cameraPosition, '平移死区内不抖动');
    assert.deepEqual(tuning.jitter.cameraQuaternion, tuning.stable.cameraQuaternion, '旋转死区内不抖动');
    assert.ok(Math.abs(tuning.nearMoved.cameraPosition[0] - tuning.nearStable.cameraPosition[0]) > 0,
      '相机拉近后仍须根据定位图本身越过 1% 死区判断，不能按缩小后的相机位移拒绝');
    assert.notDeepEqual(tuning.moved.cameraPosition, tuning.stable.cameraPosition, '真实位移应继续跟随');
    assert.notDeepEqual(tuning.moved.cameraQuaternion, tuning.stable.cameraQuaternion, '真实转动应继续跟随');
    assert.deepEqual(tuning.smoothImmediate.cameraPosition, tuning.smoothStart.cameraPosition,
      '缓动设置不应在目标姿态事件中瞬移');
    const smoothDistance = Math.abs(tuning.smoothNext.cameraPosition[0] - tuning.smoothStart.cameraPosition[0]);
    const targetDistance = Math.abs(tuning.smoothNext.acceptedPosition[0] - tuning.smoothStart.cameraPosition[0]);
    assert.ok(smoothDistance > 0 && smoothDistance < targetDistance, '逐帧缓动应在起点和目标之间');
    assert.equal(tuning.smoothFrozen.trackingLost, true);
    assert.deepEqual(tuning.smoothAfterLoss.cameraPosition, tuning.smoothFrozen.cameraPosition,
      '失锁时应立即冻结尚未完成的缓动');
    assert.equal(tuning.refoundImmediate.trackingLost, false, '有效锚点位姿应解除失锁冻结');
    assert.deepEqual(tuning.refoundSyncState, { active: true, trackingLost: false },
      '逐帧同步检查只需要轻量 AR 相机状态');
    assert.notDeepEqual(tuning.refoundFollowing.cameraPosition, tuning.smoothFrozen.cameraPosition,
      '重新找到目标后相机应从冻结位置继续跟随');
    const planeMode = await page.evaluate(() => {
      const mmd = window.DisplayMmd;
      const THREE = window.AFRAME.THREE;
      const aspect = 0.6;
      const projectionMatrix = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100)
        .projectionMatrix.toArray();
      mmd.setArCameraSettings({ targetPlane: 'floor', smoothingMs: 120,
        translationDeadZonePercent: 0, rotationDeadZoneDegrees: 0, distancePercent: 100 });
      mmd.setArCameraPose({ anchorMatrix: new THREE.Matrix4().makeTranslation(0.4, 0, -3).toArray(),
        projectionMatrix, targetAspect: aspect });
      const floor = mmd.getArCameraState();
      mmd.setArCameraSettings({ targetPlane: 'vertical' });
      const vertical = mmd.getArCameraState();
      const camera = new THREE.PerspectiveCamera();
      camera.position.fromArray(vertical.cameraPosition);
      camera.quaternion.fromArray(vertical.cameraQuaternion);
      camera.projectionMatrix.fromArray(projectionMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.updateMatrixWorld(true);
      const foot = new THREE.Vector3(...vertical.targetPosition).project(camera).toArray();
      const imageBottom = new THREE.Vector3(0.4, -aspect / 2, -3)
        .applyMatrix4(new THREE.Matrix4().fromArray(projectionMatrix)).toArray();
      mmd.setArCameraSettings({ targetPlane: 'floor' });
      const restoredFloor = mmd.getArCameraState();
      mmd.resetArCameraPose();
      return { floor, vertical, restoredFloor, foot, imageBottom };
    });
    assert.equal(planeMode.vertical.settings.targetPlane, 'vertical');
    assert.ok(Math.hypot(planeMode.foot[0] - planeMode.imageBottom[0],
      planeMode.foot[1] - planeMode.imageBottom[1]) < 1e-5, '立面时脚底应对齐定位图下边缘中点');
    assert.deepEqual(planeMode.vertical.cameraPosition, planeMode.vertical.acceptedPosition,
      '模式切换应立即对齐相机，不经过旧平面缓动');
    assert.deepEqual(planeMode.vertical.modelPosition, planeMode.floor.modelPosition);
    assert.deepEqual(planeMode.vertical.modelScale, planeMode.floor.modelScale);
    assert.deepEqual(planeMode.restoredFloor.cameraPosition, planeMode.floor.cameraPosition,
      '切回底面应还原原始相机位姿');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
