'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
let ammoPromise;
function realAmmo() {
    ammoPromise ||= require('../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js')({
        wasmBinary: fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm')) });
    return ammoPromise;
}

test('分部位默认值具有支撑和活动差异，旧设置可直接使用且各实例字典独立', async () => {
    const { normalizeBodySettings } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const settings = normalizeBodySettings();
    assert.ok(settings.dampingMultipliers, '缺少分部位阻尼设置');
    const keys = ['pelvis', 'torso', 'neck', 'head', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];
    assert.deepEqual(Object.keys(settings.dampingMultipliers), keys);
    assert.ok(new Set(Object.values(settings.dampingMultipliers)).size >= 5, '默认不能全部相同');
    assert.ok(settings.dampingMultipliers.pelvis > settings.dampingMultipliers.wrist);
    assert.ok(settings.dampingMultipliers.torso > settings.dampingMultipliers.elbow);
    settings.dampingMultipliers.wrist = 2;
    assert.notEqual(normalizeBodySettings().dampingMultipliers.wrist, 2, '实例共享了可变默认字典');
});

test('部位阻尼拒绝字符串/非有限值，逐项回退并限幅，不接收未知部位', async () => {
    const { normalizeBodySettings } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const defaults = normalizeBodySettings().dampingMultipliers;
    assert.ok(defaults, '缺少分部位阻尼设置');
    for (const invalid of [null, [], 'bad', 1]) {
        assert.deepEqual(normalizeBodySettings({ dampingMultipliers: invalid }).dampingMultipliers, defaults);
    }
    const input = { wrist: 0, head: 99, neck: NaN, pelvis: Infinity, knee: '1.2', elbow: 0.8, surprise: 2 };
    const result = normalizeBodySettings({ dampingMultipliers: input }).dampingMultipliers;
    assert.equal(result.wrist, 0.2); assert.equal(result.head, 2.5); assert.equal(result.elbow, 0.8);
    for (const key of ['neck', 'pelvis', 'knee']) assert.equal(result[key], defaults[key]);
    assert.ok(!Object.hasOwn(result, 'surprise'));
    input.elbow = 2; assert.equal(result.elbow, 0.8, '保留了输入引用');
});

test('真实Ammo中较大头部系数确实耗散更多角运动，全局低档不吞掉部位差异', async () => {
    const { Vector3, Quaternion } = await import('three');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const Ammo = await realAmmo(), speeds = [];
    for (const head of [0.4, 1.8]) {
        // 单一自由刚体排除关节/接触差异，验证力矩和原生耗散的真实作用。
        const node = { semantic: 'head', position: new Vector3(0, 1, 0), quaternion: new Quaternion(),
            offset: new Vector3(), length: 0, radius: 0.075, mass: 3.5, parentNode: null };
        const rig = { nodes: [node], pelvis: node, write: () => [], restore() {} };
        const animated = new Map([[node, { position: node.position.clone(), quaternion: node.quaternion.clone() }]]);
        const drive = createHumanPhysicsDrive(Ammo, rig), settings = { freePelvis: true, damping: 0.2, dampingMultipliers: { head } };
        const impulse = new Ammo.btVector3(0, 1, 0);
        try {
            drive.step(0, animated, [], settings).get(node).body.setAngularVelocity(impulse);
            const allocations = drive.getState().allocations;
            const pose = drive.step(1 / 90, animated, [], settings).get(node);
            speeds.push(pose.omega.length());
            assert.equal(drive.getState().allocations, allocations);
        } finally { drive.dispose(); Ammo.destroy(impulse); }
    }
    assert.ok(speeds[1] < speeds[0] * 0.8, `部位系数未真正影响耗散：${speeds}`);
});

test('真实PMX十组默认系数逐部位牵引保持与Off释放，末段收敛且不增加原生分配', async t => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const { BODY_DAMPING_PARTS } = await import('../3rd/mmd-ar-test/web-human-body-damping.mjs');
    const semantics = ['hips', 'chest', 'neck', 'head', 'leftArm', 'leftElbow', 'leftWrist', 'leftLeg', 'leftKnee', 'leftAnkle'];
    for (const [index, semantic] of semantics.entries()) {
        const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model);
        const node = rig.nodes.find(item => item.semantic === semantic);
        assert.ok(node, '真实骨架缺少' + semantic);
        const drive = createHumanPhysicsDrive(await realAmmo(), rig), allocations = drive.getState().allocations;
        const target = { node, target: rig.targetToWorld(node.position).add(new T.Vector3(0, 0.4, 0.4)),
            positionState: 'On', rotationState: 'Off' };
        const tail = [], elapsed = []; let heldError = 0, tailOmega = 0;
        try {
            for (let frame = 0; frame < 600; frame++) {
                rig.restore();
                const started = performance.now();
                const poses = drive.step(1 / 60, rig.animatedPoses(), frame < 180 ? [target] : [], {});
                elapsed.push(performance.now() - started);
                if (frame === 179) heldError = rig.animatedPoses().get(node).position.distanceTo(rig.targetToLocal(target.target));
                if (frame >= 540) {
                    tail.push(rig.animatedPoses());
                    tailOmega = Math.max(tailOmega, ...[...poses.values()].map(pose => pose.omega.length()));
                }
            }
            let span = 0;
            for (const sample of tail) for (const [key, pose] of sample) {
                span = Math.max(span, pose.position.distanceTo(tail.at(-1).get(key).position));
            }
            assert.ok(heldError < 0.08, `${semantic}: 保持误差${heldError}m`);
            assert.ok(span < 0.005, `${semantic}: Off释放末秒漂移${span}m`);
            assert.ok(tailOmega < 0.1, `${semantic}: Off后仍高速运动${tailOmega}rad/s`);
            assert.equal(drive.getState().allocations, allocations);
            elapsed.sort((a, b) => a - b);
            t.diagnostic(`${BODY_DAMPING_PARTS[index].key}: factor=${BODY_DAMPING_PARTS[index].factor}, held=${(heldError * 1000).toFixed(2)}mm, Off span=${(span * 1000).toFixed(2)}mm, omega=${tailOmega.toFixed(4)}, CPU p95=${elapsed[Math.floor(elapsed.length * 0.95)].toFixed(2)}ms`);
        } finally { rig.restore(); drive.dispose(); }
        assert.equal(drive.getState().allocations, 0);
    }
});

test('全局与部位阻尼范围端点在真实PMX多目标及释放期间保持有界', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive, normalizeBodySettings } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    for (const damping of [0.2, 2.5]) for (const multiplier of [0.2, 2.5]) {
        const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model);
        const drive = createHumanPhysicsDrive(await realAmmo(), rig);
        const settings = { damping, dampingMultipliers: Object.fromEntries(Object.keys(normalizeBodySettings().dampingMultipliers).map(key => [key, multiplier])) };
        const targets = ['leftWrist', 'leftAnkle', 'head'].map((semantic, index) => {
            const node = rig.nodes.find(item => item.semantic === semantic);
            return { node, target: rig.targetToWorld(node.position).add(new T.Vector3(0, 0.4, 0.4)),
                targetRotation: rig.targetRotationToWorld(node.quaternion), positionState: ['On', 'Hold', 'Comply'][index], rotationState: 'On' };
        });
        const allocations = drive.getState().allocations;
        try {
            for (let frame = 0; frame < 240; frame++) {
                rig.restore();
                if (frame === 120) for (const target of targets) { target.positionState = 'Off'; target.rotationState = 'Off'; }
                const poses = drive.step(1 / 60, rig.animatedPoses(), targets, settings);
                for (const pose of poses.values()) {
                    assert.ok([...pose.position.toArray(), ...pose.quaternion.toArray()].every(Number.isFinite));
                    assert.ok(pose.velocity.length() <= 4.00001 && pose.omega.length() <= 8.00001);
                }
            }
            assert.equal(drive.getState().allocations, allocations);
        } finally { rig.restore(); drive.dispose(); }
    }
});
