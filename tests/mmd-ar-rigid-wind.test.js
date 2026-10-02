'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} / ${b}`);
const params = { type: 1, boneIndex: -1, shapeType: 0, width: 0.1, height: 0.2, depth: 0.3,
    weight: 0.001, position: [0, 0, 0], rotation: [0, 0, 0], positionDamping: 0,
    rotationDamping: 0, friction: 0, restitution: 0, groupIndex: 0, groupTarget: 0 };
const zero = { x: 0, y: 0, z: 0 }, identity = { x: 0, y: 0, z: 0, w: 1 };
const direction = { x: 1, y: 0, z: 0 };
const windPromise = import('../3rd/mmd-ar-test/web-physics-wind.mjs');

test('碰撞代理投影面积覆盖球、薄盒、胶囊正侧面及坏尺寸', async () => {
    const { rigidWindProjectedArea: area } = await windPromise;
    near(area({ ...params, width: 2 }, 1, 0, 0), 4 * Math.PI);
    const box = { ...params, shapeType: 1, width: 2, height: 3, depth: 0.1 };
    near(area(box, 0, 0, 1), 24); near(area(box, 1, 0, 0), 1.2);
    near(area(box, 0, 0, -1), 24);
    const capsule = { ...params, shapeType: 2, width: 1, height: 4 };
    near(area(capsule, 0, 1, 0), Math.PI); near(area(capsule, 1, 0, 0), Math.PI + 8);
    for (const invalid of [{ width: NaN }, { width: 0 }, { height: -1 }, { depth: Infinity }, { shapeType: 5 }]) {
        assert.equal(area({ ...params, ...invalid }, 1, 0, 0), 0);
    }
});

test('相对气流同速无力、逆风更强、超风速产生反向阻力，朝向与质量分别参与', async () => {
    const { calculateRigidWindForce: force } = await windPromise;
    const out = {}, speed = Math.sqrt(20);
    const evaluate = (velocity, p = params, q = identity) => {
        force(out, p, q, { x: velocity, y: 0, z: 0 }, zero, zero, zero, direction, 1, 1 / 90);
        return out.x;
    };
    near(evaluate(speed), 0);
    const resting = evaluate(0), following = evaluate(speed / 2), opposing = evaluate(-speed / 2);
    assert.ok(opposing > resting && resting > following && following > 0);
    assert.ok(evaluate(speed * 2) < 0);
    const box = { ...params, shapeType: 1, width: 2, height: 3, depth: 0.1, weight: 10 };
    const side = evaluate(0, box);
    const rotated = evaluate(0, box, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
    assert.ok(rotated > side * 10);
    const heavyForce = evaluate(0, { ...params, weight: 1 });
    assert.ok(heavyForce > resting);
    assert.ok(heavyForce < resting * 1000, '同面积的风力不再直接与质量成正比');
});

test('强风和极小质量每步不越过气流速度，阻力耗散相对动能', async () => {
    const { calculateRigidWindForce: force } = await windPromise;
    for (const weight of [1e-10, 0.001, 1]) {
        for (const h of [1 / 10, 1 / 45, 1 / 180, 1 / 10800]) {
            const p = { ...params, weight }, speed = Math.sqrt(600), out = {};
            for (const initial of [-100, 0, speed * 3]) {
                const velocity = { x: initial, y: 0, z: 0 };
                for (let i = 0; i < 100; i += 1) {
                    const before = velocity.x;
                    force(out, p, identity, velocity, zero, zero, zero, direction, 30, h);
                    velocity.x += h * out.x / weight;
                    assert.ok(Number.isFinite(velocity.x));
                    assert.ok(Math.abs(velocity.x - speed) <= Math.abs(before - speed) + 1e-10);
                    assert.ok((before - speed) * (velocity.x - speed) >= -1e-8);
                }
            }
        }
    }
});

test('type2角速度参与受力点风速，极小惯量隐式衰减且零偏移无风矩', async () => {
    const { calculateRigidWindForce: force } = await windPromise;
    const p = { ...params, type: 2, boneIndex: 0 }, out = {}, lever = { x: 0, y: 0.3, z: 0 };
    const inertia = { x: 1e-12, y: 1e-12, z: 1e-12 }, h = 1 / 45;
    force(out, p, identity, zero, zero, lever, inertia, direction, 30, h);
    const torqueZ = -lever.y * out.x, newOmegaZ = h * torqueZ / inertia.z;
    assert.ok(Number.isFinite(newOmegaZ));
    assert.ok(-newOmegaZ * lever.y <= Math.sqrt(600) + 1e-9);
    const omega = { x: 0, y: 0, z: -Math.sqrt(600) / lever.y };
    force(out, p, identity, zero, omega, lever, inertia, direction, 30, h);
    near(out.x, 0);
    force(out, { ...params, type: 0 }, identity, zero, zero, zero, zero, direction, 30, h);
    assert.deepEqual(out, zero);
    // 一轴惯量远小于另一轴且气流斜入射，阻力仍不能把受力点速度吹过气流。
    const skewDirection = { x: Math.sqrt(1 - 0.01 ** 2), y: 0, z: 0.01 };
    const skewInertia = { x: 1e-12, y: 1, z: 1 };
    force(out, p, identity, zero, zero, lever, skewInertia, skewDirection, 30, h);
    const vx = h * lever.y ** 2 * out.x / skewInertia.z;
    const vz = h * lever.y ** 2 * out.z / skewInertia.x;
    const speed = Math.sqrt(600);
    assert.ok(Math.hypot(speed * skewDirection.x - vx, speed * skewDirection.z - vz) <= speed + 1e-9);
    assert.ok(vz <= speed * skewDirection.z + 1e-9);
});

test('阵风0空间一致，非零阵风连续且可重复，暂停和关闭不推进模拟相位', async () => {
    const { sampleRigidWindStrength: sample, createWindState, advanceWindState, normalizeWindSettings } = await windPromise;
    near(sample(1, 2, 0, zero), sample(1, 2, 0, { x: 100, y: 8, z: -10 }));
    const position = { x: 3, y: 2, z: 4 };
    assert.notEqual(sample(1, 2, 100, zero), sample(1, 2, 100, position));
    near(sample(1, 2, 100, position), sample(1, 2, 100, position));
    near(sample(1, 2, 100, position), sample(1, 2 + 1e-8, 100, { ...position, x: 3 + 1e-8 }), 1e-7);
    const state = createWindState(), settings = normalizeWindSettings({ enabled: true, strength: 30, gust: 100 });
    advanceWindState(state, 1 / 90, settings, false);
    const previous = { ...state }; advanceWindState(state, 0, settings, false);
    assert.deepEqual(state, previous);
    advanceWindState(state, 1, { ...settings, enabled: false }, false); near(state.time, previous.time);
});

async function createXpbd(bodyParams = [params], substeps = 45) {
    const THREE = await import('three');
    const { XpbdPmxPhysics } = await import('../3rd/mmd-ar-test/web-xpbd-physics.mjs');
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
    const physics = new XpbdPmxPhysics(mesh, bodyParams, [], { gravity: new THREE.Vector3(), stabilityReferenceHz: substeps });
    return { THREE, mesh, bone, physics, dispose() { physics.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); } };
}

test('真实XPBD包装在3/10/45/180子步和30/60FPS受风有限且近似一致，关闭保持速度', async () => {
    const velocities = [], positions = [];
    for (const substeps of [3, 10, 45, 180]) {
        for (const fps of [30, 60]) {
            const f = await createXpbd(undefined, substeps);
            try {
                f.physics.setWindSettings({ enabled: true, strength: 30, longitude: -90 });
                for (let i = 0; i < fps; i += 1) f.physics.update(1 / fps);
                const body = f.physics.bodies[0], before = body.velocity.x;
                assert.ok(before > 10 && before <= Math.sqrt(600) + 1e-8);
                near(body.velocity.y, 0); near(body.velocity.z, 0);
                velocities.push(before); positions.push(body.position.x);
                f.physics.setWindSettings({ enabled: false }); f.physics.update(1 / fps);
                near(body.velocity.x, before, 1e-8);
            } finally { f.dispose(); }
        }
    }
    assert.ok(Math.max(...velocities) - Math.min(...velocities) < 0.5);
    assert.ok(Math.max(...positions) - Math.min(...positions) < 0.5);
});

test('XPBD type2保持骨骼位置及12rad/s²风矩限幅，type0不受风', async () => {
    const f = await createXpbd([{ ...params, type: 2, boneIndex: 0, position: [0, 0.3, 0] },
        { ...params, type: 0, boneIndex: -1, position: [10, 0, 0] }]);
    try {
        f.physics.setWindSettings({ enabled: true, strength: 30, longitude: -90 });
        f.physics.windState.strength = 30;
        f.physics.windSceneRotation.identity(); f.physics.windSceneMatrix.copy(f.mesh.matrixWorld);
        f.physics._applyWind(1 / 90);
        const body = f.physics.bodies[0];
        assert.ok(Math.abs(body.torque.z) <= body.inertia.z * 12 + 1e-12);
        for (let i = 0; i < 60; i += 1) f.physics.update(1 / 60);
        assert.deepEqual(f.bone.position.toArray(), [0, 0, 0]);
        assert.ok(Math.abs(body.omega.z) > 0.01 && Math.abs(body.omega.z) <= 12.01);
        assert.deepEqual(f.physics.bodies[1].velocity.toArray(), [0, 0, 0]);
    } finally { f.dispose(); }
});

test('XPBD非单位缩放旋转下世界风向固定，空间阵风按真实世界位置采样', async () => {
    const f = await createXpbd();
    const pivot = new f.THREE.Group(); pivot.rotation.y = Math.PI / 2; pivot.scale.setScalar(0.1); pivot.position.set(8, 2, 3); pivot.add(f.mesh);
    pivot.updateMatrixWorld(true);
    try {
        f.physics.setWindSettings({ enabled: true, strength: 30, longitude: -90, gust: 50 });
        for (let i = 0; i < 60; i += 1) f.physics.update(1 / 60);
        const worldVelocity = f.physics.bodies[0].velocity.clone().applyQuaternion(pivot.quaternion);
        assert.ok(worldVelocity.x > 10); near(worldVelocity.y, 0); near(worldVelocity.z, 0, 1e-7);
        const { sampleRigidWindStrength } = await windPromise;
        const body = f.physics.bodies[0];
        f.physics._withPhysicsSpace(() => {
            f.physics._applyWind(1 / 90);
            const expectedPosition = body.position.clone().applyMatrix4(f.mesh.matrixWorld.clone().invert()
                .premultiply(f.physics.windSceneMatrix));
            near(f.physics.windSamplingPosition.distanceTo(expectedPosition), 0);
            assert.ok(Number.isFinite(sampleRigidWindStrength(30, 1, 50, expectedPosition)));
        });
    } finally { pivot.remove(f.mesh); f.dispose(); }
});

test('真实米娅XPBD强风下刚体/骨骼姿态有限，释放后缓存清空', { timeout: 60000 }, async () => {
    const THREE = await import('three');
    const { XpbdPmxPhysics } = await import('../3rd/mmd-ar-test/web-xpbd-physics.mjs');
    const { MMDLoader } = await import('three/addons/loaders/MMDLoader.js');
    const { MMDParser } = await import(pathToFileURL(path.resolve(__dirname,
        '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/mmdparser.module.js')).href);
    const bytes = fs.readFileSync(path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist/mmd/miya/miya.pmx'));
    const data = new MMDParser.Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
    const loader = new MMDLoader(); loader.meshBuilder.materialBuilder.build = () => data.materials.map(() => new THREE.MeshBasicMaterial());
    const mesh = loader.meshBuilder.build(data, ''); mesh.updateMatrixWorld(true);
    const metadata = mesh.geometry.userData.MMD;
    const physics = new XpbdPmxPhysics(mesh, metadata.rigidBodies, metadata.constraints, { stabilityReferenceHz: 45 });
    try {
        physics.setWindSettings({ enabled: true, strength: 30, longitude: 45, latitude: 20, gust: 50 });
        for (let i = 0; i < 60; i += 1) physics.update(1 / 60);
        for (const body of physics.bodies) {
            assert.ok([...body.position.toArray(), ...body.quaternion.toArray(), ...body.omega.toArray()].every(Number.isFinite));
            assert.ok(body.position.length() < 1000);
        }
    } finally {
        physics.dispose(); physics.dispose(); assert.equal(physics.bodies.length, 0);
        mesh.geometry.dispose(); for (const material of mesh.material) material.dispose();
    }
});

test('网页生成的Ammo模块实际执行新阻力且原生资源完全释放', async () => {
    const THREE = await import('three');
    const generated = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist/js/vendor/three/animation/MMDPhysics.js');
    const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
    const source = fs.readFileSync(generated, 'utf8').replace(/from\s+(['"])([^'"]+)\1/gu,
        (match, quote, ref) => `from ${quote}${ref === 'three' ? threeUrl : new URL(ref, pathToFileURL(generated)).href}${quote}`);
    const { MMDPhysics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs');
    globalThis.Ammo = await require(path.join(vendor, 'ammo.wasm.js'))({ wasmBinary: fs.readFileSync(path.join(vendor, 'ammo.wasm.wasm')) });
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
    const physics = new MMDPhysics(mesh, [params], [], { gravity: new THREE.Vector3(), unitStep: 1 / 180, maxStepNum: 30 });
    try {
        physics.setWindSettings({ enabled: true, strength: 30, longitude: -90 });
        for (let i = 0; i < 60; i += 1) physics.update(1 / 60);
        const velocity = physics.bodies[0].body.getLinearVelocity();
        assert.ok(velocity.x() > 10 && velocity.x() <= Math.sqrt(600) + 1e-5);
        assert.ok(physics.windSceneMatrix && physics.windScratch.matrix, '生成副本必须包含本次坐标采样');
    } finally {
        const manager = physics.manager; physics.dispose(); assert.equal(manager.nativeObjects.size, 0);
        mesh.geometry.dispose(); mesh.material.dispose();
    }
});
