'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { addPhysicsLifecycle, addAnimationLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three');
let fixturePromise;

async function fixture() {
    if (fixturePromise) return fixturePromise;
    fixturePromise = (async () => {
        // 使用固定真实库，并记录构造出的 native 指针；getter 返回的借用包装不计为自建分配。
        const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const THREE = await import(threeUrl);
        const encode = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
        const source = (name) => fs.readFileSync(path.join(vendor, 'animation', name), 'utf8')
            .replace("from 'three'", `from '${threeUrl}'`);
        const physicsSource = addPhysicsLifecycle(source('MMDPhysics.js'));
        const physicsUrl = encode(physicsSource);
        const helperSource = addAnimationLifecycle(source('MMDAnimationHelper.js'), physicsUrl)
            .replace('../animation/CCDIKSolver.js', encode(source('CCDIKSolver.js')));
        const { MMDPhysics } = await import(physicsUrl);
        const { MMDAnimationHelper } = await import(encode(helperSource));
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({
            wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        const living = new Map();
        const events = [];
        for (const type of new Set([...physicsSource.matchAll(/new Ammo\.(\w+)/gu)].map((match) => match[1]))) {
            const Original = Ammo[type];
            const Wrapped = function (...args) {
                const object = new Original(...args);
                const pointer = Ammo.getPointer(object);
                assert.equal(living.has(pointer), false, `重复存活指针 ${type}`);
                living.set(pointer, type);
                events.push({ operation: 'create', pointer, type });
                return object;
            };
            Wrapped.prototype = Original.prototype;
            Object.setPrototypeOf(Wrapped, Original);
            Ammo[type] = Wrapped;
        }
        const destroy = Ammo.destroy;
        Ammo.destroy = (object) => {
            const pointer = Ammo.getPointer(object);
            const type = living.get(pointer);
            assert.ok(type, '不能释放借用对象或重复释放');
            events.push({ operation: 'destroy', pointer, type });
            destroy(object);
            living.delete(pointer);
        };
        const makeMesh = () => {
            const bone = new THREE.Bone();
            bone.name = 'center';
            const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
            mesh.add(bone);
            mesh.bind(new THREE.Skeleton([bone]));
            const body = { type: 1, boneIndex: -1, shapeType: 0, width: 0.1, height: 0.1, depth: 0.1,
                weight: 1, position: [0, 0, 0], rotation: [0, 0, 0], friction: 0, restitution: 0,
                positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 65535 };
            mesh.geometry.userData.MMD = { format: 'pmx', iks: [], grants: [],
                bones: [{ index: 0, parentIndex: -1, transformationClass: 0, rigidBodyType: 0 }],
                rigidBodies: [body, { ...body, shapeType: 1, position: [2, 0, 0] },
                    { ...body, shapeType: 2, position: [4, 0, 0] }],
                constraints: [{ rigidBodyIndex1: 0, rigidBodyIndex2: 1,
                    position: [1, 0, 0], rotation: [0, 0, 0], translationLimitation1: [0, 0, 0],
                    translationLimitation2: [0, 0, 0], rotationLimitation1: [0, 0, 0],
                    rotationLimitation2: [0, 0, 0], springPosition: [0, 0, 0], springRotation: [0, 0, 0] }] };
            return mesh;
        };
        const cleanupMesh = (mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); };
        const makeHelper = (mesh) => {
            const helper = new MMDAnimationHelper({ sync: false });
            helper.add(mesh, { physics: true, warmup: 0, animationWarmup: false });
            return helper;
        };
        return { THREE, MMDPhysics, MMDAnimationHelper, makeMesh, cleanupMesh, makeHelper, living, events };
    })();
    return fixturePromise;
}

test('真实 Ammo 连续128次创建/步进/remove全部 native 分配回到基线且堆可复用', async () => {
    const { makeMesh, cleanupMesh, makeHelper, living, events } = await fixture();
    const mesh = makeMesh();
    const probes = [];
    for (let index = 0; index < 128; index += 1) {
        const helper = makeHelper(mesh);
        const physics = helper.objects.get(mesh).physics;
        assert.ok(living.size > 0);
        assert.equal([...living.values()].includes('btRigidBodyConstructionInfo'), false, '构造信息及时释放');
        helper.update(1 / 65);
        helper.remove(mesh);
        assert.equal(living.size, 0, `第${index + 1}次释放后不得保留 native 对象`);
        assert.equal(physics.manager.nativeObjects.size, 0);
        assert.equal(physics.manager.transforms.length, 0);
        assert.equal(physics.world, null);
        const destroyed = events.length;
        physics.dispose();
        assert.equal(events.length, destroyed, '重复 dispose 不调用 destroy');
        // 额外申请4MiB大块探针再释放，验证底层分配器回收空间而非只删除JS记录。
        const pointer = Ammo._malloc(4 * 1024 * 1024);
        assert.ok(pointer > 0);
        probes.push(pointer);
        Ammo._free(pointer);
        events.length = 0;
    }
    assert.equal(new Set(probes.slice(8)).size, 1, '预热后大块内存地址稳定复用');
    assert.equal(Ammo.HEAP8.byteLength, 64 * 1024 * 1024);
    cleanupMesh(mesh);
});

test('约束和刚体先移出世界，native依赖按逆创建顺序销毁', async () => {
    const { makeMesh, cleanupMesh, makeHelper, living, events } = await fixture();
    const mesh = makeMesh();
    const helper = makeHelper(mesh);
    const physics = helper.objects.get(mesh).physics;
    const trace = [];
    const removeConstraint = physics.world.removeConstraint;
    const removeBody = physics.world.removeRigidBody;
    physics.world.removeConstraint = function (object) { trace.push('constraint'); return removeConstraint.call(this, object); };
    physics.world.removeRigidBody = function (object) { trace.push('body'); return removeBody.call(this, object); };
    events.length = 0;
    const pointers = [...living.keys()].reverse();
    helper.remove(mesh);
    assert.deepEqual(trace, ['constraint', 'body', 'body', 'body']);
    assert.deepEqual(events.map((event) => event.pointer), pointers);
    const types = events.map((event) => event.type);
    assert.ok(types.indexOf('btGeneric6DofSpringConstraint') < types.indexOf('btRigidBody'));
    assert.ok(types.indexOf('btDiscreteDynamicsWorld') > types.lastIndexOf('btRigidBody'));
    assert.ok(types.indexOf('btDiscreteDynamicsWorld') < types.indexOf('btCollisionDispatcher'));
    assert.equal(living.size, 0);
    cleanupMesh(mesh);
});

test('借用同一world的物理只释放自己的资源，外部world仍可运行', async () => {
    const { MMDPhysics, makeMesh, cleanupMesh, living } = await fixture();
    const first = makeMesh(), second = makeMesh();
    const parameters = first.geometry.userData.MMD;
    const owner = new MMDPhysics(first, parameters.rigidBodies, parameters.constraints);
    const baseline = living.size;
    const borrower = new MMDPhysics(second, parameters.rigidBodies, parameters.constraints, { world: owner.world });
    assert.ok(living.size > baseline);
    borrower.update(1 / 65);
    borrower.dispose();
    assert.equal(living.size, baseline);
    owner.update(1 / 65);
    assert.ok(owner.bodies[0].body.getLinearVelocity().y() < 0);
    owner.dispose();
    assert.equal(living.size, 0);
    cleanupMesh(first); cleanupMesh(second);
});

test('部分刚体或约束创建失败清理全部暂存资源，并恢复网格父级与变换', async () => {
    const { THREE, MMDPhysics, makeMesh, cleanupMesh, living } = await fixture();
    for (const stage of ['body', 'constraint']) {
        const mesh = makeMesh();
        const parent = new THREE.Group();
        parent.add(mesh);
        mesh.position.set(7, 8, 9); mesh.scale.set(2, 3, 4);
        mesh.quaternion.setFromEuler(new THREE.Euler(0.2, 0.3, 0.4));
        const orientation = mesh.quaternion.toArray();
        const data = mesh.geometry.userData.MMD;
        if (stage === 'body') data.rigidBodies[1].shapeType = 99;
        else data.constraints[0].rigidBodyIndex2 = 999;
        assert.throws(() => new MMDPhysics(mesh, data.rigidBodies, data.constraints));
        assert.equal(living.size, 0, `${stage}失败后没有部分分配残留`);
        assert.equal(mesh.parent, parent);
        assert.deepEqual(mesh.position.toArray(), [7, 8, 9]);
        assert.deepEqual(mesh.scale.toArray(), [2, 3, 4]);
        assert.deepEqual(mesh.quaternion.toArray(), orientation);
        cleanupMesh(mesh);
    }
});

test('helper物理创建后的预热/IK失败及刚体构造失败都释放分配', async () => {
    const { MMDAnimationHelper, makeMesh, cleanupMesh, living } = await fixture();
    const mesh = makeMesh();
    const helper = new MMDAnimationHelper();
    helper._optimizeIK = () => { throw new Error('IK初始化失败'); };
    assert.throws(() => helper.add(mesh, { warmup: 0, animationWarmup: false }), /IK初始化失败/);
    assert.equal(helper.objects.get(mesh).physics, undefined);
    assert.equal(living.size, 0);
    helper.remove(mesh);
    const Body = Ammo.btRigidBody;
    try {
        Ammo.btRigidBody = function () { throw new Error('刚体构造失败'); };
        assert.throws(() => new MMDAnimationHelper().add(mesh, { warmup: 0 }), /刚体构造失败/);
        assert.equal(living.size, 0);
    } finally { Ammo.btRigidBody = Body; cleanupMesh(mesh); }
});

test('真实动作切换失败/过期只清理新物理，成功移除旧helper不覆盖新零帧', async () => {
    const { THREE, MMDAnimationHelper, makeMesh, cleanupMesh, makeHelper, living } = await fixture();
    const { prepareMotionSwitch } = await import('../3rd/mmd-ar-test/web-motion-switch.mjs');
    const { createPmxMotionHelper } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');
    const mesh = makeMesh();
    const old = makeHelper(mesh);
    const oldPhysics = old.objects.get(mesh).physics;
    const baseline = living.size;
    mesh.skeleton.bones[0].position.set(8, 9, 10);
    const clip = new THREE.AnimationClip('new', 1, [new THREE.VectorKeyframeTrack(
        '.bones[center].position', [0, 1], [3, 4, 5, 6, 7, 8])]);
    const options = { mesh, oldHelper: old, physicsEnabled: true, physicsFps: 65,
        playbackEnabled: false, isCurrent: () => true, ensurePhysics: async () => {},
        createHelper: () => createPmxMotionHelper({ mesh, clip, MMDAnimationHelper,
            loopRepeat: THREE.LoopRepeat, loopOnce: THREE.LoopOnce, physicsEnabled: false }) };
    const staged = await prepareMotionSwitch(options);
    assert.ok(living.size > baseline);
    staged.rollback(); staged.rollback();
    assert.equal(living.size, baseline);
    assert.deepEqual(mesh.skeleton.bones[0].position.toArray(), [8, 9, 10]);
    assert.equal(oldPhysics.disposed, false);
    const bad = await options.createHelper();
    bad.helper._optimizeIK = () => { throw new Error('新物理IK失败'); };
    await assert.rejects(prepareMotionSwitch({ ...options, createHelper: async () => bad }), /新物理IK失败/);
    assert.equal(living.size, baseline);
    old.update(1 / 65);
    const next = await prepareMotionSwitch(options);
    old.remove(mesh);
    assert.deepEqual(mesh.skeleton.bones[0].position.toArray(), [3, 4, 5]);
    assert.equal(oldPhysics.disposed, true);
    next.helper.update(1 / 65);
    next.helper.remove(mesh);
    assert.equal(living.size, 0);
    cleanupMesh(mesh);
});
