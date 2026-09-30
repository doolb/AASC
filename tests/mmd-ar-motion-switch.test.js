'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const loadSwitch = () => import('../3rd/mmd-ar-test/web-motion-switch.mjs');

async function fixture() {
    const THREE = await import('three');
    const bone = new THREE.Bone();
    bone.position.set(8, 9, 10);
    const link = { enabled: false };
    const mesh = new THREE.Object3D();
    mesh.skeleton = { bones: [bone] };
    mesh.geometry = { userData: { MMD: { iks: [{ links: [link] }], rigidBodies: [{}] } } };
    mesh.morphTargetInfluences = [0.7];
    mesh.pose = () => bone.position.set(0, 0, 0);
    const events = [];
    const oldHelper = { enabled: { physics: true, animation: true } };
    const physics = { manager: {
        allocVector3: () => ({ setValue() {} }), freeVector3() {}
    }, bodies: [{ body: {
        setLinearVelocity() { events.push('zero'); }, setAngularVelocity() {}, clearForces() {}, activate() {}
    } }] };
    const helper = { objects: new Map([[mesh, { physics }]]), enabled: { physics: true, animation: false },
        enable(key, value) { this.enabled[key] = value; link.enabled = true; },
        update() { throw new Error('初始化阶段不能应用动作或推进物理'); },
        _setupMeshPhysics(value, options) {
            assert.equal(value, mesh);
            assert.deepEqual(bone.position.toArray(), [0, 0, 0]);
            assert.deepEqual(options, { warmup: 0, animationWarmup: false, unitStep: 1 / 65, maxStepNum: 3 });
            events.push('physics');
        },
        remove() { events.push('remove'); }
    };
    const update = mesh.updateWorldMatrix.bind(mesh);
    mesh.updateWorldMatrix = (...args) => { events.push('matrix'); update(...args); };
    const options = { mesh, oldHelper, physicsEnabled: true, physicsFps: 65,
        playbackEnabled: true, isCurrent: () => true,
        ensurePhysics: async () => { events.push('ammo'); },
        createHelper: async () => {
            assert.deepEqual(bone.position.toArray(), [0, 0, 0], 'mixer 先捕获绑定姿态');
            events.push('helper');
            return { helper };
        } };
    return { ...(await loadSwitch()), mesh, bone, link, helper, oldHelper, options, events };
}

test('切换先暂停旧物理、恢复绑定姿态并更新矩阵，再初始化物理和清零速度', async () => {
    const { prepareMotionSwitch, options, helper, oldHelper, events } = await fixture();
    const result = await prepareMotionSwitch(options);
    assert.equal(result.helper, helper);
    assert.equal(result.physicsEnabled, true);
    assert.equal(helper.enabled.physics, true);
    assert.equal(helper.enabled.animation, true);
    assert.equal(oldHelper.enabled.physics, true);
    assert.deepEqual(events, ['ammo', 'helper', 'matrix', 'physics', 'zero']);
});

test('原物理关闭或没有刚体时不请求 Ammo，暂停播放保留绑定姿态', async () => {
    for (const noBodies of [false, true]) {
        const { prepareMotionSwitch, options, mesh, helper, oldHelper, events } = await fixture();
        options.physicsEnabled = noBodies;
        options.playbackEnabled = false;
        if (noBodies) mesh.geometry.userData.MMD.rigidBodies = [];
        oldHelper.enabled.physics = false;
        // 无物理旧状态也必须保持关闭。
        helper.update = () => { throw new Error('暂停加载也不能应用第0帧'); };
        const result = await prepareMotionSwitch(options);
        assert.equal(result.physicsEnabled, false);
        assert.equal(helper.enabled.physics, false);
        assert.equal(helper.enabled.animation, false);
        assert.equal(oldHelper.enabled.physics, false);
        assert.deepEqual(events, ['helper', 'matrix']);
    }
});

test('新物理初始化失败恢复旧骨骼、网格父级、表情、IK 和物理开关', async () => {
    const { prepareMotionSwitch, options, mesh, bone, link, helper, oldHelper } = await fixture();
    const parent = new (await import('three')).Group();
    parent.add(mesh);
    mesh.position.set(1, 2, 3);
    helper._setupMeshPhysics = () => {
        mesh.parent = null;
        mesh.position.set(0, 0, 0);
        throw new Error('初始化失败');
    };
    await assert.rejects(prepareMotionSwitch(options), /初始化失败/u);
    assert.deepEqual(bone.position.toArray(), [8, 9, 10]);
    assert.deepEqual(mesh.position.toArray(), [1, 2, 3]);
    assert.equal(mesh.parent, parent);
    assert.deepEqual(mesh.morphTargetInfluences, [0.7]);
    assert.equal(link.enabled, false);
    assert.equal(oldHelper.enabled.physics, true);
});

test('Ammo失败和异步过期不应用动作；提交前过期可回滚且不写入已换走网格', async () => {
    const failure = await fixture();
    failure.options.ensurePhysics = async () => { throw new Error('Ammo失败'); };
    await assert.rejects(failure.prepareMotionSwitch(failure.options), /Ammo失败/u);
    assert.deepEqual(failure.bone.position.toArray(), [8, 9, 10]);
    assert.equal(failure.oldHelper.enabled.physics, true);
    const stale = await fixture();
    let current = true;
    stale.options.ensurePhysics = async () => { current = false; };
    stale.options.isCurrent = () => current;
    assert.equal(await stale.prepareMotionSwitch(stale.options), null);
    assert.deepEqual(stale.bone.position.toArray(), [8, 9, 10]);
    const retired = await fixture();
    retired.options.canRestore = () => false;
    const prepared = await retired.prepareMotionSwitch(retired.options);
    retired.bone.position.set(11, 12, 13);
    prepared.rollback();
    assert.deepEqual(retired.bone.position.toArray(), [11, 12, 13]);
    const rollback = await fixture();
    const staged = await rollback.prepareMotionSwitch(rollback.options);
    staged.rollback();
    staged.rollback();
    assert.deepEqual(rollback.bone.position.toArray(), [8, 9, 10]);
    assert.equal(rollback.events.filter((name) => name === 'remove').length, 1);
});

test('速度清理无物理旁路，临时零向量在成功和失败时都释放', async () => {
    const { clearPmxPhysicsMotion } = await loadSwitch();
    assert.equal(clearPmxPhysicsMotion(null), undefined);
    for (const fail of [false, true]) {
        let freed = 0, linear, angular, forces = 1;
        const zero = { values: null, setValue(...values) { this.values = values; } };
        const physics = { manager: { allocVector3: () => zero,
            freeVector3(value) { assert.equal(value, zero); freed += 1; } },
        bodies: [{ body: {
            setLinearVelocity(value) { linear = [...value.values]; },
            setAngularVelocity(value) {
                if (fail) throw new Error('清理失败');
                angular = [...value.values];
            }, clearForces() { forces = 0; }, activate() {}
        } }] };
        if (fail) assert.throws(() => clearPmxPhysicsMotion(physics), /清理失败/u);
        else {
            clearPmxPhysicsMotion(physics);
            assert.deepEqual(linear, [0, 0, 0]);
            assert.deepEqual(angular, [0, 0, 0]);
            assert.equal(forces, 0);
        }
        assert.equal(freed, 1);
    }
});

test('网页注入的模型helper返回前也清理速度并保留播放/物理参数', async () => {
    const { addLocalRuntime } = require('../3rd/mmd-ar-test/web-local-assets-inject');
    const source = addLocalRuntime(fs.readFileSync(path.resolve(__dirname,
        '../src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js'), 'utf8'), './web-local-assets.mjs');
    const begin = source.indexOf('    const createMotionHelper =');
    const end = source.indexOf('    const validateMotionResource =', begin);
    const data = await fixture();
    const create = new Function('data', `
        const { clearPmxPhysicsMotion } = data;
        const MMDAnimationHelper = function () {}, THREE = {}, physicsEnabled = true;
        const lightingState = { physicsFps: 65 }, motionPlaybackEnabled = false;
        const ensureAmmoPhysics = () => {}, setPmxMotionPlaybackEnabled = (helper, enabled) => { helper.enabled.animation = enabled; };
        const createPmxMotionHelper = async (options) => {
            if (options.physicsEnabled !== true) throw new Error('模型物理开关丢失');
            return { helper: data.helper };
        };
        ${source.slice(begin, end)}
        return createMotionHelper;
    `);
    const prepare = create(data);
    const result = await prepare(data.mesh, {}, 'loop');
    assert.equal(result.helper, data.helper);
    assert.deepEqual(data.events, ['zero']);
    assert.equal(data.helper.enabled.animation, false);
    assert.equal(data.helper.objects.get(data.mesh).physics.unitStep, 1 / 65);
});

test('注入 runtime 在等待 Ammo 时阻止旧动作/物理帧，继续锚点更新并拒绝重复提交', async () => {
    const { addLocalRuntime } = require('../3rd/mmd-ar-test/web-local-assets-inject');
    const original = fs.readFileSync(path.resolve(__dirname,
        '../src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js'), 'utf8');
    const source = addLocalRuntime(original, './web-local-assets.mjs');
    const begin = source.indexOf('    const loadSelectedMotion =');
    const finish = source.indexOf('    const playMotion =', begin);
    const frameRead = source.match(/        const frameHelper = .*;/u)[0];
    const data = await fixture();
    let grant;
    const ammo = new Promise((resolve) => { grant = resolve; });
    const create = new Function('data', 'ammo', `
        const { prepareMotionSwitch } = data;
        let currentMesh = data.mesh, currentProfile = { modelUrl: 'original', playMode: 'loop' };
        let motionSwitchMesh = null, disposed = false, motionSequence = 0, modelSequence = 0;
        let pendingInitialMotionHelper = data.oldHelper, currentMotionResourceId = 'old';
        const helper = { current: data.oldHelper }, physicsEnabled = true, motionPlaybackEnabled = false;
        const physicsGate = { paused: true }, lightingState = { physicsFps: 65 };
        const validateMotionResource = () => {}, loadAnimationClip = async () => ({});
        const createMotionHelper = async (mesh, clip, mode, physics) => {
            if (physics !== false) throw new Error('切换动作不能预先创建物理');
            return { helper: data.helper };
        };
        const ensureAmmoPhysics = () => ammo;
        const stopMotion = () => { helper.current = null; pendingInitialMotionHelper = null; };
        const setPmxMotionPlaybackEnabled = (target, value) => { target.enabled.animation = value; };
        const onStatus = () => {}, onProgress = () => {};
        ${source.slice(begin, finish)}
        return { loadSelectedMotion,
            getFrameHelper: () => { ${frameRead} return frameHelper; },
            state: () => ({ helper: helper.current, profile: currentProfile,
                pendingInitialMotionHelper, physicsGate }) };
    `);
    const runtime = create(data, ammo);
    const loading = runtime.loadSelectedMotion({ motionUrl: 'new.vmd', motionResourceId: 'new' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(data.oldHelper.enabled.physics, false);
    assert.equal(runtime.getFrameHelper(), null);
    let steps = 0, rotations = 0;
    data.oldHelper.update = () => { steps += 1; };
    const { advancePmxMotionFrame } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');
    advancePmxMotionFrame({ delta: 1 / 60, helper: runtime.getFrameHelper(),
        advanceRotation: () => { rotations += 1; return 0; } });
    assert.equal(steps, 0);
    assert.equal(rotations, 1);
    await assert.rejects(runtime.loadSelectedMotion({ motionUrl: 'other.vmd' }), /正在切换/u);
    grant();
    assert.equal(await loading, true);
    assert.equal(runtime.getFrameHelper(), data.helper);
    assert.equal(runtime.state().profile.motionUrl, 'new.vmd');
    assert.equal(runtime.state().pendingInitialMotionHelper, data.helper);
    assert.equal(runtime.state().physicsGate.paused, false);
    assert.equal(data.helper.enabled.animation, false);
});

test('真实 VMD/Ammo 从绑定姿态创建刚体，首渲染帧仅物理、下一帧才播放', async () => {
    const THREE = await import('three');
    const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three');
    const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
    const encode = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const source = (name) => fs.readFileSync(path.join(vendor, 'animation', name), 'utf8')
        .replace("from 'three'", `from '${threeUrl}'`);
    const ikUrl = encode(source('CCDIKSolver.js'));
    const { addPhysicsLifecycle, addAnimationLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
    const physicsUrl = encode(addPhysicsLifecycle(source('MMDPhysics.js')));
    const helperSource = addAnimationLifecycle(source('MMDAnimationHelper.js'), physicsUrl)
        .replace('../animation/CCDIKSolver.js', ikUrl);
    const { MMDAnimationHelper } = await import(encode(helperSource));
    globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({
        wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
    const bone = new THREE.Bone();
    bone.name = 'center';
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    mesh.geometry.userData.MMD = { format: 'pmx', iks: [], grants: [], constraints: [],
        bones: [{ index: 0, parentIndex: -1, transformationClass: 0, rigidBodyType: 0 }],
        rigidBodies: [{ type: 0, boneIndex: 0, shapeType: 0, width: 0.1, height: 0.1, depth: 0.1,
            weight: 0, position: [0, 0, 0], rotation: [0, 0, 0], friction: 0, restitution: 0,
            positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 65535 }] };
    for (const type of [1, 2]) mesh.geometry.userData.MMD.rigidBodies.push({
        ...mesh.geometry.userData.MMD.rigidBodies[0], type, boneIndex: -1, weight: 1, position: [type * 2, 0, 0]
    });
    bone.position.set(8, 9, 10);
    const clip = new THREE.AnimationClip('new-motion', 1, [new THREE.VectorKeyframeTrack(
        '.bones[center].position', [0, 1], [3, 4, 5, 6, 7, 8])]);
    const { createPmxMotionHelper } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');
    const { prepareMotionSwitch } = await loadSwitch();
    const prepared = await prepareMotionSwitch({ mesh, oldHelper: null, physicsEnabled: true,
        physicsFps: 65, playbackEnabled: false, isCurrent: () => true, ensurePhysics: async () => {},
        createHelper: () => createPmxMotionHelper({ mesh, clip, MMDAnimationHelper,
            loopRepeat: THREE.LoopRepeat, loopOnce: THREE.LoopOnce, physicsEnabled: false }) });
    assert.deepEqual(bone.position.toArray(), [0, 0, 0]);
    const data = prepared.helper.objects.get(mesh);
    const origin = data.physics.bodies[0].body.getCenterOfMassTransform().getOrigin();
    assert.deepEqual([origin.x(), origin.y(), origin.z()], [0, 0, 0]);
    // 对三种刚体主动注入旧速度和力，确认清理完整且不会改变位姿。
    const { clearPmxPhysicsMotion } = await loadSwitch();
    const velocity = new Ammo.btVector3(4, 5, 6);
    const force = new Ammo.btVector3(7, 8, 9);
    const vector = (value) => [value.x(), value.y(), value.z()];
    let zeroCalls = 0;
    for (const { body } of data.physics.bodies) {
        body.setLinearVelocity(velocity);
        body.setAngularVelocity(velocity);
        body.applyCentralForce(force);
        const setLinear = body.setLinearVelocity;
        body.setLinearVelocity = function (value) { zeroCalls += 1; return setLinear.call(this, value); };
    }
    clearPmxPhysicsMotion(data.physics);
    assert.equal(zeroCalls, 3);
    for (const { body } of data.physics.bodies) {
        assert.deepEqual(vector(body.getLinearVelocity()), [0, 0, 0]);
        assert.deepEqual(vector(body.getAngularVelocity()), [0, 0, 0]);
    }
    assert.deepEqual(vector(data.physics.bodies[0].body.getCenterOfMassTransform().getOrigin()), [0, 0, 0]);
    Ammo.destroy(velocity);
    Ammo.destroy(force);
    // 执行网页实际渲染门控，而非另写一份模拟顺序；验证首帧物理和下一帧动作。
    const { addLocalRuntime } = require('../3rd/mmd-ar-test/web-local-assets-inject');
    const runtimeSource = addLocalRuntime(fs.readFileSync(path.resolve(__dirname,
        '../src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js'), 'utf8'), './web-local-assets.mjs');
    const begin = runtimeSource.indexOf('    const renderFrame =');
    const end = runtimeSource.indexOf('    const startRendering =', begin);
    const { advancePmxMotionFrame, setPmxMotionPlaybackEnabled } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');
    const renderTrace = [];
    const render = new Function('bindings', `
        const { mesh, prepared, advancePmxMotionFrame, setPmxMotionPlaybackEnabled, renderTrace } = bindings;
        let pendingInitialMotionHelper = prepared.helper, motionSwitchMesh = null;
        let frameHandle = 0, lastFrameAt = 0, motionPlaybackEnabled = true;
        const visible = true, disposed = false, currentMesh = mesh;
        const helper = { current: prepared.helper }, physicsGate = { paused: false };
        const currentRotationPivot = mesh, lightingState = { rotationPhysicsLimit: 0 };
        const arCameraState = { active: false }, updateModelRotation = () => 0, updateCameraView = () => {};
        const ambientOcclusion = { render: () => renderTrace.push({ visible: mesh.visible,
            time: helper.current.objects.get(mesh).mixer._actions[0].time,
            bone: mesh.skeleton.bones[0].position.toArray() }) };
        const requestAnimationFrame = () => 1;
        ${runtimeSource.slice(begin, end)}
        return { frame: renderFrame, setPlayback: (enabled) => {
            motionPlaybackEnabled = enabled;
            setPmxMotionPlaybackEnabled(helper.current, enabled);
        } };
    `)({ mesh, prepared, advancePmxMotionFrame, setPmxMotionPlaybackEnabled, renderTrace });
    // 即使用户在首帧前启用播放，也不能越过首帧物理门控。
    render.setPlayback(true);
    render.frame(100);
    assert.notEqual(data.physics.bodies[1].body.getLinearVelocity().y(), 0, '初始化清理后重力仍产生运动');
    assert.equal(data.physics.bodies[1].body.getLinearVelocity().x(), 0, '施加的X方向残留力已清除');
    assert.deepEqual(bone.position.toArray(), [0, 0, 0]);
    assert.equal(data.mixer._actions[0].time, 0);
    assert.deepEqual(renderTrace[0], { visible: false, time: 0, bone: [0, 0, 0] });
    render.frame(200);
    assert.ok(Math.abs(bone.position.x - 3.3) < 1e-6);
    assert.ok(Math.abs(data.mixer._actions[0].time - 0.1) < 1e-8);
    assert.equal(renderTrace[1].visible, true);
    // 下一帧前关闭播放，立即保持当前动作时间；后台不调用frame，不会消耗门控。
    render.setPlayback(false);
    render.frame(300);
    assert.ok(Math.abs(data.mixer._actions[0].time - 0.1) < 1e-8);
    render.setPlayback(true);
    prepared.helper.update(1);
    assert.equal(zeroCalls, 3, '自动循环不调用新增清理');
    prepared.helper.remove(mesh);
    assert.equal(data.physics.manager.nativeObjects.size, 0, '移除动作释放全部自建native物理对象');
});
