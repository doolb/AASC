const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const AMMO_DIR = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs');
const PHYSICS_PATH = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/animation/MMDPhysics.js');
const PMX_HELPER_URL = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');

const loadPhysicsRuntime = async () => {
    // 测试执行 npm 的同版本模块；先核对它与显示端内置文件逐字节一致。
    assert.deepEqual(fs.readFileSync(PHYSICS_PATH), fs.readFileSync(require.resolve('three/addons/animation/MMDPhysics.js')));
    const AmmoFactory = require(path.join(AMMO_DIR, 'ammo.wasm.js'));
    globalThis.Ammo = await AmmoFactory({
        wasmBinary: fs.readFileSync(path.join(AMMO_DIR, 'ammo.wasm.wasm'))
    });
    const THREE = await import('three');
    const { pathToFileURL } = require('node:url');
    const { MMDPhysics } = await import('three/addons/animation/MMDPhysics.js');
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
