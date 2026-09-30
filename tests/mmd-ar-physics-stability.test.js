'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { addPhysicsLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
const { addPhysicsSubsteps } = require('../3rd/mmd-ar-test/web-physics-substeps');
const { addPhysicsStability } = require('../3rd/mmd-ar-test/web-physics-stability');
const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three');
const modelPath = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist/mmd/miya/miya.pmx');
const encode = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let fixturePromise;

async function fixture() {
    if (fixturePromise) return fixturePromise;
    fixturePromise = (async () => {
        const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const THREE = await import(threeUrl);
        const original = fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8');
        const baseline = addPhysicsSubsteps(addPhysicsLifecycle(original)).replace("from 'three'", `from '${threeUrl}'`);
        const { MMDPhysics: BaselinePhysics } = await import(encode(baseline));
        const { MMDPhysics } = await import(encode(addPhysicsStability(baseline)));
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({
            wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        const { getWebPhysicsStepOptions } = await import('../3rd/mmd-ar-test/web-physics-rate.mjs');
        return { THREE, MMDPhysics, BaselinePhysics, getWebPhysicsStepOptions };
    })();
    return fixturePromise;
}

function near(actual, expected, tolerance = 2e-5) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 应接近 ${expected}，允许误差${tolerance}`);
}

const base = { shapeType: 0, width: 0.1, height: 0.1, depth: 0.1,
    weight: 0.001, rotation: [0, 0, 0], friction: 0, restitution: 0,
    positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 0 };

async function create(fps = 180, options = {}) {
    const { THREE, MMDPhysics, getWebPhysicsStepOptions } = await fixture();
    const parent = new THREE.Bone();
    const child = new THREE.Bone();
    parent.add(child); child.position.y = 1;
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.add(parent); mesh.bind(new THREE.Skeleton([parent, child]));
    const bodies = options.bodies || [
        { ...base, type: 2, boneIndex: 1, position: [0, 0, 0], ...options.controlled },
        { ...base, type: 1, boneIndex: -1, position: [3, 0, 0] },
        { ...base, type: 2, boneIndex: -1, position: [6, 0, 0] }];
    const physics = new MMDPhysics(mesh, bodies, options.constraints || [], {
        ...getWebPhysicsStepOptions(fps), gravity: new THREE.Vector3(0, -9.8, 0) });
    const cleanup = () => {
        physics.dispose();
        assert.equal(physics.manager.nativeObjects.size, 0);
        assert.equal(physics.anchorSamples.length, 0);
        mesh.geometry.dispose(); mesh.material.dispose();
    };
    return { THREE, physics, mesh, parent, child, cleanup };
}

test('type2位置按子步端点驱动且旋转保留，原线性阻尼为1也能跟随，无帧末COM跳变', async () => {
    const { THREE, physics, mesh, parent, child, cleanup } = await create(180, { controlled: { positionDamping: 1 } });
    const controlled = physics.bodies[0].body;
    const free = physics.bodies[1].body;
    const unbound = physics.bodies[2].body;
    const vector = physics.manager.allocVector3();
    const steps = [];
    const step = physics.world.stepSimulation.bind(physics.world);
    let teleports = 0;
    const setTransform = controlled.setCenterOfMassTransform.bind(controlled);
    controlled.setCenterOfMassTransform = (...args) => { teleports += 1; return setTransform(...args); };
    physics.world.stepSimulation = (...args) => {
        const result = step(...args);
        steps.push(controlled.getCenterOfMassTransform().getOrigin().x());
        return result;
    };
    try {
        vector.setValue(0, 0, 2); controlled.setAngularVelocity(vector);
        vector.setValue(2, 0, 0); free.setLinearVelocity(vector); unbound.setLinearVelocity(vector);
        parent.position.x = 0.03; mesh.updateMatrixWorld(true);
        physics.update(1 / 60);
        assert.equal(steps.length, 3);
        steps.forEach((x, i) => near(x, (i + 1) * 0.01));
        near(controlled.getCenterOfMassTransform().getOrigin().y(), 1);
        near(controlled.getLinearVelocity().x(), 1.8);
        near(controlled.getAngularVelocity().z(), 2);
        assert.ok(child.quaternion.angleTo(new THREE.Quaternion()) > 0.025);
        assert.equal(teleports, 0);
        assert.equal(controlled.getLinearDamping(), 1, '积分后恢复原线性阻尼');
        assert.ok(free.getCenterOfMassTransform().getOrigin().y() < 0, 'type1受重力');
        assert.ok(unbound.getCenterOfMassTransform().getOrigin().y() < 0, '无骨骼type2仍自由平移');
        near(free.getLinearVelocity().x(), 2); near(unbound.getLinearVelocity().x(), 2);
    } finally { physics.manager.freeVector3(vector); cleanup(); }
});

test('世界位移、父骨骼旋转及刚体偏移采样正确，无子步帧不移动，变频与循环复位保留角速度', async () => {
    const { THREE, physics, mesh, parent, cleanup } = await create(65, { controlled: { position: [0.2, 0, 0] } });
    const body = physics.bodies[0].body;
    const vector = physics.manager.allocVector3();
    const { getWebPhysicsStepOptions } = await fixture();
    try {
        vector.setValue(0, 0, 0.5); body.setAngularVelocity(vector);
        mesh.position.set(2, 0, 3); parent.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        mesh.updateMatrixWorld(true);
        const before = body.getCenterOfMassTransform().getOrigin().x();
        physics.update(1 / 240);
        near(body.getCenterOfMassTransform().getOrigin().x(), before);
        const previousPosition = physics.anchorSamples[0].position.clone();
        // 无子步帧仍按原流程回写物理旋转，父骨骼旋转后偏移的世界位置需重新采样。
        const targetForm = physics.bodies[0]._getBoneTransform();
        const target = targetForm.getOrigin();
        const endpoint = [target.x(), target.y(), target.z()];
        physics.manager.freeTransform(targetForm);
        physics.update(1 / 65);
        // 首帧无子步但已采样，物理终点落在第二帧区间内部，按累计时钟验证插值位置。
        const alpha = (1 / 65 - 1 / 240) / (1 / 65);
        const expected = previousPosition.lerp(new THREE.Vector3(...endpoint), alpha).toArray();
        const origin = body.getCenterOfMassTransform().getOrigin();
        expected.forEach((value, i) => near([origin.x(), origin.y(), origin.z()][i], value));
        Object.assign(physics, getWebPhysicsStepOptions(180));
        physics.update(1 / 180);
        near(body.getAngularVelocity().z(), 0.5);
        physics.reset();
        near(body.getAngularVelocity().z(), 0.5, 1e-4);
        assert.equal(physics.physicsRemainder, 0);
    } finally { physics.manager.freeVector3(vector); cleanup(); }
});

const lockedJoint = { rigidBodyIndex1: 0, rigidBodyIndex2: 1,
    position: [0, 0, 0], rotation: [0, 0, 0], translationLimitation1: [0, 0, 0],
    translationLimitation2: [0, 0, 0], rotationLimitation1: [0, 0, 0],
    rotationLimitation2: [0, 0, 0], springPosition: [0, 0, 0], springRotation: [0, 0, 0] };

test('type2线性因子0仍保留角惯量，真实关节角冲量纠正旋转扰动', async () => {
    const { THREE, physics, cleanup } = await create(180, { bodies: [
        { ...base, type: 0, boneIndex: 0, position: [0, 0, 0] },
        { ...base, type: 2, boneIndex: 0, position: [0, 0, 0] }], constraints: [lockedJoint] });
    const body = physics.bodies[1].body;
    const manager = physics.manager;
    const form = manager.allocTransform();
    try {
        manager.setIdentity(form);
        manager.setBasisFromThreeQuaternion(form, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2));
        body.setCenterOfMassTransform(form); body.getMotionState().setWorldTransform(form);
        physics.update(1 / 60);
        const rotation = body.getCenterOfMassTransform().getRotation();
        const angle = new THREE.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w()).angleTo(new THREE.Quaternion());
        assert.ok(angle > 0.03 && angle < 0.16, `关节修正后的角度=${angle}`);
        assert.ok(body.getAngularVelocity().z() < -1, '保留角速度和关节角冲量响应');
        near(body.getCenterOfMassTransform().getOrigin().y(), 0);
    } finally { manager.freeTransform(form); cleanup(); }
});

test('动态父骨骼带动type2子骨骼，帧间目标延迟有界且不会改写骨骼局部位置', async () => {
    const { physics, mesh, parent, child, cleanup } = await create(180, { bodies: [
        { ...base, type: 1, boneIndex: 0, position: [0, 0, 0] },
        { ...base, type: 2, boneIndex: 1, position: [0, 0, 0] }] });
    const vector = physics.manager.allocVector3();
    try {
        vector.setValue(0, 0, 0); physics.world.setGravity(vector);
        vector.setValue(2, 0, 0); physics.bodies[0].body.setLinearVelocity(vector);
        vector.setValue(0, 0, 0.5); physics.bodies[1].body.setAngularVelocity(vector);
        for (let frame = 0; frame < 60; frame += 1) {
            mesh.updateMatrixWorld(true);
            const targetX = parent.position.x;
            physics.update(1 / 60);
            near(physics.bodies[1].body.getCenterOfMassTransform().getOrigin().x(), targetX);
            near(parent.position.x - targetX, 2 / 60);
            assert.deepEqual(child.position.toArray(), [0, 1, 0]);
        }
        near(physics.bodies[0].body.getLinearVelocity().x(), 2);
        near(physics.bodies[1].body.getAngularVelocity().z(), 0.5);
    } finally { physics.manager.freeVector3(vector); cleanup(); }
});

test('真实关节65Hz ERP保持原值，六轴只在变频时刷新；跨Hz相同时间限位误差衰减相近', async () => {
    const { getWebPhysicsStepOptions } = await fixture();
    const residuals = [];
    for (const fps of [30, 65, 90, 120, 180]) {
        const { physics, cleanup } = await create(fps, { bodies: [
            { ...base, type: 0, boneIndex: 0, position: [0, 0, 0] },
            { ...base, type: 1, boneIndex: -1, position: [0, 0, 0] }], constraints: [lockedJoint] });
        const joint = physics.constraints[0].constraint;
        const manager = physics.manager;
        const form = manager.allocTransform();
        const vector = manager.allocVector3();
        try {
            const expected = 1 - 0.525 ** (65 / fps);
            for (let axis = 0; axis < 6; axis += 1) near(joint.getParam(2, axis), expected);
            vector.setValue(0, 0, 0); physics.world.setGravity(vector);
            const body = physics.bodies[1].body;
            manager.setIdentity(form); manager.setOriginFromArray3(form, [0.1, 0, 0]);
            body.setCenterOfMassTransform(form); body.getMotionState().setWorldTransform(form);
            physics.update(0.1);
            residuals.push(body.getCenterOfMassTransform().getOrigin().x());
            let updates = 0;
            const setParam = joint.setParam.bind(joint);
            joint.setParam = (...args) => { updates += 1; return setParam(...args); };
            physics.resetAnchorInterpolation(); physics.update(1 / 60);
            assert.equal(updates, 0, '复位和正常画面帧不重复写关节参数');
            Object.assign(physics, getWebPhysicsStepOptions(fps === 180 ? 65 : 180));
            physics.update(1 / 60);
            assert.equal(updates, 6, '实时变频只刷新六轴一次');
        } finally { manager.freeVector3(vector); manager.freeTransform(form); cleanup(); }
    }
    // 65Hz的0.1秒包含6个完整子步，其余组包含整步数，允许不足一步带来的误差。
    assert.ok(Math.max(...residuals) / Math.min(...residuals) < 1.5, `限位残余=${residuals}`);
    assert.ok(residuals.every((value) => value > 0 && value < 0.003));
    console.info(`跨Hz锁定关节0.1秒位置残余：${residuals.map((value) => value.toFixed(6)).join(', ')}`);
});

test('30至180Hz在10/30/60/90/120/144FPS下完整推进时间，恒速刚体不因预算丢步', async () => {
    for (const fps of [30, 65, 90, 120, 180]) {
        for (const renderFps of [10, 30, 60, 90, 120, 144]) {
            const { physics, cleanup } = await create(fps);
            const vector = physics.manager.allocVector3();
            try {
                vector.setValue(0, 0, 0); physics.world.setGravity(vector);
                vector.setValue(1, 0, 0); physics.bodies[1].body.setLinearVelocity(vector);
                for (let frame = 0; frame < renderFps; frame += 1) physics.update(1 / renderFps);
                near(physics.bodies[1].body.getCenterOfMassTransform().getOrigin().x(), 4, 3e-4);
            } finally { physics.manager.freeVector3(vector); cleanup(); }
        }
    }
});

test('type2异常步进恢复阻尼及临时资源，64轮受控位置native池稳定并完整销毁', async () => {
    const probes = [];
    for (let iteration = 0; iteration < 64; iteration += 1) {
        const { physics, mesh, parent, cleanup } = await create(180, { controlled: { positionDamping: 0.9, rotationDamping: 0.8 } });
        try {
            for (let frame = 0; frame < 10; frame += 1) {
                parent.position.x += 0.01; mesh.updateMatrixWorld(true); physics.update(1 / 60);
            }
            const size = physics.manager.nativeObjects.size;
            for (let frame = 0; frame < 10; frame += 1) physics.update(1 / 60);
            assert.equal(physics.manager.nativeObjects.size, size);
            const transforms = physics.manager.transforms.length;
            const vectors = physics.manager.vector3s.length;
            physics.world.stepSimulation = () => { throw new Error('故障求解'); };
            assert.throws(() => physics.update(1 / 60), /故障求解/u);
            near(physics.bodies[0].body.getLinearDamping(), 0.9);
            near(physics.bodies[0].body.getAngularDamping(), 0.8);
            assert.equal(physics.manager.transforms.length, transforms);
            assert.equal(physics.manager.vector3s.length, vectors);
        } finally { cleanup(); }
        const pointer = Ammo._malloc(4 * 1024 * 1024);
        assert.ok(pointer > 0); probes.push(pointer); Ammo._free(pointer);
    }
    assert.equal(new Set(probes.slice(8)).size, 1);
});

test('真实米娅183刚体/261关节跨Hz静止对照，尾段低质量角速度较原流程降低', {
    skip: !fs.existsSync(modelPath)
}, async () => {
    const { THREE, MMDPhysics, BaselinePhysics, getWebPhysicsStepOptions } = await fixture();
    const { MMDLoader } = await import('three/addons/loaders/MMDLoader.js');
    const { MMDParser } = await import(pathToFileURL(path.join(vendor, 'libs/mmdparser.module.js')).href);
    const bytes = fs.readFileSync(modelPath);
    const metrics = [];
    for (const fps of [180, 30, 65, 90, 120]) {
        const pair = [];
        for (const Physics of [BaselinePhysics, MMDPhysics]) {
            const data = new MMDParser.Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
            const loader = new MMDLoader();
            // 保留真实几何/骨骼/刚体/关节，只替换纹理材质加载，物理断言不依赖DOM和GPU。
            loader.meshBuilder.materialBuilder.build = () => data.materials.map(() => new THREE.MeshBasicMaterial());
            const mesh = loader.meshBuilder.build(data, ''); mesh.updateMatrixWorld(true);
            const metadata = mesh.geometry.userData.MMD;
            const physics = new Physics(mesh, metadata.rigidBodies, metadata.constraints, getWebPhysicsStepOptions(fps));
            const small = physics.bodies.filter((entry) => entry.params.type !== 0 && entry.params.weight <= 0.00101);
            assert.equal(physics.bodies.length, 183); assert.equal(physics.constraints.length, 261);
            let squares = 0;
            let count = 0;
            try {
                for (let frame = 0; frame < 480; frame += 1) {
                    physics.update(1 / 60);
                    if (frame < 420) continue;
                    for (const entry of physics.bodies) {
                        const origin = entry.body.getCenterOfMassTransform().getOrigin();
                        assert.ok([origin.x(), origin.y(), origin.z()].every(Number.isFinite));
                    }
                    for (const entry of small) {
                        const velocity = entry.body.getAngularVelocity();
                        const square = velocity.x() ** 2 + velocity.y() ** 2 + velocity.z() ** 2;
                        assert.ok(Number.isFinite(square));
                        squares += square; count += 1;
                    }
                }
                pair.push(Math.sqrt(squares / count));
            } finally {
                physics.dispose(); assert.equal(physics.manager.nativeObjects.size, 0);
                mesh.geometry.dispose(); mesh.material.forEach((material) => material.dispose());
            }
        }
        metrics.push({ fps, baseline: pair[0], stabilized: pair[1] });
    }
    for (const result of metrics) {
        assert.ok(result.stabilized < result.baseline * 0.7, `${result.fps}Hz残余角速度RMS=${JSON.stringify(result)}`);
    }
    console.info(`真实米娅60FPS末1秒小刚体角速度RMS：${JSON.stringify(metrics)}`);
});

test('稳定性补丁要求唯一入口，固定vendor原始文件不被修改', () => {
    const source = fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8');
    const patched = addPhysicsSubsteps(addPhysicsLifecycle(source));
    assert.throws(() => addPhysicsStability(''), /唯一锚点/u);
    assert.throws(() => addPhysicsStability(patched + patched), /唯一锚点/u);
    assert.equal(source.includes('positionDriven'), false);
});
