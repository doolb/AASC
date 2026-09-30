'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { addGravityControls, addGravityRuntime } = require('../3rd/mmd-ar-test/web-gravity-mode');
const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');
const modules = async () => ({ THREE: await import('three'),
    ...(await import('../3rd/mmd-ar-test/web-gravity-filter.mjs')) });
const quaternion = (THREE, degrees) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), degrees * Math.PI / 180).toArray();

test('重力死区忽略小抖动、慢转累计越界后接受完整角度，不缩放方向', async () => {
    const { THREE, createGravityFilter } = await modules();
    const filter = createGravityFilter(THREE, { deadZoneDegrees: 0.5, smoothingMs: 0 });
    for (const angle of [0.1, 0.2, 0.3, 0.4]) filter.setTarget(quaternion(THREE, angle));
    assert.deepEqual(filter.update(1).toArray(), [0, 0, 0, 1]);
    filter.setTarget(quaternion(THREE, 0.6));
    assert.ok(filter.update(1).angleTo(new THREE.Quaternion().fromArray(quaternion(THREE, 0.6))) < 1e-7);
    filter.setTarget(quaternion(THREE, 0.7));
    assert.ok(filter.update(1).angleTo(new THREE.Quaternion().fromArray(quaternion(THREE, 0.6))) < 1e-7);
    filter.setTarget(quaternion(THREE, 30));
    assert.ok(filter.update(1).angleTo(new THREE.Quaternion().fromArray(quaternion(THREE, 30))) < 1e-7);
});

test('重力缓动按帧时间收敛，60/120Hz结果一致，最终精确到达目标', async () => {
    const { THREE, createGravityFilter } = await modules();
    const results = [];
    for (const fps of [60, 120]) {
        const filter = createGravityFilter(THREE);
        filter.setTarget(quaternion(THREE, 30));
        for (let frame = 0; frame < fps; frame += 1) filter.update(1 / fps);
        results.push(filter.getState().current);
        for (let frame = 0; frame < fps * 2; frame += 1) filter.update(1 / fps);
        assert.deepEqual(filter.getState().current, filter.getState().target);
    }
    assert.ok(new THREE.Quaternion().fromArray(results[0]).angleTo(new THREE.Quaternion().fromArray(results[1])) < 1e-7);
    // 验证一个缓动时间常数的数学行为，明确120ms，不依赖网页默认值。
    const filter = createGravityFilter(THREE, { smoothingMs: 120 });
    filter.setTarget(quaternion(THREE, 30));
    const first = filter.update(0.12).angleTo(new THREE.Quaternion()) * 180 / Math.PI;
    assert.ok(Math.abs(first - 30 * (1 - Math.exp(-1))) < 1e-7);
});

test('居中与关闭强制归零绕过死区，零参数旁路过滤，改小死区重新接受最新输入', async () => {
    const { THREE, createGravityFilter } = await modules();
    const filter = createGravityFilter(THREE, { deadZoneDegrees: 0, smoothingMs: 0 });
    filter.setTarget(quaternion(THREE, 0.2));
    filter.update(0);
    filter.setSettings({ deadZoneDegrees: 0.5 });
    filter.setTarget([0, 0, 0, 1]);
    assert.notDeepEqual(filter.update(0).toArray(), [0, 0, 0, 1]);
    filter.setTarget([0, 0, 0, 1], true);
    assert.deepEqual(filter.update(0).toArray(), [0, 0, 0, 1]);
    filter.setTarget(quaternion(THREE, 0.2));
    filter.setSettings({ deadZoneDegrees: 0 });
    assert.ok(filter.update(0).angleTo(new THREE.Quaternion().fromArray(quaternion(THREE, 0.2))) < 1e-7);
    assert.equal(filter.setTarget([NaN, 0, 0, 1]), false);
    assert.equal(filter.setTarget([0, 0, 0, 0]), false);
});

async function controller(permission) {
    const { THREE } = await modules();
    const listeners = new Map();
    const document = { readyState: 'loading', visibilityState: 'visible',
        addEventListener() {}, removeEventListener() {} };
    const rotations = [];
    const root = { document, isSecureContext: true, AFRAME: { THREE, components: {}, registerComponent(name, value) { this.components[name] = value; } }, screen: { orientation: { angle: 0 } },
        DeviceOrientationEvent: permission ? { requestPermission: permission } : function Orientation() {},
        localStorage: { getItem: () => '2', setItem() {} },
        DisplayMmd: { setModelGravityRotation: (value, force) => rotations.push({ value: [...value], force }) },
        addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name) => listeners.delete(name) };
    const context = vm.createContext({ window: root, globalThis: root, document, console });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../3rd/mind-basic/mind-basic-imu.js'), 'utf8'), context);
    const source = addGravityControls(fs.readFileSync(path.join(PUBLIC, 'display-mmd-ar.js'), 'utf8'));
    assert.equal(source.includes('motionSensitivity'), false);
    vm.runInContext(source.replace('    root.DisplayMmdAr = Object.freeze({',
        '    root.gravityTest = { enableMotionView, disableMotionView, recenterMotionView, handleDeviceOrientation, handleGravityCoordinatesChanged, state };\n    root.DisplayMmdAr = Object.freeze({'), context);
    return { root, api: root.gravityTest, rotations, listeners, THREE };
}

test('首次姿态归零，缺 alpha 仍按完整重力方向旋转，居中/关闭强制归零', async () => {
    const { api, rotations, THREE, listeners } = await controller();
    await api.enableMotionView();
    api.handleDeviceOrientation({ beta: 30, gamma: 0 });
    assert.deepEqual(rotations.at(-1).value, [0, 0, 0, 1]);
    api.handleDeviceOrientation({ beta: 60, gamma: 0 });
    const angle = new THREE.Quaternion().fromArray(rotations.at(-1).value).angleTo(new THREE.Quaternion()) * 180 / Math.PI;
    assert.ok(Math.abs(angle - 30) < 1e-7, '旧灵敏度存储不能将30度变为60度');
    api.recenterMotionView();
    assert.equal(rotations.at(-1).force, true);
    api.handleDeviceOrientation({ beta: 60, gamma: 0 });
    assert.deepEqual(rotations.at(-1).value, [0, 0, 0, 1]);
    const count = rotations.length;
    api.handleDeviceOrientation({ beta: null, gamma: 0 });
    assert.equal(rotations.length, count);
    api.disableMotionView();
    assert.equal(rotations.at(-1).force, true);
    assert.equal(listeners.has('deviceorientation'), false);
});

test('屏幕与后台切换重建参考，迟到权限在关闭后不能重新开启', async () => {
    const { api, rotations } = await controller();
    await api.enableMotionView();
    api.handleDeviceOrientation({ beta: 30, gamma: 0 });
    api.handleGravityCoordinatesChanged();
    assert.equal(api.state.motionCenter, null);
    assert.equal(rotations.at(-1).force, true);
    api.handleDeviceOrientation({ beta: 70, gamma: 0 });
    assert.deepEqual(rotations.at(-1).value, [0, 0, 0, 1]);
    let grant;
    const pending = await controller(() => new Promise((resolve) => { grant = resolve; }));
    const enabling = pending.api.enableMotionView();
    pending.api.disableMotionView();
    grant('granted');
    await enabling;
    assert.equal(pending.api.state.motionEnabled, false);
    assert.equal(pending.listeners.has('deviceorientation'), false);
});

test('生成 runtime 的重力层独立缓动，并在归零后保留手动角度', async () => {
    const { THREE, createGravityFilter } = await modules();
    const source = addGravityRuntime(fs.readFileSync(path.join(PUBLIC, 'display-pmx-runtime.js'), 'utf8'));
    const controls = source.slice(source.indexOf('    const manualRotation ='), source.indexOf('    const rotationState ='));
    const frame = source.slice(source.indexOf('    function updateModelRotation(delta) {'), source.indexOf('    const clearFallback ='));
    const create = new Function('THREE', 'createGravityFilter', `
        const rotationState = { targetYaw: 0.4, targetPitch: 0, fitShadowWhenSettled: false };
        const ROTATION_SETTLE_EPSILON = 0.0005, ROTATION_EASING_PER_SECOND = 1 / 0.14;
        const currentRotationPivot = new THREE.Object3D();
        const camera = { quaternion: new THREE.Quaternion() };
        const keyLight = { shadow: {} }, fillLight = { shadow: {} };
        const startRendering = () => {}, fitShadowCamera = () => {};
        ${controls}
        ${frame}
        return { setModelGravityRotation, setModelGravitySettings, updateModelRotation,
            currentRotationPivot, manualRotation, gravityFilter };
    `);
    const runtime = create(THREE, createGravityFilter);
    runtime.setModelGravityRotation(quaternion(THREE, 30));
    for (let i = 0; i < 240; i += 1) runtime.updateModelRotation(1 / 60);
    assert.ok(Math.abs(runtime.manualRotation.yaw - 0.4) < 1e-6);
    runtime.setModelGravityRotation([0, 0, 0, 1], true);
    for (let i = 0; i < 240; i += 1) runtime.updateModelRotation(1 / 60);
    assert.ok(runtime.currentRotationPivot.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0, 'XYZ'))) < 1e-7);
});
