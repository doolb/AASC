'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KEYS = { pelvis: 'hips', chest: 'upperBody', leftHand: 'leftWrist', rightHand: 'rightWrist', leftFoot: 'leftAnkle', rightFoot: 'rightAnkle' };

// 合成回环只验证真实PMX与坐标桥接，不把本测试当HMR图像识别精度验收。
async function fixture() {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const f = await makeModel();
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { limitJointRotation } = await import('../3rd/mmd-ar-test/web-human-joint-limits.mjs');
    const semantic = await import('../3rd/mmd-ar-test/web-human-pose-semantic.mjs');
    const rig = createHumanPhysicsRig(f.model), node = name => rig.nodes.find(value => value.semantic === name);
    for (const value of rig.nodes) if (value.hasModelLimits) value.bone.quaternion.copy(limitJointRotation(value, value.bone.quaternion));
    const { T, model } = f, camera = new T.PerspectiveCamera(40, 1, .01, 1000);
    const makePose = () => {
        model.mesh.updateWorldMatrix(true, true);
        const anchor = node('hips').bone.getWorldPosition(new T.Vector3());
        camera.position.copy(anchor).add(new T.Vector3(4, 1, 35).multiplyScalar(model.mesh.getWorldScale(new T.Vector3()).x));
        camera.lookAt(anchor); camera.updateMatrixWorld(true);
        const cameraHip = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const raw = { imageSize: [1000, 1000], names: [...semantic.HMR2_BODY25_NAMES], edges: semantic.HMR2_BODY25_EDGES,
            xy: Array.from({ length: 25 }, () => [500, 500]), xyz: Array.from({ length: 25 }, () => [0, 0, 0]), cameraDepth: Array(25).fill(-cameraHip.z) };
        const mapping = { leftArm: 5, rightArm: 2, leftElbow: 6, rightElbow: 3, leftWrist: 7, rightWrist: 4,
            leftLeg: 12, rightLeg: 9, leftKnee: 13, rightKnee: 10, leftAnkle: 14, rightAnkle: 11, hips: 8, neck: 1, head: 0 };
        for (const [key, index] of Object.entries(mapping)) {
            const value = node(key); if (!value) continue;
            const world = value.bone.getWorldPosition(new T.Vector3()), ndc = world.clone().project(camera);
            const local = world.clone().applyMatrix4(camera.matrixWorldInverse).sub(cameraHip).multiplyScalar(rig.metersPerUnit);
            raw.xy[index] = [(ndc.x + 1) * 500, (1 - ndc.y) * 500];
            raw.xyz[index] = [local.x, -local.y, -local.z];
        }
        return semantic.createHmr2SemanticPose(raw);
    };
    return { ...f, rig, node, camera, makePose, semantic };
}

test('BODY25原生XYZ→真实PMX FK合成回环：不改骨架、不改原始数据、不伪造33点', async () => {
    const { fitImagePose2D } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture(), pose = f.makePose(), original = JSON.stringify(pose.raw);
    const rotations = f.model.bones.map(b => b.bone.quaternion.toArray());
    const fit = fitImagePose2D(pose, f.rig, f.camera);
    assert.equal(fit.depthSource, 'hmr2-native-directions');
    assert.equal(fit.depthAccepted, 0); assert.equal(pose.landmarks, undefined);
    assert.ok(fit.error < 1e-6);
    for (const target of fit.targets) {
        const expected = f.node(KEYS[target.key] || target.key).bone.getWorldPosition(new f.T.Vector3());
        assert.ok(f.rig.targetToLocal(expected).distanceTo(f.rig.targetToLocal(new f.T.Vector3().fromArray(target.position))) < .001, target.key);
    }
    assert.equal(JSON.stringify(pose.raw), original);
    assert.deepEqual(f.model.bones.map(b => b.bone.quaternion.toArray()), rotations);
});

test('HMR三维回环保持模型旋转/缩放与屈膝；关闭辅助时额外线索完全不参与', async () => {
    const { fitImagePose2D } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture();
    f.model.mesh.position.set(3, 2, -1); f.model.mesh.rotation.y = .7; f.model.mesh.scale.setScalar(2);
    f.node('upperBody').bone.quaternion.setFromEuler(new f.T.Euler(.2, 0, .4));
    for (const side of ['left', 'right']) {
        f.node(side + 'Leg').bone.quaternion.setFromEuler(new f.T.Euler(-.6, 0, 0));
        f.node(side + 'Knee').bone.quaternion.setFromEuler(new f.T.Euler(.8, 0, 0));
    }
    const pose = f.makePose(), before = JSON.stringify(pose);
    const plain = fitImagePose2D(pose, f.rig, f.camera);
    const off = fitImagePose2D(pose, f.rig, f.camera, { depthEnabled: false,
        depthHints: [{ a: 'leftLeg', b: 'leftKnee', sign: -1, weight: .25 }] });
    assert.deepEqual(off, plain);
    assert.equal(JSON.stringify(pose), before);
    for (const target of plain.targets) {
        const expected = f.node(KEYS[target.key] || target.key).bone.getWorldPosition(new f.T.Vector3());
        assert.ok(f.rig.targetToLocal(expected).distanceTo(f.rig.targetToLocal(new f.T.Vector3().fromArray(target.position))) < .001, target.key);
    }
});

test('弱排序拒绝原生三维明确冲突/非法线索，接受同向线索不替换原始XYZ', async () => {
    const { createImagePosePrior } = await import('../3rd/mmd-ar-test/web-human-pose-prior.mjs');
    const { createPoseFK } = await import('../3rd/mmd-ar-test/web-human-pose-fk.mjs');
    const f = await fixture(), pose = f.makePose();
    pose.joints.leftKnee.world[2] = pose.joints.leftLeg.world[2] + .2;
    const fk = createPoseFK(f.rig), view = new f.T.Matrix4().multiplyMatrices(f.camera.matrixWorldInverse, f.model.mesh.matrixWorld)
        .multiply(new f.T.Matrix4().makeScale(1 / f.rig.metersPerUnit, 1 / f.rig.metersPerUnit, 1 / f.rig.metersPerUnit));
    const prior = createImagePosePrior(pose, f.rig, fk, view, { depthHints: [
        { a: 'leftLeg', b: 'leftKnee', sign: -1, weight: .25 },
        { a: 'leftLeg', b: 'leftKnee', sign: 1, weight: .25 },
        { a: 'not-a-body', b: 'leftKnee', sign: 1, weight: .25 },
    ] });
    assert.equal(prior.depthAccepted, 1); assert.equal(prior.depthRejected.length, 2);
    assert.match(prior.depthRejected[0].reason, /冲突/u);
    const loss = prior.loss(fk.evaluate(fk.initial).poses, 2);
    assert.ok(Number.isFinite(loss.directionLoss)); assert.ok(loss.depthLoss >= 0 && loss.depthLoss <= .0005);
});

test('HMR异步拟合取消/缺躯干拒绝，所有失败不改真实PMX', async () => {
    const { fitImagePose2DAsync } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture(), pose = f.makePose(), before = f.model.bones.map(b => b.bone.quaternion.toArray());
    await assert.rejects(fitImagePose2DAsync(pose, f.rig, f.camera, { isCurrent: () => false }), { name: 'AbortError' });
    pose.joints.leftLeg.usable = false;
    await assert.rejects(fitImagePose2DAsync(pose, f.rig, f.camera), /肩|骨盆/u);
    assert.deepEqual(f.model.bones.map(b => b.bone.quaternion.toArray()), before);
});

function mediaPipePose(f) {
    const native = f.makePose(), landmarks = Array(33).fill(null);
    const mapping = { leftArm: 11, rightArm: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
        leftLeg: 23, rightLeg: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28, head: 0 };
    for (const [key, index] of Object.entries(mapping)) landmarks[index] = { ...native.joints[key], world: [...native.joints[key].world], visibility: 1, presence: 1 };
    return { source: 'mediapipe-pose', dimensions: 3, confidence: 1, imageAspect: 1, landmarks };
}

test('真实PMX/Ammo入口：MP辅助零线索/全冲突逐值保持原同步目标及head', async () => {
    const { createHumanIK } = await import('../3rd/mmd-ar-test/web-human-ik.mjs');
    const { needsImagePoseFit } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture(), scene = new f.T.Scene(); scene.add(f.model.mesh);
    const fs = require('node:fs'), path = require('node:path');
    const loadAmmo = () => require('../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js')({
        wasmBinary: fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm')) });
    const savedWindow = globalThis.window; globalThis.window ||= { addEventListener() {}, removeEventListener() {} };
    const canvas = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) };
    const ik = createHumanIK({ getScene: () => scene, getCamera: () => f.camera, canvas, loadAmmo });
    try {
        await ik.setMode('physics', f.model); ik.setEnabled(true, f.model);
        const pose = mediaPipePose(f); pose.landmarks[25].world[2] = pose.landmarks[23].world[2] + .2;
        for (const depthHints of [[], [{ a: 'leftLeg', b: 'leftKnee', sign: -1, weight: .25 }], [{ a: 'head', b: 'leftKnee', sign: 1, weight: .25 }]]) {
            const plain = ik.applyImagePose(pose), options = { depthEnabled: true, depthHints };
            assert.equal(needsImagePoseFit(pose, options, f.rig), false);
            assert.equal(plain.controls.find(point => point.key === 'head').positionState, 'On');
            const extra = ik.applyImagePose(pose, options);
            assert.equal(typeof extra.then, 'undefined', '空辅助必须保留同步兼容');
            assert.deepEqual(extra.controls, plain.controls); assert.equal(extra.activeTargets, plain.activeTargets);
        }
        const locals = f.model.bones.map(item => item.bone.position.clone()), native = f.makePose();
        const task = ik.applyImagePose(native, { depthEnabled: false });
        assert.equal(typeof task.then, 'function', 'HMR必须进入真实异步FK提交入口');
        const applied = await task;
        assert.equal(applied.activeTargets, 10); assert.equal(applied.imagePoseFit.depthSource, 'hmr2-native-directions');
        assert.ok(applied.imagePoseFit.error < .003);
        f.model.bones.forEach((item, index) => assert.ok(item.bone.position.distanceTo(locals[index]) < 1e-8, '提交只改目标，不改骨长'));
        for (let frame = 0; frame < 120; frame++) ik.apply(f.model, 1 / 60);
        f.model.bones.forEach((item, index) => {
            assert.ok([...item.bone.position.toArray(), ...item.bone.quaternion.toArray()].every(Number.isFinite));
            if (item.bone !== f.model.bindings['bones:center'].bone) assert.ok(item.bone.position.distanceTo(locals[index]) < 1e-8, '物理推进不拉长原PMX骨段');
        });
        const held = ik.getState().controls;
        await assert.rejects(ik.applyImagePose(native, { isCurrent: () => false }), { name: 'AbortError' });
        assert.deepEqual(ik.getState().controls, held, 'HMR提交取消不得改已有真实控制点');
    } finally { ik.dispose(); if (!savedWindow) delete globalThis.window; }
});

test('有效MP辅助仍从同一合法FK解生成head，不把nose参与相机或定位', async () => {
    const { fitImagePose2D } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture(), pose = mediaPipePose(f);
    const delta = pose.landmarks[25].world[2] - pose.landmarks[23].world[2];
    const fit = fitImagePose2D(pose, f.rig, f.camera, { depthEnabled: true,
        depthHints: [{ a: 'leftLeg', b: 'leftKnee', sign: Math.sign(delta) || 1, weight: .25 }] });
    assert.equal(fit.depthAccepted, 1); assert.ok(fit.targets.some(target => target.key === 'head'));
    assert.ok(fit.error < .003);
});

test('公共弱线索白名单/正权重/去重/端点可用门禁，最大权重不超0.25', async () => {
    const { filterImageDepthHints } = await import('../3rd/mmd-ar-test/web-human-pose-prior.mjs');
    const f = await fixture(), pose = f.makePose();
    pose.joints.leftKnee.world[2] = pose.joints.leftLeg.world[2] + .2;
    const hint = { a: 'leftLeg', b: 'leftKnee', sign: 1, weight: 1 };
    const filtered = filterImageDepthHints(pose, [hint, hint, { ...hint, weight: 0 }, { ...hint, weight: -1 },
        { ...hint, a: 'head' }, { ...hint, b: 'rightKnee' }, { ...hint, sign: -1 }], f.rig);
    assert.equal(filtered.hints.length, 1); assert.equal(filtered.hints[0].weight, .25); assert.equal(filtered.rejected.length, 6);
    pose.joints.leftKnee.usable = false;
    assert.equal(filterImageDepthHints(pose, [hint]).hints.length, 0);
});

test('DA弱排序归一化在模型均匀缩放和等价PMX单位变换下不漂移', async () => {
    const { createImagePosePrior } = await import('../3rd/mmd-ar-test/web-human-pose-prior.mjs');
    const { createPoseFK } = await import('../3rd/mmd-ar-test/web-human-pose-fk.mjs');
    const f = await fixture(), pose = f.makePose();
    pose.joints.leftKnee.world[2] = pose.joints.leftLeg.world[2] + .2;
    const hints = [{ a: 'leftLeg', b: 'leftKnee', sign: 1, weight: .25 }], values = [];
    const viewFor = rig => new f.T.Matrix4().multiplyMatrices(f.camera.matrixWorldInverse, f.model.mesh.matrixWorld)
        .multiply(new f.T.Matrix4().makeScale(1 / rig.metersPerUnit, 1 / rig.metersPerUnit, 1 / rig.metersPerUnit));
    for (const scale of [1, 2, 10]) {
        f.model.mesh.scale.setScalar(scale); f.makePose();
        const fk = createPoseFK(f.rig), view = viewFor(f.rig);
        const prior = createImagePosePrior(pose, f.rig, fk, view, { depthHints: hints });
        assert.equal(prior.depthAccepted, 1);
        values.push(prior.loss(fk.evaluate(fk.initial).poses, 2).depthLoss);
        // 等价PMX单位重标记：FK米坐标与metersPerUnit同乘1000，实际场景坐标仍相同。
        const rescale = poses => new Map([...poses].map(([node, value]) => [node, { ...value, position: value.position.clone().multiplyScalar(1000) }]));
        const otherRig = { ...f.rig, metersPerUnit: f.rig.metersPerUnit * 1000 };
        const otherFK = { ...fk, source: rescale(fk.source), evaluate: parameters => { const result = fk.evaluate(parameters); return { ...result, poses: rescale(result.poses) }; } };
        const same = createImagePosePrior(pose, otherRig, otherFK, viewFor(otherRig), { depthHints: hints });
        assert.ok(Math.abs(same.loss(otherFK.evaluate(otherFK.initial).poses, 2000).depthLoss - values.at(-1)) < 1e-12);
    }
    assert.ok(values[0] > 0, '需要非零损失才能检出单位漂移');
    assert.ok(values.every(value => Math.abs(value - values[0]) < 1e-12), JSON.stringify(values));
});

test('HMR相机以十二身体语义拟合，不读不存在的MP33或将nose当头关节', async () => {
    const { fitImageCamera } = await import('../3rd/mmd-ar-test/web-human-pose-camera.mjs');
    const f = await fixture(), pose = f.makePose();
    f.node('leftLeg').bone.quaternion.setFromEuler(new f.T.Euler(-.4, .1, 0));
    const next = f.makePose();
    const points = f.semantic.POSE_BODY_KEYS.map(key => ({ key, world: f.node(key).bone.getWorldPosition(new f.T.Vector3()).toArray() }));
    points.push({ key: 'head', world: [1000, 1000, 1000] });
    const snapshot = { token: 'synthetic-hmr-roundtrip', points, view: { fov: f.camera.fov, zoom: f.camera.zoom, aspect: 1,
        viewMatrix: f.camera.matrixWorldInverse.toArray() } };
    const result = await fitImageCamera(snapshot, next, { aspect: 1 });
    assert.ok(result.error < .003, String(result.error)); assert.ok(result.inliers >= 10);
    assert.equal(pose.landmarks, undefined);
});
