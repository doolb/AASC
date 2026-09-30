'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { addPhysicsLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
const { addPhysicsSubsteps, addSubstepRuntime } = require('../3rd/mmd-ar-test/web-physics-substeps');
const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three');
let fixturePromise;

async function fixture() {
    if (fixturePromise) return fixturePromise;
    fixturePromise = (async () => {
        const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const THREE = await import(threeUrl);
        const source = addPhysicsSubsteps(addPhysicsLifecycle(fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8')))
            .replace("from 'three'", `from '${threeUrl}'`);
        const { MMDPhysics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({
            wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        const { getWebPhysicsStepOptions } = await import('../3rd/mmd-ar-test/web-physics-rate.mjs');
        return { THREE, MMDPhysics, getWebPhysicsStepOptions };
    })();
    return fixturePromise;
}

async function create(fps = 180, constrained = false) {
    const { THREE, MMDPhysics, getWebPhysicsStepOptions } = await fixture();
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const base = { shapeType: 0, width: 0.1, height: 0.1, depth: 0.1,
        weight: 1, rotation: [0, 0, 0], friction: 0, restitution: 0,
        positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 0 };
    const bodies = [{ ...base, type: 0, boneIndex: 0, position: [0, 0, 0] },
        { ...base, type: 1, boneIndex: -1, position: [0, -1, 0] }];
    const constraints = constrained ? [{ rigidBodyIndex1: 0, rigidBodyIndex2: 1,
        position: [0, -0.5, 0], rotation: [0, 0, 0], translationLimitation1: [0, 0, 0],
        translationLimitation2: [0, 0, 0], rotationLimitation1: [0, 0, 0],
        rotationLimitation2: [0, 0, 0], springPosition: [1, 1, 1], springRotation: [1, 1, 1] }] : [];
    const physics = new MMDPhysics(mesh, bodies, constraints, { ...getWebPhysicsStepOptions(fps), gravity: new THREE.Vector3() });
    const anchor = physics.bodies[0].body;
    const dynamic = physics.bodies[1].body;
    const cleanup = () => {
        physics.dispose();
        assert.equal(physics.manager.nativeObjects.size, 0);
        assert.equal(physics.anchorSamples.length, 0);
        mesh.geometry.dispose(); mesh.material.dispose();
    };
    const target = (position, angle = 0) => {
        bone.position.x = position;
        bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        mesh.updateMatrixWorld(true);
    };
    return { THREE, physics, mesh, bone, anchor, dynamic, cleanup, target };
}

function near(actual, expected, tolerance = 1e-5) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} 应接近 ${expected}`);
}

test('真实Ammo每个子步读取位置lerp/旋转slerp目标并更新运动学线角速度', async () => {
    const { physics, anchor, target, cleanup } = await create();
    const traces = [];
    const form = physics.manager.allocTransform();
    const step = physics.world.stepSimulation.bind(physics.world);
    physics.world.stepSimulation = (dt, maximum, h) => {
        anchor.getMotionState().getWorldTransform(form);
        const q = form.getRotation();
        traces.push({ dt, maximum, h, x: form.getOrigin().x(), angle: 2 * Math.atan2(q.y(), q.w()) });
        return step(dt, maximum, h);
    };
    try {
        target(0.03, Math.PI / 20);
        physics.update(1 / 60);
        assert.equal(traces.length, 3);
        for (let index = 0; index < traces.length; index += 1) {
            const trace = traces[index];
            near(trace.x, 0.01 * (index + 1));
            near(trace.angle, Math.PI / 60 * (index + 1));
            assert.equal(trace.maximum, 0);
            assert.equal(trace.dt, 1 / 180);
            assert.equal(trace.h, trace.dt);
        }
        near(anchor.getLinearVelocity().x(), 1.8);
        // Bullet单精度四元数转角速度含舍入误差，容差约万分之二。
        near(anchor.getAngularVelocity().y(), 3 * Math.PI, 2e-4);
        near(physics.physicsRemainder, 0);
    } finally { physics.manager.freeTransform(form); cleanup(); }
});

test('非整除帧率按时间插值、余量跨帧，画面快于物理时不加速模拟', async () => {
    for (const [fps, renderFps] of [[180, 60], [180, 90], [180, 120], [180, 144], [65, 120]]) {
        const { physics, anchor, dynamic, target, cleanup } = await create(fps);
        const vector = physics.manager.allocVector3();
        const step = physics.world.stepSimulation.bind(physics.world);
        let steps = 0;
        let expectedX = 0;
        physics.world.stepSimulation = (dt, ...args) => {
            const result = step(dt, ...args);
            expectedX += dt;
            // 恒速目标在每个实际求解时间点都应正确，不能仅检查最终位置。
            near(anchor.getCenterOfMassTransform().getOrigin().x(), expectedX, 2e-5);
            steps += 1;
            return result;
        };
        try {
            vector.setValue(1, 0, 0); dynamic.setLinearVelocity(vector);
            for (let frame = 1; frame <= renderFps; frame += 1) {
                target(frame / renderFps);
                physics.update(1 / renderFps);
            }
            assert.equal(steps, fps);
            near(dynamic.getCenterOfMassTransform().getOrigin().x(), 1, 2e-5);
            near(dynamic.getLinearVelocity().x(), 1);
            assert.ok(physics.physicsRemainder < physics.unitStep);
        } finally { physics.manager.freeVector3(vector); cleanup(); }
    }
});

test('零时间和不足一步不驱动物理，历史复位和频率变化不清动态速度', async () => {
    const { physics, dynamic, anchor, target, cleanup } = await create(65);
    const { getWebPhysicsStepOptions } = await fixture();
    const vector = physics.manager.allocVector3();
    try {
        vector.setValue(2, 0, 0); dynamic.setLinearVelocity(vector);
        target(1);
        for (const delta of [0, -1, NaN, Infinity]) physics.update(delta);
        assert.equal(physics.physicsSampleTime, 0);
        physics.update(1 / 120);
        assert.equal(anchor.getCenterOfMassTransform().getOrigin().x(), 0);
        near(dynamic.getCenterOfMassTransform().getOrigin().x(), 0);
        physics.resetAnchorInterpolation();
        assert.equal(physics.physicsRemainder, 0);
        assert.equal(physics.physicsSampleTime, 0);
        near(physics.anchorSamples[0].position.x, 0);
        near(dynamic.getLinearVelocity().x(), 2);
        Object.assign(physics, getWebPhysicsStepOptions(180));
        target(0.03); physics.update(1 / 60);
        near(anchor.getCenterOfMassTransform().getOrigin().x(), 0.03);
        near(dynamic.getLinearVelocity().x(), 2);
        target(2); physics.reset();
        near(physics.anchorSamples[0].position.x, 2);
        near(dynamic.getLinearVelocity().x(), 2, 1e-4);
        target(2.03); physics.update(1 / 60);
        near(anchor.getCenterOfMassTransform().getOrigin().x(), 2.03);
    } finally { physics.manager.freeVector3(vector); cleanup(); }
});

test('低频超预算丢弃整步不会无限积压，异常回收临时变换和非单位网格缩放', async () => {
    const { physics, mesh, target, cleanup } = await create(65);
    const step = physics.world.stepSimulation.bind(physics.world);
    let count = 0;
    physics.world.stepSimulation = (...args) => { count += 1; return step(...args); };
    try {
        for (let frame = 1; frame <= 20; frame += 1) {
            target(frame / 10); physics.update(0.1);
            assert.ok(physics.physicsRemainder < physics.unitStep);
        }
        assert.equal(count, 60);
        const poolSize = physics.manager.transforms.length;
        const parent = new (await fixture()).THREE.Object3D();
        parent.add(mesh);
        mesh.scale.setScalar(2); mesh.updateMatrixWorld(true);
        physics.world.stepSimulation = () => { throw new Error('求解故障'); };
        assert.throws(() => physics.update(1 / 60), /求解故障/u);
        assert.equal(physics.manager.transforms.length, poolSize);
        assert.equal(mesh.parent, parent);
        assert.equal(mesh.scale.x, 2);
    } finally { cleanup(); }
});

test('真实弹簧关节带动动态刚体，64轮锚点插值native资源和大块堆空间复用', async () => {
    const probes = [];
    for (let iteration = 0; iteration < 64; iteration += 1) {
        const { physics, dynamic, target, cleanup } = await create(180, true);
        try {
            for (let frame = 1; frame <= 60; frame += 1) {
                target(frame / 60); physics.update(1 / 60);
            }
            const x = dynamic.getCenterOfMassTransform().getOrigin().x();
            assert.ok(Number.isFinite(x) && x > 0.5 && x < 1.5, `关节跟随动态x=${x}`);
            const size = physics.manager.nativeObjects.size;
            for (let frame = 0; frame < 10; frame += 1) physics.update(1 / 60);
            assert.equal(physics.manager.nativeObjects.size, size, '预热后不会持续创建native临时值');
        } finally { cleanup(); }
        const pointer = Ammo._malloc(4 * 1024 * 1024);
        assert.ok(pointer > 0); probes.push(pointer); Ammo._free(pointer);
    }
    assert.equal(new Set(probes.slice(8)).size, 1);
    assert.equal(Ammo.HEAP8.byteLength, 64 * 1024 * 1024);
});

test('后台间隔和显示恢复重置历史，构建锚点缺失或重复立即失败', () => {
    const source = fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8');
    assert.throws(() => addPhysicsSubsteps(''), /唯一锚点/u);
    assert.throws(() => addPhysicsSubsteps(addPhysicsLifecycle(source) + source), /唯一锚点/u);
    assert.throws(() => addSubstepRuntime(''), /唯一锚点/u);
    const runtime = fs.readFileSync(path.resolve(vendor, '../../display-pmx-runtime.js'), 'utf8');
    const patched = addSubstepRuntime(runtime);
    const frame = patched.slice(patched.indexOf('    const renderFrame = (now)'), patched.indexOf('        lastFrameAt = now;'));
    const visibility = patched.slice(patched.indexOf('    const setVisible = (nextVisible)'), patched.indexOf('    const rotateModelBy'));
    let resets = 0;
    let visible = false;
    let lastFrameAt = 0;
    const currentMesh = {};
    const helper = { current: { objects: new Map([[currentMesh, { physics: { resetAnchorInterpolation() { resets += 1; } } }]]) } };
    // 实际构建补丁片段在可控时间/显隐下执行，不靠字符串存在就宣称后台恢复正确。
    const runFrame = new Function('helper', 'currentMesh', 'now', 'lastFrameAt', 'visible', `let frameHandle; const disposed=false; ${frame}\n return delta; }; return renderFrame(now);`);
    visible = true;
    near(runFrame(helper, currentMesh, 16, lastFrameAt, visible), 0.016);
    assert.equal(resets, 0);
    near(runFrame(helper, currentMesh, 1000, lastFrameAt, visible), 0.1);
    assert.equal(resets, 1);
    const setVisible = new Function('helper', 'currentMesh', `let visible=false; let frameHandle=0; const startRendering=()=>{}; ${visibility} return setVisible;`)(helper, currentMesh);
    setVisible(true); setVisible(true); setVisible(false); setVisible(true);
    assert.equal(resets, 3);
});
