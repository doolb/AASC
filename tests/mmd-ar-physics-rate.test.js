'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { addPhysicsSubsteps } = require('../3rd/mmd-ar-test/web-physics-substeps');
const { addPhysicsRateDisplay, addPhysicsRateHelper, addPhysicsRateRuntime } = require('../3rd/mmd-ar-test/web-physics-rate');
const { addPhysicsLifecycle, addAnimationLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const rateUrl = pathToFileURL(path.resolve(__dirname, '../3rd/mmd-ar-test/web-physics-rate.mjs')).href;
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('网页30到180Hz边界、默认、5Hz步长和高频子步预算', async () => {
    const { getWebPhysicsStepOptions } = await import(rateUrl);
    for (const [input, fps, maxStepNum] of [
        [undefined, 65, 3], [NaN, 65, 3], [Infinity, 65, 3], [-1, 30, 3],
        [30, 30, 3], [65, 65, 3], [90, 90, 3], [95, 95, 11], [120, 120, 13],
        ['180', 180, 19], [999, 180, 19], [177, 175, 19], [178, 180, 19], [480, 180, 19]
    ]) assert.deepEqual(getWebPhysicsStepOptions(input), { unitStep: 1 / fps, maxStepNum });
});

test('网页适配在固定源唯一锚点改限幅和预算，源码升级缺失/重复锚点时失败', () => {
    const read = (file) => fs.readFileSync(path.join(publicRoot, 'js', file), 'utf8');
    const display = read('display-mmd.js');
    assert.ok(display.includes('clamp(value, 30, 90, DEFAULT_MMD_LIGHTING.physicsFps)'));
    assert.ok(addPhysicsRateDisplay(display).includes('clamp(value, 30, 180, DEFAULT_MMD_LIGHTING.physicsFps)'));
    const { addLocalRuntime } = require('../3rd/mmd-ar-test/web-local-assets-inject');
    const patched = addPhysicsRateRuntime(addLocalRuntime(read('display-pmx-runtime.js'), './local.mjs', './motion.mjs'), rateUrl);
    assert.ok(patched.includes('normalizeLightNumber(value, 30, 180, lightingState.physicsFps)'));
    assert.ok(patched.includes('Object.assign(currentPhysics, getWebPhysicsStepOptions(lightingState.physicsFps))'));
    assert.ok(patched.includes('Object.assign(physics, getWebPhysicsStepOptions(lightingState.physicsFps))'));
    for (const transform of [addPhysicsRateDisplay, addPhysicsRateHelper, addPhysicsRateRuntime]) {
        assert.throws(() => transform('', rateUrl), /唯一锚点/u);
    }
    assert.throws(() => addPhysicsRateDisplay(display + display), /唯一锚点/u);
});

// 使用与构建相同的vendor补丁和实际WASM；恒速位移能观察到Bullet是否丢弃模拟时间。
let fixturePromise;
async function fixture() {
    if (fixturePromise) return fixturePromise;
    fixturePromise = (async () => {
        const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const THREE = await import(threeUrl);
        const vendor = path.join(publicRoot, 'js/vendor/three');
        const source = (name) => fs.readFileSync(path.join(vendor, 'animation', name), 'utf8')
            .replace("from 'three'", `from '${threeUrl}'`);
        const physicsUrl = dataUrl(addPhysicsSubsteps(addPhysicsLifecycle(source('MMDPhysics.js'))));
        const helperSource = addAnimationLifecycle(source('MMDAnimationHelper.js'), physicsUrl)
            .replace('../animation/CCDIKSolver.js', dataUrl(source('CCDIKSolver.js')));
        const { MMDAnimationHelper } = await import(dataUrl(helperSource));
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({
            wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        const original = fs.readFileSync(path.join(publicRoot, 'js/mmd-pmx-helper.mjs'), 'utf8');
        const helper = await import(dataUrl(addPhysicsRateHelper(original, rateUrl)
            .replace('./mmd-ammo-physics.mjs', pathToFileURL(path.join(publicRoot, 'js/mmd-ammo-physics.mjs')).href)));
        const makeMesh = () => {
            const bone = new THREE.Bone();
            const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
            mesh.add(bone);
            mesh.bind(new THREE.Skeleton([bone]));
            mesh.geometry.userData.MMD = { format: 'pmx', iks: [], grants: [],
                bones: [{ index: 0, parentIndex: -1, transformationClass: 0, rigidBodyType: 0 }],
                rigidBodies: [{ type: 1, boneIndex: -1, shapeType: 0, width: 0.1, height: 0.1, depth: 0.1,
                    weight: 1, position: [0, 0, 0], rotation: [0, 0, 0], friction: 0, restitution: 0,
                    positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 65535 }], constraints: [] };
            return mesh;
        };
        const create = (mesh, fps, clip = null, physicsEnabled = true) => helper.createPmxMotionHelper({ mesh, clip,
            physicsFps: fps, physicsEnabled, MMDAnimationHelper, ensurePhysics: async () => {},
            loopRepeat: THREE.LoopRepeat, loopOnce: THREE.LoopOnce });
        return { THREE, makeMesh, create };
    })();
    return fixturePromise;
}

test('真实Ammo在180Hz下以60/30/10FPS推进一秒均保持恒速位移，实时降频不清零', async () => {
    const { makeMesh, create } = await fixture();
    const { getWebPhysicsStepOptions } = await import(rateUrl);
    const started = performance.now();
    for (const renderFps of [60, 30, 10]) {
        const mesh = makeMesh();
        const { helper, physicsError } = await create(mesh, 180);
        assert.equal(physicsError, null);
        const physics = helper.objects.get(mesh).physics;
        const body = physics.bodies[0].body;
        const vector = new Ammo.btVector3(0, 0, 0);
        try {
            assert.equal(physics.unitStep, 1 / 180);
            assert.equal(physics.maxStepNum, 19);
            physics.world.setGravity(vector);
            vector.setValue(1, 0, 0);
            body.setLinearVelocity(vector);
            for (let frame = 0; frame < renderFps; frame += 1) helper.update(1 / renderFps);
            const travelled = body.getWorldTransform().getOrigin().x();
            assert.ok(Math.abs(travelled - 1) < 0.01, `${renderFps}FPS一秒位移=${travelled}`);
            Object.assign(physics, getWebPhysicsStepOptions(65));
            assert.equal(helper.objects.get(mesh).physics, physics);
            assert.equal(physics.maxStepNum, 3);
            assert.equal(body.getLinearVelocity().x(), 1);
        } finally {
            Ammo.destroy(vector);
            helper.remove(mesh);
            assert.equal(physics.manager.nativeObjects.size, 0);
            mesh.geometry.dispose(); mesh.material.dispose();
        }
    }
    console.info(`180Hz真实Ammo三组一秒模拟耗时${Math.round(performance.now() - started)}ms`);
});

test('180Hz手动动作从绑定姿态创建物理且速度清零，关闭物理不创建', async () => {
    const { THREE, makeMesh, create } = await fixture();
    const { prepareMotionSwitch } = await import('../3rd/mmd-ar-test/web-motion-switch.mjs');
    const mesh = makeMesh();
    const { helper: oldHelper } = await create(mesh, 180);
    const oldPhysics = oldHelper.objects.get(mesh).physics;
    const clip = new THREE.AnimationClip('motion', 1, [new THREE.VectorKeyframeTrack('.bones[0].position', [0, 1], [8, 0, 0, 9, 0, 0])]);
    const options = { mesh, oldHelper, physicsEnabled: true, physicsFps: 180, playbackEnabled: true,
        isCurrent: () => true, ensurePhysics: async () => {}, createHelper: () => create(mesh, 180, clip, false) };
    let next;
    try {
        next = await prepareMotionSwitch(options);
        const physics = next.helper.objects.get(mesh).physics;
        assert.equal(physics.unitStep, 1 / 180);
        assert.equal(physics.maxStepNum, 19);
        assert.equal(mesh.skeleton.bones[0].position.x, 0);
        assert.equal(next.helper.objects.get(mesh).mixer._actions[0].time, 0);
        for (const { body } of physics.bodies) {
            assert.equal(body.getLinearVelocity().length(), 0);
            assert.equal(body.getAngularVelocity().length(), 0);
        }
        next.rollback(); next = null;
        const disabled = await prepareMotionSwitch({ ...options, physicsEnabled: false });
        assert.equal(disabled.helper.objects.get(mesh).physics, undefined);
        disabled.rollback();
    } finally {
        next?.rollback();
        oldHelper.remove(mesh);
        assert.equal(oldPhysics.manager.nativeObjects.size, 0);
        mesh.geometry.dispose(); mesh.material.dispose();
    }
});
