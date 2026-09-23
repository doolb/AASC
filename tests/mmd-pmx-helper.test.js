const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PMX_HELPER_PATH = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');

const loadFreshPmxHelperModule = () => import(`${pathToFileURL(PMX_HELPER_PATH).href}?test=${Date.now()}-${Math.random()}`);

const createHelperFixture = () => {
    const instances = [];
    class FakeMmdAnimationHelper {
        constructor() {
            this.objects = new Map();
            this.addCalls = [];
            instances.push(this);
        }

        add(mesh, options) {
            const action = {
                clampWhenFinished: false,
                loops: null,
                resetCalled: false,
                played: false,
                setLoop(loop, repetitions) {
                    this.loops = { loop, repetitions };
                },
                reset() {
                    this.resetCalled = true;
                    return this;
                },
                play() {
                    this.played = true;
                    return this;
                }
            };
            this.addCalls.push({ mesh, options });
            this.objects.set(mesh, { mixer: { _actions: [action] } });
        }
    }
    return { FakeMmdAnimationHelper, instances };
};

const createMesh = (rigidBodies) => ({ geometry: { userData: { MMD: { rigidBodies } } } });

const createAmmoVector = (x = 0, y = 0, z = 0) => {
    let values = [x, y, z];
    return {
        x: () => values[0],
        y: () => values[1],
        z: () => values[2],
        setValue(nextX, nextY, nextZ) {
            values = [nextX, nextY, nextZ];
        }
    };
};

const createAmmoQuaternion = (x = 0, y = 0, z = 0, w = 1) => {
    let values = [x, y, z, w];
    return {
        x: () => values[0],
        y: () => values[1],
        z: () => values[2],
        w: () => values[3],
        setValue(nextX, nextY, nextZ, nextW) {
            values = [nextX, nextY, nextZ, nextW];
        }
    };
};

const createAmmoTransform = (position = [0, 0, 0], rotation = [0, 0, 0, 1]) => {
    let origin = createAmmoVector(...position);
    let quaternion = createAmmoQuaternion(...rotation);
    return {
        getOrigin: () => origin,
        getRotation: () => quaternion,
        setIdentity() {
            origin = createAmmoVector(0, 0, 0);
            quaternion = createAmmoQuaternion(0, 0, 0, 1);
        },
        setOrigin(value) {
            origin = createAmmoVector(value.x(), value.y(), value.z());
        },
        setRotation(value) {
            quaternion = createAmmoQuaternion(value.x(), value.y(), value.z(), value.w());
        }
    };
};

const createPhysicsBody = ({ position, rotation, linearVelocity, angularVelocity }) => {
    let transform = createAmmoTransform(position, rotation);
    let motionTransform = null;
    let linear = createAmmoVector(...linearVelocity);
    let angular = createAmmoVector(...angularVelocity);
    let activations = 0;
    const copyTransform = (value) => createAmmoTransform(
        [value.getOrigin().x(), value.getOrigin().y(), value.getOrigin().z()],
        [value.getRotation().x(), value.getRotation().y(), value.getRotation().z(), value.getRotation().w()]
    );
    const body = {
        getCenterOfMassTransform: () => transform,
        setCenterOfMassTransform(value) {
            transform = copyTransform(value);
        },
        getMotionState: () => ({
            setWorldTransform(value) {
                motionTransform = copyTransform(value);
            }
        }),
        getLinearVelocity: () => linear,
        setLinearVelocity(value) {
            linear = createAmmoVector(value.x(), value.y(), value.z());
        },
        getAngularVelocity: () => angular,
        setAngularVelocity(value) {
            angular = createAmmoVector(value.x(), value.y(), value.z());
        },
        activate() {
            activations += 1;
        }
    };
    return {
        body,
        snapshot() {
            const currentOrigin = transform.getOrigin();
            const currentRotation = transform.getRotation();
            return {
                position: [currentOrigin.x(), currentOrigin.y(), currentOrigin.z()],
                rotation: [currentRotation.x(), currentRotation.y(), currentRotation.z(), currentRotation.w()],
                linearVelocity: [linear.x(), linear.y(), linear.z()],
                angularVelocity: [angular.x(), angular.y(), angular.z()],
                motionPosition: motionTransform
                    ? [motionTransform.getOrigin().x(), motionTransform.getOrigin().y(), motionTransform.getOrigin().z()]
                    : null,
                activations
            };
        }
    };
};

test('PMX 在最终场景中不可见地完成物理初始化', async () => {
    const { stagePmxMesh } = await loadFreshPmxHelperModule();
    const events = [];
    const mesh = createMesh([{}]);
    const pivot = {
        visible: true,
        updateWorldMatrix(updateParents, updateChildren) {
            events.push(`matrix:${updateParents}:${updateChildren}`);
        }
    };
    const scene = {
        add(value) {
            assert.equal(value, pivot);
            events.push('scene:add');
        },
        remove() {
            events.push('scene:remove');
        }
    };

    const result = await stagePmxMesh({
        scene,
        mesh,
        createPivot(value) {
            assert.equal(value, mesh);
            events.push('pivot:create');
            return pivot;
        },
        prepareHelper: async () => {
            assert.equal(pivot.visible, false);
            events.push('physics:prepare');
            return { helper: { id: 'physics-helper' } };
        }
    });

    assert.deepEqual(events, [
        'pivot:create',
        'scene:add',
        'matrix:true:true',
        'physics:prepare'
    ]);
    assert.equal(result.pivot, pivot);
    assert.deepEqual(result.preparedHelper, { helper: { id: 'physics-helper' } });
    assert.equal(pivot.visible, false);
});

test('PMX 场景物理初始化失败时移除不可见暂存枢轴', async () => {
    const { stagePmxMesh } = await loadFreshPmxHelperModule();
    const events = [];
    const pivot = {
        visible: true,
        updateWorldMatrix() {
            events.push('matrix:update');
        }
    };
    const scene = {
        add() {
            events.push('scene:add');
        },
        remove(value) {
            assert.equal(value, pivot);
            events.push('scene:remove');
        }
    };

    await assert.rejects(
        stagePmxMesh({
            scene,
            mesh: createMesh([{}]),
            createPivot: () => pivot,
            prepareHelper: async () => {
                events.push('physics:prepare');
                throw new Error('物理预热失败');
            }
        }),
        /物理预热失败/u
    );

    assert.deepEqual(events, [
        'scene:add',
        'matrix:update',
        'physics:prepare',
        'scene:remove'
    ]);
    assert.equal(pivot.visible, false);
});

test('含刚体的 PMX 在 Ammo 就绪后以 physics true 创建循环动作 helper', async () => {
    const { createPmxMotionHelper } = await loadFreshPmxHelperModule();
    const { FakeMmdAnimationHelper, instances } = createHelperFixture();
    const mesh = createMesh([{}]);
    const clip = { name: 'motion' };
    let physicsLoads = 0;

    const result = await createPmxMotionHelper({
        mesh,
        clip,
        playMode: 'loop',
        MMDAnimationHelper: FakeMmdAnimationHelper,
        loopRepeat: 'repeat',
        loopOnce: 'once',
        ensurePhysics: async () => { physicsLoads += 1; }
    });

    assert.equal(result.physicsEnabled, true);
    assert.equal(result.physicsError, null);
    assert.equal(physicsLoads, 1);
    assert.deepEqual(instances[0].addCalls, [{
        mesh,
        options: { animation: clip, physics: true, warmup: 0, unitStep: 1 / 65, maxStepNum: 3 }
    }]);
    const action = instances[0].objects.get(mesh).mixer._actions[0];
    assert.deepEqual(action.loops, { loop: 'repeat', repetitions: Infinity });
    assert.equal(action.played, true);
});

test('无刚体 PMX 不初始化 Ammo 且仍创建骨骼动作 helper', async () => {
    const { createPmxMotionHelper } = await loadFreshPmxHelperModule();
    const { FakeMmdAnimationHelper, instances } = createHelperFixture();
    const mesh = createMesh([]);

    const result = await createPmxMotionHelper({
        mesh,
        clip: { name: 'motion' },
        playMode: 'once',
        MMDAnimationHelper: FakeMmdAnimationHelper,
        loopRepeat: 'repeat',
        loopOnce: 'once',
        ensurePhysics: async () => { throw new Error('不应请求 Ammo'); }
    });

    assert.equal(result.physicsEnabled, false);
    assert.equal(result.physicsError, null);
    assert.equal(instances[0].addCalls[0].options.physics, false);
    const action = instances[0].objects.get(mesh).mixer._actions[0];
    assert.deepEqual(action.loops, { loop: 'once', repetitions: 1 });
    assert.equal(action.clampWhenFinished, true);
});

test('Ammo 初始化失败时 PMX 回退为无物理 helper 并保留 VMD', async () => {
    const { createPmxMotionHelper } = await loadFreshPmxHelperModule();
    const { FakeMmdAnimationHelper, instances } = createHelperFixture();
    const mesh = createMesh([{}]);
    const clip = { name: 'motion' };

    const result = await createPmxMotionHelper({
        mesh,
        clip,
        MMDAnimationHelper: FakeMmdAnimationHelper,
        loopRepeat: 'repeat',
        loopOnce: 'once',
        ensurePhysics: async () => { throw new Error('Ammo 不可用'); }
    });

    assert.equal(result.physicsEnabled, false);
    assert.match(result.physicsError.message, /Ammo 不可用/u);
    assert.deepEqual(instances[0].addCalls, [{ mesh, options: { animation: clip, physics: false } }]);
});

test('有刚体但没有 VMD 的 PMX 仍创建物理 helper', async () => {
    const { createPmxMotionHelper } = await loadFreshPmxHelperModule();
    const { FakeMmdAnimationHelper, instances } = createHelperFixture();
    const mesh = createMesh([{}]);

    const result = await createPmxMotionHelper({
        mesh,
        clip: null,
        MMDAnimationHelper: FakeMmdAnimationHelper,
        loopRepeat: 'repeat',
        loopOnce: 'once',
        ensurePhysics: async () => undefined
    });

    assert.equal(result.physicsEnabled, true);
    assert.deepEqual(instances[0].addCalls, [{
        mesh,
        options: { physics: true, warmup: 0, unitStep: 1 / 65, maxStepNum: 3 }
    }]);
});

test('PMX 先旋转并刷新骨骼矩阵，再推进物理且不直接传送动态刚体', async () => {
    const { advancePmxMotionFrame } = await loadFreshPmxHelperModule();
    const events = [];
    const trackedBody = createPhysicsBody({
        position: [2, 0, 0],
        rotation: [0, 0, 0, 1],
        linearVelocity: [5, 0, 0],
        angularVelocity: [0, 2, 0]
    });
    const pivot = {
        angle: 0,
        updateWorldMatrix(updateParents, updateChildren) {
            assert.equal(updateParents, true);
            assert.equal(updateChildren, true);
            events.push('matrix');
        }
    };
    const helper = {
        update(delta) {
            assert.equal(delta, 1 / 60);
            assert.equal(pivot.angle, 0.2);
            assert.deepEqual(trackedBody.snapshot(), {
                position: [2, 0, 0],
                rotation: [0, 0, 0, 1],
                linearVelocity: [5, 0, 0],
                angularVelocity: [0, 2, 0],
                motionPosition: null,
                activations: 0
            });
            events.push('physics');
        }
    };

    advancePmxMotionFrame({
        delta: 1 / 60,
        pivot,
        helper,
        advanceRotation() {
            pivot.angle = 0.2;
            events.push('rotation');
        }
    });

    assert.deepEqual(events, ['rotation', 'matrix', 'physics']);
});

test('没有 PMX 物理 helper 时仍推进旋转', async () => {
    const { advancePmxMotionFrame } = await loadFreshPmxHelperModule();
    const events = [];
    advancePmxMotionFrame({
        delta: 0.02,
        pivot: { updateWorldMatrix() { events.push('matrix'); } },
        helper: null,
        advanceRotation(delta) { events.push(`rotation:${delta}`); }
    });
    assert.deepEqual(events, ['rotation:0.02', 'matrix']);
});

test('PMX 快转暂停物理但保持动作，减速后对齐刚体并在下一帧恢复', async () => {
    const { advancePmxMotionFrame } = await loadFreshPmxHelperModule();
    const events = [];
    const velocities = { linear: 5, angular: 2 };
    const body = {
        setLinearVelocity(value) { velocities.linear = value.x(); },
        setAngularVelocity(value) { velocities.angular = value.x(); },
        clearForces() { events.push('clear-forces'); },
        activate() { events.push('activate'); }
    };
    const physics = {
        bodies: [{ params: { type: 1 }, body }],
        manager: {
            allocVector3() { return { x: () => 0, setValue() {} }; },
            freeVector3() {}
        },
        reset() { events.push('reset'); }
    };
    const helper = {
        enabled: { physics: true },
        update() {
            events.push('animation');
            if (this.enabled.physics) events.push('physics');
        }
    };
    const pivot = { updateWorldMatrix() { events.push('matrix'); } };
    const physicsGate = { paused: false };
    const frame = (rotationRadians) => advancePmxMotionFrame({
        delta: 1 / 60, pivot, helper, physics, physicsGate,
        rotationPhysicsLimit: 180,
        advanceRotation() { return rotationRadians; }
    });

    frame(0.2);
    assert.deepEqual(events, ['matrix', 'animation']);
    assert.equal(physicsGate.paused, true);
    events.length = 0;

    frame(0.01);
    assert.deepEqual(events, ['matrix', 'animation', 'matrix', 'reset', 'clear-forces', 'activate']);
    assert.deepEqual(velocities, { linear: 0, angular: 0 });
    assert.equal(physicsGate.paused, false);
    events.length = 0;

    frame(0.01);
    assert.deepEqual(events, ['matrix', 'animation', 'physics']);
});

test('PMX 旋转速度等于阈值及零时长帧不暂停物理', async () => {
    const { advancePmxMotionFrame } = await loadFreshPmxHelperModule();
    const helper = {
        enabled: { physics: true },
        updates: 0,
        update() { if (this.enabled.physics) this.updates += 1; }
    };
    const options = {
        delta: 1 / 60,
        helper,
        physics: { reset() {} },
        physicsGate: { paused: false },
        rotationPhysicsLimit: 180,
        advanceRotation() { return Math.PI / 60; }
    };
    advancePmxMotionFrame(options);
    assert.equal(helper.updates, 1);
    assert.equal(options.physicsGate.paused, false);
    advancePmxMotionFrame({ ...options, delta: 0, advanceRotation() { return 1; } });
    assert.equal(helper.updates, 2);
    assert.equal(options.physicsGate.paused, false);
});
