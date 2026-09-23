const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const AMMO_DIR = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs');
const PHYSICS_PATH = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/animation/MMDPhysics.js');
const PMX_HELPER_URL = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');

const loadPhysicsRuntime = async () => {
    const AmmoFactory = require(path.join(AMMO_DIR, 'ammo.wasm.js'));
    globalThis.Ammo = await AmmoFactory({
        wasmBinary: fs.readFileSync(path.join(AMMO_DIR, 'ammo.wasm.wasm'))
    });
    const THREE = await import('three');
    const { pathToFileURL } = require('node:url');
    // 执行浏览器实际使用的内置源码（含本地补丁），只将裸模块地址解析到同版本 Three。
    const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
    const source = fs.readFileSync(PHYSICS_PATH, 'utf8').replace("from 'three'", `from '${threeUrl}'`);
    const { MMDPhysics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const { advancePmxMotionFrame } = await import(pathToFileURL(PMX_HELPER_URL).href);
    return { THREE, MMDPhysics, advancePmxMotionFrame };
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
        const physics = new MMDPhysics(mesh, [rigidBodyParams(0, 0)], []);
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
    });
}
