const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const AMMO_DIR = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs');
const PHYSICS_PATH = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/animation/MMDPhysics.js');
const PMX_HELPER_URL = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');

let runtimePromise;
const loadPhysicsRuntime = () => {
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
    const AmmoFactory = require(path.join(AMMO_DIR, 'ammo.wasm.js'));
    globalThis.Ammo = await AmmoFactory({
        wasmBinary: fs.readFileSync(path.join(AMMO_DIR, 'ammo.wasm.wasm'))
    });
    const THREE = await import('three');
    const { pathToFileURL } = require('node:url');
    // 执行浏览器实际使用的内置源码（含本地补丁），只将裸模块地址解析到同版本 Three。
    const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
    const source = fs.readFileSync(PHYSICS_PATH, 'utf8').replace(/from\s+(['"])([^'"]+)\1/gu,
        (match, quote, ref) => `from ${quote}${ref === 'three' ? threeUrl : new URL(ref, pathToFileURL(PHYSICS_PATH)).href}${quote}`);
    const { MMDPhysics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const { advancePmxMotionFrame } = await import(pathToFileURL(PMX_HELPER_URL).href);
        return { THREE, MMDPhysics, advancePmxMotionFrame };
    })();
    return runtimePromise;
};

const rigidBodyParams = (type, boneIndex) => ({
    type,
    boneIndex,
    shapeType: 0,
    width: 0.1,
    height: 0.1,
    depth: 0.1,
    weight: type === 0 ? 0 : 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    friction: 0,
    restitution: 0,
    positionDamping: 0,
    rotationDamping: 0,
    groupIndex: 0,
    groupTarget: 65535
});

const jointParams = (axis) => ({
    rigidBodyIndex1: 0,
    rigidBodyIndex2: 1,
    position: axis === 'x' ? [1.5, 0, 0] : [0, 1.5, 0],
    rotation: [0, 0, 0],
    translationLimitation1: [0, 0, 0],
    translationLimitation2: [0, 0, 0],
    rotationLimitation1: [-1, -1, -1],
    rotationLimitation2: [1, 1, 1],
    springPosition: [0, 0, 0],
    springRotation: [0, 0, 0]
});

const origin = (entry) => {
    const value = entry.body.getCenterOfMassTransform().getOrigin();
    return [value.x(), value.y(), value.z()];
};

for (const axes of ['x', 'y', 'xy']) {
    test(`PMX ${axes} 连续中心缓动保持世界锚点且不误触缩放分支`, async () => {
        const { THREE, MMDPhysics, advancePmxMotionFrame } = await loadPhysicsRuntime();
        const pivot = new THREE.Group();
        pivot.position.y = 10;
        const mesh = new THREE.Object3D();
        mesh.position.y = -10;
        const bone = new THREE.Bone();
        bone.position.set(2, 12, 1);
        mesh.add(bone);
        mesh.skeleton = { bones: [bone] };
        pivot.add(mesh);
        pivot.updateWorldMatrix(true, true);
        // 此用例比较每个画面帧终点，显式匹配步长；90Hz/60fps的中间采样由子步测试覆盖。
        const physics = new MMDPhysics(mesh, [rigidBodyParams(0, 0)], [], { unitStep: 1 / 60 });
        let detached = 0;
        const updateRigidBodies = physics._updateRigidBodies;
        physics._updateRigidBodies = function () {
            if (mesh.parent === null) detached += 1;
            return updateRigidBodies.call(this);
        };
        for (let frame = 1; frame <= 180; frame += 1) {
            let expected;
            advancePmxMotionFrame({
                delta: 1 / 60, pivot, helper: physics,
                advanceRotation() {
                    for (const axis of axes) pivot.rotation[axis] = 1 - Math.exp(-frame / 60 / 0.14);
                    pivot.updateWorldMatrix(true, true);
                    expected = bone.getWorldPosition(new THREE.Vector3());
                }
            });
            const actual = new THREE.Vector3(...origin(physics.bodies[0]));
            assert.ok(actual.distanceTo(expected) < 0.001, `第 ${frame} 帧锚点偏离世界位置`);
        }
        assert.equal(detached, 0);
        physics.dispose();
    });
}

test('PMX 各轴单位缩放采用 0.001 容差，超过容差仍处理真实缩放', async () => {
    const { THREE, MMDPhysics } = await loadPhysicsRuntime();
    for (const axis of ['x', 'y', 'z']) {
        for (const [scale, expectedDetached] of [[0.9991, false], [1.0009, false], [0.9989, true], [1.0011, true]]) {
            const pivot = new THREE.Group();
            const mesh = new THREE.Object3D();
            mesh.skeleton = { bones: [] };
            pivot.add(mesh);
            pivot.updateWorldMatrix(true, true);
            const physics = new MMDPhysics(mesh, [], []);
            mesh.scale[axis] = scale;
            pivot.updateWorldMatrix(true, true);
            let detached;
            physics._updateRigidBodies = () => { detached = mesh.parent === null; };
            physics.update(1 / 60);
            assert.equal(detached, expectedDetached, `${axis}=${scale}`);
            assert.equal(mesh.parent, pivot);
            assert.equal(mesh.scale[axis], scale);
            physics.dispose();
        }
    }
});

for (const [label, axis, rotationAxis, direction] of [
    ['水平 yaw', 'x', 'y', -1],
    ['上下 pitch', 'y', 'x', 1]
]) {
    test(`PMX ${label} 时 Ammo 锚点先移动而动态布料由约束牵引`, async () => {
        const { THREE, MMDPhysics, advancePmxMotionFrame } = await loadPhysicsRuntime();
        const pivot = new THREE.Group();
        const mesh = new THREE.Object3D();
        const anchorBone = new THREE.Bone();
        const clothBone = new THREE.Bone();
        anchorBone.position[axis] = 1;
        clothBone.position[axis] = 2;
        mesh.add(anchorBone, clothBone);
        mesh.skeleton = { bones: [anchorBone, clothBone] };
        pivot.add(mesh);
        pivot.updateWorldMatrix(true, true);

        const physics = new MMDPhysics(
            mesh,
            [rigidBodyParams(0, 0), rigidBodyParams(1, 1)],
            [jointParams(axis)],
            { gravity: new THREE.Vector3(0, 0, 0), unitStep: 1 / 60, maxStepNum: 1 }
        );
        assert.equal(origin(physics.bodies[1])[2], 0);

        advancePmxMotionFrame({
            delta: 1 / 60,
            pivot,
            helper: physics,
            advanceRotation() { pivot.rotation[rotationAxis] = 0.2; }
        });

        const anchorZ = origin(physics.bodies[0])[2];
        const clothZ = origin(physics.bodies[1])[2];
        assert.ok(Math.abs(anchorZ - direction * Math.sin(0.2)) < 0.001);
        assert.ok(clothZ * direction > 0.001, '约束应拉动动态刚体');
        assert.ok(Math.abs(clothZ) < 0.2, '动态刚体不应随枢轴直接传送到新位置');
        assert.ok(Math.abs(physics.bodies[1].body.getLinearVelocity().z()) > 0.01);
        physics.dispose();
    });
}

// 使用真实Ammo和XPBD检验位置/角速度，避免只检查helper调用顺序而漏掉恢复冲量。
for (const engine of ['ammo', 'xpbd']) {
    test(`${engine} 暂停同步保留已变形布料，连续128帧不重置为绑定姿态或累积分配`, async () => {
        const { THREE, MMDPhysics, advancePmxMotionFrame } = await loadPhysicsRuntime();
        const { XpbdPmxPhysics } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-xpbd-physics.mjs');
        const pivot = new THREE.Group(), mesh = new THREE.Object3D(), bone = new THREE.Bone();
        bone.position.set(2, 1, 0); mesh.add(bone); mesh.skeleton = { bones: [bone] };
        pivot.add(mesh); pivot.updateWorldMatrix(true, true);
        const physics = new (engine === 'ammo' ? MMDPhysics : XpbdPmxPhysics)(mesh,
            [{ ...rigidBodyParams(1, 0), groupTarget: 0 }], [], { gravity: new THREE.Vector3() });
        const entry = physics.bodies[0];
        const deformation = new THREE.Vector3(2.2, 1.4, 0.3);
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.2, 0.1));
        if (entry.body) {
            const form = physics.manager.allocTransform();
            try {
                physics.manager.setOriginFromThreeVector3(form, deformation);
                physics.manager.setBasisFromThreeQuaternion(form, rotation);
                entry.body.setCenterOfMassTransform(form); entry.body.getMotionState().setWorldTransform(form);
            } finally { physics.manager.freeTransform(form); }
        } else { entry.position.copy(deformation); entry.quaternion.copy(rotation); }
        const helper = { enabled: { physics: true, animation: true }, update(delta) {
            // 动画重新给出绑定姿态，冻结布料必须仍保留真实物理变形。
            bone.position.set(2, 1, 0); bone.quaternion.identity();
            if (this.enabled.physics) physics.update(delta);
        } };
        const gate = { paused: false };
        let allocations;
        try {
            for (let index = 0; index < 128; index++) {
                const angle = index === 127 ? 0 : (index % 2 ? -0.2 : 0.3);
                advancePmxMotionFrame({ delta: 1 / 60, pivot, helper, physics, physicsGate: gate,
                    rotationPhysicsLimit: 180, advanceRotation() { pivot.rotation.y += angle; return Math.abs(angle); } });
                assert.ok(bone.position.distanceTo(deformation) < 2e-5, '暂停前的变形不能丢失');
                assert.ok(bone.quaternion.angleTo(rotation) < 5e-4, '暂停前的布料方向不能丢失');
                if (physics.manager) {
                    if (index === 0) allocations = physics.manager.nativeObjects.size;
                    assert.equal(physics.manager.nativeObjects.size, allocations, '重复同步复用native池');
                }
            }
            assert.equal(gate.paused, false);
        } finally {
            physics.dispose();
            if (physics.manager) assert.equal(physics.manager.nativeObjects.size, 0);
        }
    });
}

for (const engine of ['ammo', 'xpbd']) {
    for (const axes of ['y', 'x', 'xy']) {
        for (const scale of [1, 0.1]) {
            test(`${engine} ${axes} 缩放${scale} 多帧暂停/反转保持布料形状，恢复不追赶旧位置`, async () => {
                const { THREE, MMDPhysics, advancePmxMotionFrame } = await loadPhysicsRuntime();
                const { XpbdPmxPhysics } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-xpbd-physics.mjs');
                const pivot = new THREE.Group();
                pivot.position.set(4, 2, -3);
                pivot.scale.setScalar(scale);
                const mesh = new THREE.Object3D();
                mesh.position.set(-0.2, 0.1, 0.3);
                const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
                bones.forEach((bone, index) => { bone.position.set(index + 1, 1, 0); mesh.add(bone); });
                mesh.skeleton = { bones };
                pivot.add(mesh); pivot.updateWorldMatrix(true, true);
                const params = [rigidBodyParams(0, 0), rigidBodyParams(1, 1),
                    { ...rigidBodyParams(2, 2), rotation: [0.1, -0.2, 0.3] }]
                    .map((body) => ({ ...body, groupTarget: 0 }));
                const physics = new (engine === 'ammo' ? MMDPhysics : XpbdPmxPhysics)(mesh, params,
                    [{ ...jointParams('x'), position: [1.5, 1, 0] }],
                    { gravity: new THREE.Vector3(), unitStep: 1 / 90, maxStepNum: 10, stabilityReferenceHz: 10 });
                const pose = (entry) => {
                    if (!entry.body) return { position: entry.position.clone(), quaternion: entry.quaternion.clone(),
                        velocity: entry.velocity.clone(), omega: entry.omega.clone() };
                    const form = entry.body.getCenterOfMassTransform(), p = form.getOrigin(), q = form.getRotation();
                    const v = entry.body.getLinearVelocity(), w = entry.body.getAngularVelocity();
                    return { position: new THREE.Vector3(p.x(), p.y(), p.z()),
                        quaternion: new THREE.Quaternion(q.x(), q.y(), q.z(), q.w()).normalize(),
                        velocity: new THREE.Vector3(v.x(), v.y(), v.z()), omega: new THREE.Vector3(w.x(), w.y(), w.z()) };
                };
                const effectiveMatrix = () => scale === 1 ? mesh.matrixWorld.clone()
                    : new THREE.Matrix4().compose(mesh.position, mesh.quaternion, new THREE.Vector3(1, 1, 1));
                const clothLocal = bones[1].position.clone();
                const animationPoses = bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
                let updates = 0, simulations = 0;
                const helper = { enabled: { physics: true, animation: true }, update(delta) {
                    updates += 1;
                    // 模拟真实VMD每帧恢复骨骼基础姿态，物理同步必须再回写冻结布料。
                    if (this.enabled.animation) bones.forEach((bone, index) => {
                        bone.position.copy(animationPoses[index].position); bone.quaternion.copy(animationPoses[index].quaternion);
                    });
                    if (this.enabled.physics) { physics.update(delta); simulations += 1; }
                } };
                const physicsGate = { paused: false };
                try {
                    physics.update(1 / 60);
                    const initial = physics.bodies.map(pose);
                    const inverseInitial = effectiveMatrix().invert();
                    for (const [index, radians] of [0.25, 0.3, -0.4, -0.25, 0.001].entries()) {
                        // 同时覆盖播放暂停；暂停物理不可强制开启被用户关闭的动画。
                        helper.enabled.animation = index % 2 === 0;
                        advancePmxMotionFrame({ delta: 1 / 60, pivot, helper, physics, physicsGate,
                            rotationPhysicsLimit: 180, advanceRotation() {
                                for (const axis of axes) pivot.rotation[axis] += radians;
                                if (scale !== 1) for (const axis of axes) mesh.rotation[axis] += radians;
                                return Math.abs(radians) * Math.sqrt(axes.length);
                            } });
                        const change = effectiveMatrix().multiply(inverseInitial);
                        const rotation = new THREE.Quaternion().setFromRotationMatrix(change).normalize();
                        for (const [bodyIndex, entry] of physics.bodies.entries()) {
                            const actual = pose(entry);
                            const expectedPosition = initial[bodyIndex].position.clone().applyMatrix4(change);
                            const expectedQuaternion = initial[bodyIndex].quaternion.clone().premultiply(rotation);
                            assert.ok(actual.position.distanceTo(expectedPosition) < 2e-5, `${bodyIndex}整体同步位置`);
                            assert.ok(actual.quaternion.angleTo(expectedQuaternion) < 5e-4, `${bodyIndex}整体同步旋转`);
                            assert.ok(actual.velocity.length() < 1e-6 && actual.omega.length() < 1e-6, '暂停没有残留速度');
                            if (entry.body) {
                                const form = physics.manager.allocTransform();
                                try {
                                    entry.body.getMotionState().getWorldTransform(form);
                                    const p = form.getOrigin();
                                    assert.ok(new THREE.Vector3(p.x(), p.y(), p.z()).distanceTo(actual.position) < 1e-5);
                                } finally { physics.manager.freeTransform(form); }
                            } else {
                                assert.ok(entry.previousPosition.distanceTo(actual.position) < 1e-10);
                                assert.ok(entry.previousTargetPosition.distanceTo(actual.position) < 1e-10);
                            }
                        }
                        assert.ok(bones[1].position.distanceTo(clothLocal) < 2e-5, '可见布料相对形状保持');
                        assert.equal(physicsGate.paused, index < 4);
                        assert.equal(helper.enabled.animation, index % 2 === 0);
                        assert.equal(simulations, 0, '暂停和恢复帧不求解');
                        assert.equal(mesh.parent, pivot); assert.equal(pivot.scale.x, scale);
                    }
                    advancePmxMotionFrame({ delta: 1 / 60, pivot, helper, physics, physicsGate,
                        rotationPhysicsLimit: 180, advanceRotation: () => 0 });
                    assert.equal(updates, 6); assert.equal(simulations, 1);
                    for (const entry of physics.bodies) {
                        const actual = pose(entry);
                        assert.ok(actual.velocity.length() < 0.01, `恢复首步不追赶旧位置：${actual.velocity.length()}`);
                        assert.ok(actual.omega.length() < 0.01, `运动学历史无旧旋转：${actual.omega.length()}`);
                    }
                } finally {
                    physics.dispose(); physics.syncPausedTransform();
                    if (physics.manager) assert.equal(physics.manager.nativeObjects.size, 0);
                }
            });
        }
    }
}
