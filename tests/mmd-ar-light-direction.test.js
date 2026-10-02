'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');
const GENERATED = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist/js');
const near = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) <= epsilon, `${a} / ${b}`);

test('光照模块显式返回方向换算，六个方向轴与距离保持', async () => {
    const { createPmxLighting } = await import(pathToFileURL(path.join(PUBLIC, 'mmd-lighting-runtime.mjs')).href);
    const lighting = createPmxLighting({ KEY_LIGHT_DISTANCE: 12 });
    assert.equal(typeof lighting.setLighting, 'function');
    assert.equal(typeof lighting.lightDirectionToPosition, 'function');
    for (const [longitude, latitude, expected] of [[0, 0, [0, 0, 12]], [90, 0, [12, 0, 0]],
        [-90, 0, [-12, 0, 0]], [180, 0, [0, 0, -12]], [37, 90, [0, 12, 0]], [37, -90, [0, -12, 0]]]) {
        const result = lighting.lightDirectionToPosition({ longitude, latitude });
        [result.x, result.y, result.z].forEach((value, index) => near(value, expected[index]));
        near(Math.hypot(result.x, result.y, result.z), 12);
    }
});

test('方向缺失/异常回默认31/46，超范围夹取及字符串规则保持', async () => {
    const { createPmxLighting } = await import(pathToFileURL(path.join(PUBLIC, 'mmd-lighting-runtime.mjs')).href);
    const convert = createPmxLighting({ KEY_LIGHT_DISTANCE: 7 }).lightDirectionToPosition;
    const defaults = convert({ longitude: 31, latitude: 46 });
    for (const value of [undefined, null, {}, { longitude: Infinity, latitude: NaN }]) {
        assert.deepEqual(convert(value), defaults);
    }
    assert.deepEqual(convert({ longitude: '90', latitude: '0' }), convert({ longitude: 90, latitude: 0 }));
    assert.deepEqual(convert({ longitude: 999, latitude: -999 }), convert({ longitude: 180, latitude: -90 }));
});

async function checkMainBinding(root) {
    const THREE = await import('three');
    const { createPmxLighting } = await import(pathToFileURL(path.join(root, 'mmd-lighting-runtime.mjs')).href);
    const source = fs.readFileSync(path.join(root, 'display-pmx-runtime.js'), 'utf8');
    const blockStart = source.indexOf('/* aasc-module-start:mmd-lighting-runtime.mjs */');
    const blockEnd = source.indexOf('/* aasc-module-end:mmd-lighting-runtime.mjs */', blockStart);
    assert.ok(blockStart >= 0 && blockEnd > blockStart);
    const positionStart = source.indexOf('    const applyKeyLightPosition = (bounds) => {');
    const positionEnd = source.indexOf('    const applyAoRadius = (bounds) => {', positionStart);
    assert.ok(positionStart >= 0 && positionEnd > positionStart);
    const keyLight = new THREE.DirectionalLight(), fillLight = new THREE.DirectionalLight();
    const lightingState = { keyDirection: { longitude: 90, latitude: 0 }, fillDirection: { longitude: 0, latitude: 90 } };
    const context = { THREE, createPmxLighting, KEY_LIGHT_DISTANCE: 12, TARGET_MODEL_HEIGHT: 2,
        keyLight, fillLight, lightingState, helper: {}, ambientLight: {}, ambientOcclusion: {},
        applyAoRadius() {}, applyShadowMode() {}, getModelBounds() {}, getWebPhysicsStepOptions() {},
        setPmxFillShadowMode() {}, setPmxLightingMode() {}, setPmxRimLights() {} };
    // 执行真实的创建模块/解构及主补光定位语句，确保作用域绑定存在，而非仅匹配函数名。
    const apply = vm.runInNewContext(source.slice(positionStart, positionEnd) + '\n'
        + source.slice(blockStart, blockEnd) + '\napplyKeyLightPosition;', context);
    const bounds = new THREE.Box3(new THREE.Vector3(1, 2, 3), new THREE.Vector3(3, 6, 5));
    apply(bounds);
    near(keyLight.position.distanceTo(new THREE.Vector3(26, 4, 4)), 0);
    near(fillLight.position.distanceTo(new THREE.Vector3(2, 28, 4)), 0);
    near(fillLight.target.position.distanceTo(bounds.getCenter(new THREE.Vector3())), 0);
    lightingState.keyDirection = { longitude: -90, latitude: 0 };
    apply(bounds); near(keyLight.position.distanceTo(new THREE.Vector3(-22, 4, 4)), 0);
}

test('源运行时主光/补光调用真实模块闭包，重新定位保留方向与缩放', async () => {
    await checkMainBinding(PUBLIC);
});

test('网页生成模块和主运行时绑定一致，主补光定位无未定义错误', async () => {
    await checkMainBinding(GENERATED);
});
