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

test('人体重力缺省关闭，只有显式true开启，面板缺省不勾选', async () => {
    const { normalizeBodySettings } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    for (const value of [{}, { gravity: false }, { gravity: null }, { gravity: 'true' }]) {
        assert.equal(normalizeBodySettings(value).gravity, false);
    }
    assert.equal(normalizeBodySettings({ gravity: true }).gravity, true);
    const ui = fs.readFileSync(path.resolve(__dirname, '../3rd/mmd-ar-test/web-human-ik-ui.mjs'), 'utf8');
    assert.match(ui, /data-body="gravity" type="checkbox">重力/u);
});

test('真实PMX单点On→Off及全Off静置，重力开关下全身摆幅和角速度收敛', async t => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    for (const gravity of [false, true]) for (const semantic of ['none', 'leftWrist', 'leftAnkle', 'head', 'hips']) {
        const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model);
        const drive = createHumanPhysicsDrive(await realAmmo(), rig), allocations = drive.getState().allocations;
        const node = rig.nodes.find(item => item.semantic === semantic);
        const target = node && { node, target: model.bindings['bones:' + semantic].bone.getWorldPosition(new T.Vector3())
            .add(new T.Vector3(0, 3, 3)), positionState: 'On', rotationState: 'Off' };
        const original = JSON.stringify(model.mesh.geometry.userData.MMD);
        const locals = model.bones.map(item => item.bone.position.clone());
        const tail = [], earlySpeeds = [], tailSpeeds = []; let tailOmega = 0;
        try {
            for (let frame = 0; frame < 780; frame++) {
                rig.restore();
                const poses = drive.step(1 / 60, rig.animatedPoses(), frame < 180 && target ? [target] : [], { gravity });
                const motion = [...poses.values()].reduce((sum, pose) => sum + pose.omega.lengthSq(), 0);
                if (frame >= 180 && frame < 240) earlySpeeds.push(motion);
                if (frame >= 720) {
                    tail.push(rig.animatedPoses()); tailSpeeds.push(motion);
                    tailOmega = Math.max(tailOmega, ...[...poses.values()].map(pose => pose.omega.length()));
                }
            }
            let span = 0, angle = 0;
            for (const sample of tail) for (const [key, pose] of sample) {
                span = Math.max(span, pose.position.distanceTo(tail.at(-1).get(key).position));
                angle = Math.max(angle, pose.quaternion.angleTo(tail.at(-1).get(key).quaternion));
            }
            const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
            // 放开不能用锁点或清零速度伪造稳定：同时验证全骨位姿和原生速度；重力允许自然姿态变化。
            assert.ok(span < (gravity ? 0.025 : 0.003), `${semantic}/gravity=${gravity}: 漂摆${span}m`);
            assert.ok(angle < (gravity ? 0.12 : 0.01), `${semantic}/gravity=${gravity}: 转角漂摆${angle}rad`);
            assert.ok(tailOmega < (gravity ? 3 : 0.1), `${semantic}/gravity=${gravity}: 持续角速度${tailOmega}`);
            if (!gravity && ['leftWrist', 'leftAnkle', 'head'].includes(semantic)) {
                assert.ok(mean(tailSpeeds) < mean(earlySpeeds) * 0.02, 'Off后相对运动未明显衰减');
            }
            model.bones.forEach((item, index) => {
                if (item.bone !== model.bindings['bones:center'].bone) assert.ok(item.bone.position.distanceTo(locals[index]) < 1e-8);
            });
            assert.equal(JSON.stringify(model.mesh.geometry.userData.MMD), original);
            assert.equal(drive.getState().allocations, allocations);
            t.diagnostic(`${semantic}/gravity=${gravity}: span=${span.toFixed(5)}m/${angle.toFixed(5)}rad, tailOmega=${tailOmega.toFixed(4)}`);
        } finally { rig.restore(); drive.dispose(); }
        assert.equal(drive.getState().allocations, 0);
    }
});

test('真实PMX自由骨盆释放后惯性衰减，保持释放的整体位置而不重置身体', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model);
    const drive = createHumanPhysicsDrive(await realAmmo(), rig);
    const initial = rig.animatedPoses().get(rig.pelvis).position.clone();
    const target = { node: rig.pelvis, target: model.bindings['bones:hips'].bone.getWorldPosition(new T.Vector3())
        .add(new T.Vector3(0, 3, 3)), positionState: 'On', rotationState: 'Off' };
    const tail = []; let firstSpeed = 0, finalSpeed = 0;
    try {
        for (let frame = 0; frame < 780; frame++) {
            rig.restore();
            const poses = drive.step(1 / 60, rig.animatedPoses(), frame < 180 ? [target] : [], { gravity: false, freePelvis: true });
            const speed = Math.max(...[...poses.values()].map(pose => pose.velocity.length()));
            if (frame === 180) firstSpeed = speed;
            if (frame === 779) finalSpeed = speed;
            if (frame >= 720) tail.push(rig.animatedPoses());
        }
        let span = 0;
        for (const sample of tail) for (const [node, pose] of sample) span = Math.max(span,
            pose.position.distanceTo(tail.at(-1).get(node).position));
        assert.ok(span < 0.005, `自由身体末秒仍持续漂移${span}m`);
        assert.ok(finalSpeed < Math.max(0.005, firstSpeed * 0.05), '自由身体惯性未衰减');
        assert.ok(tail.at(-1).get(rig.pelvis).position.distanceTo(initial) > 0.1, 'Off暗中重置了整体位置');
    } finally { rig.restore(); drive.dispose(); }
});

test('真实PMX父空间静止坐标正确换算身高，不受待机姿态和模型变换影响', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    for (const idle of [false, true]) {
        const { model } = await makeModel(idle);
        model.mesh.scale.setScalar(3); model.mesh.position.set(2, -5, 7); model.mesh.rotation.y = 0.6;
        const rig = createHumanPhysicsRig(model);
        assert.ok(Math.abs(rig.metersPerUnit - 0.10255717603951485) < 1e-9);
    }
});

test('默认肘铰链超过90度保持真实屈曲，不发生Y轴Euler折返', async () => {
    const f = await fixture();
    const { createHumanPhysicsRig, nodeOffset } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const rig = createHumanPhysicsRig(f.model), animated = rig.animatedPoses();
    try {
        const node = rig.nodes.find(item => item.semantic === 'leftElbow');
        const bend = node.limits.high[node.hingeAxis] > 2 ? 2 : -2;
        const rotation = animated.get(node.parentNode).quaternion.clone().multiply(node.jointFrameRotation)
            .multiply(new f.T.Quaternion().setFromAxisAngle(new f.T.Vector3().setComponent(node.hingeAxis, 1), bend));
        const poses = new Map([...animated].map(([key, pose]) => [key, { position: pose.position.clone()
            .add(nodeOffset(key, pose.quaternion)), quaternion: pose.quaternion.clone() }]));
        poses.get(node).quaternion.copy(rotation);
        rig.write(poses, animated);
        assert.ok(rig.animatedPoses().get(node).quaternion.angleTo(rotation) < 1e-7, '深屈肘被折返或误锁');
    } finally { rig.restore(); f.controller.dispose(); }
});

test('真实米娅无重力手脚头骨盆单点保持10秒，全身位置与转角稳定且骨长不变', async t => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    for (const semantic of ['leftWrist', 'leftAnkle', 'head', 'hips']) {
        const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model);
        const original = JSON.stringify(model.mesh.geometry.userData.MMD);
        const locals = model.bones.map(item => item.bone.position.clone());
        const drive = createHumanPhysicsDrive(await realAmmo(), rig), allocations = drive.getState().allocations;
        const node = rig.nodes.find(item => item.semantic === semantic);
        const goal = model.bindings['bones:' + semantic].bone.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 3, 3));
        const target = { node, target: goal.clone(), positionState: 'On', rotationState: 'Off' };
        const tail = [], times = []; let peakOmega = 0;
        try {
            for (let frame = 0; frame < 600; frame++) {
                rig.restore();
                const poses = drive.step(1 / 60, rig.animatedPoses(), [target], { gravity: false, freePelvis: false });
                times.push(drive.getState().frameMs);
                for (const pose of poses.values()) peakOmega = Math.max(peakOmega, pose.omega.length());
                if (frame >= 540) tail.push(rig.animatedPoses());
            }
            let positionSpan = 0, angleSpan = 0;
            for (const sample of tail) for (const [key, pose] of sample) {
                const final = tail.at(-1).get(key);
                positionSpan = Math.max(positionSpan, pose.position.distanceTo(final.position));
                angleSpan = Math.max(angleSpan, pose.quaternion.angleTo(final.quaternion));
            }
            // 米制1.6米人体：末秒全部主要骨骼跨度最多2厘米/约3.4度；不能只验目标点或finite。
            assert.ok(positionSpan < 0.02, `${semantic}全身摆幅${positionSpan}m`);
            assert.ok(angleSpan < 0.06, `${semantic}全身角跨度${angleSpan}rad`);
            assert.ok(peakOmega <= 8.00001, `${semantic}角速度失控${peakOmega}`);
            assert.ok(tail.at(-1).get(rig.pelvis).quaternion.angleTo(rig.initial.get(rig.pelvis).quaternion) < 1e-7);
            assert.deepEqual(target.target.toArray(), goal.toArray(), '不可达包络不得改写用户目标');
            const error = model.bindings['bones:' + semantic].bone.getWorldPosition(new T.Vector3()).distanceTo(goal) * rig.metersPerUnit;
            if (semantic !== 'head') assert.ok(error < 0.02, `${semantic}可达目标误差${error}m`);
            model.bones.forEach((item, index) => {
                if (item.bone !== model.bindings['bones:center'].bone) assert.ok(item.bone.position.distanceTo(locals[index]) < 1e-8);
            });
            assert.equal(drive.getState().allocations, allocations);
            assert.equal(JSON.stringify(model.mesh.geometry.userData.MMD), original);
            times.sort((a, b) => a - b);
            t.diagnostic(`${semantic}: span=${positionSpan.toFixed(5)}m/${angleSpan.toFixed(5)}rad, error=${error.toFixed(5)}m, CPU median/p95=${times[300].toFixed(2)}/${times[570].toFixed(2)}ms`);
        } finally { rig.restore(); drive.dispose(); }
        assert.equal(drive.getState().allocations, 0);
    }
});

test('真实PMX反复改变单点目标，在30/60/120fps等物理时长下结果一致', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const results = [];
    for (const fps of [30, 60, 120]) {
        const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model);
        const drive = createHumanPhysicsDrive(await realAmmo(), rig), node = rig.nodes.find(item => item.semantic === 'leftWrist');
        const initial = model.bindings['bones:leftWrist'].bone.getWorldPosition(new T.Vector3());
        const target = { node, target: initial.clone(), positionState: 'On', rotationState: 'Off' };
        try {
            for (let frame = 0; frame < fps * 4; frame++) {
                if (frame % fps === 0) target.target.copy(initial).add(new T.Vector3(0, 2, (frame / fps % 2 ? -1 : 1) * 2));
                rig.restore(); drive.step(1 / fps, rig.animatedPoses(), [target], { gravity: false });
            }
            results.push(rig.animatedPoses());
        } finally { rig.restore(); drive.dispose(); }
    }
    for (let i = 1; i < results.length; i++) {
        const previous = [...results[i - 1].values()], current = [...results[i].values()];
        current.forEach((pose, index) => {
            assert.ok(pose.position.distanceTo(previous[index].position) < 0.003, '相同子步时长产生全身位置差');
            assert.ok(pose.quaternion.angleTo(previous[index].quaternion) < 0.02, '相同子步时长产生全身转角差');
        });
    }
});

async function fixture(loadAmmo = realAmmo) {
    const T = await import('three');
    const { createHumanIK } = await import('../3rd/mmd-ar-test/web-human-ik.mjs');
    const scene = new T.Scene(), mesh = new T.Group(), bones = [], bindings = {};
    const add = (name, parent, position) => {
        const bone = new T.Bone(); bone.name = name; bone.position.fromArray(position);
        (parent || mesh).add(bone); const index = bones.length; bones.push(bone);
        bindings['bones:' + name] = { bone, index, dynamic: false, name }; return bone;
    };
    const root = add('root', null, [0, 0, 0]), center = add('center', root, [0, 0, 0]);
    const hips = add('hips', center, [0, 1, 0]);
    const torso = add('upperBody', center, [0, 1.14, 0]), chest = add('chest', torso, [0, 0.18, 0]);
    const neck = add('neck', chest, [0, 0.22, 0]); add('head', neck, [0, 0.14, 0]);
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
        const arm = add(side + 'Arm', chest, [0.18 * sign, 0.1, 0]);
        const elbow = add(side + 'Elbow', arm, [0.3 * sign, 0, 0]); add(side + 'Wrist', elbow, [0.28 * sign, 0, 0]);
        const leg = add(side + 'Leg', hips, [0.09 * sign, -0.04, 0]);
        const knee = add(side + 'Knee', leg, [0, -0.43, 0]); add(side + 'Ankle', knee, [0, -0.43, 0]);
    }
    mesh.geometry = new T.BufferGeometry(); mesh.geometry.boundingSphere = new T.Sphere(new T.Vector3(), 1);
    mesh.geometry.userData.MMD = { iks: [{ links: ['left', 'right'].map(side => ({
        index: bindings['bones:' + side + 'Knee'].index, rotationMin: [-2.6, 0, 0], rotationMax: [0, 0, 0] })) }] };
    mesh.skeleton = { bones }; scene.add(mesh); scene.updateMatrixWorld(true);
    for (const binding of Object.values(bindings)) binding.restPosition = binding.bone.getWorldPosition(new T.Vector3());
    const model = { mesh, bindings, bones: bones.map((bone, index) => ({ bone, index, dynamic: false })), groups: { root: new Set([0, 1]) } };
    const pointerHandlers = new Map();
    const canvas = { addEventListener(name, callback) { pointerHandlers.set(name, callback); }, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }) };
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 50); camera.position.set(0, 1, 4); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    globalThis.window ||= { addEventListener() {}, removeEventListener() {} };
    const controller = createHumanIK({ getScene: () => scene, getCamera: () => camera, canvas, loadAmmo });
    const initial = bones.map(bone => ({ position: bone.position.clone(), rotation: bone.quaternion.clone() }));
    const point = key => bindings['bones:' + key].bone.getWorldPosition(new T.Vector3());
    const run = (frames, dt = 1 / 60) => { for (let i = 0; i < frames; i++) controller.apply(model, dt); };
    async function enable() {
        await controller.setMode('physics', model); controller.setEnabled(true, model);
        assert.equal(controller.getState().settings.gravity, false);
        controller.setBodySettings({ gravity: false });
        assert.equal(controller.getState().available, true, controller.getState().reason);
    }
    return { T, model, controller, bones, bindings, initial, point, run, enable, camera, pointerHandlers, canvas };
}

test('部位设置连续局部合并，状态快照与输入不能改写内部，切换模式保留设置', async () => {
    const f = await fixture();
    try {
        await f.enable();
        const defaults = f.controller.getState().settings.dampingMultipliers;
        assert.ok(defaults, '缺少分部位设置');
        const patch = { wrist: 0.6 };
        f.controller.setBodySettings({ dampingMultipliers: patch }); patch.wrist = 2;
        f.controller.setBodySettings({ dampingMultipliers: { head: 1.6 } });
        f.controller.setBodySettings({ gravity: true });
        const snapshot = f.controller.getState();
        assert.equal(snapshot.settings.dampingMultipliers.wrist, 0.6);
        assert.equal(snapshot.settings.dampingMultipliers.head, 1.6);
        assert.equal(snapshot.settings.dampingMultipliers.knee, defaults.knee);
        snapshot.settings.dampingMultipliers.wrist = 2;
        assert.equal(f.controller.getState().settings.dampingMultipliers.wrist, 0.6);
        await f.controller.setMode('pbd', f.model);
        await f.controller.setMode('physics', f.model);
        assert.equal(f.controller.getState().settings.dampingMultipliers.wrist, 0.6);
    } finally { f.controller.dispose(); }
});

test('图片姿态批量应用生成可编辑物理目标，坏输入不部分覆盖旧目标', async () => {
    const f = await fixture();
    try {
        await f.enable();
        assert.equal(typeof f.controller.applyImagePose, 'function', '缺少图片姿态应用入口');
        f.controller.setTarget('leftHand', f.point('leftWrist').add(new f.T.Vector3(0, 0.1, 0)));
        const before = f.controller.getState().controls.map(({ key, target, positionState }) => ({ key, target, positionState }));
        assert.throws(() => f.controller.applyImagePose({ landmarks: [], confidence: 1 }), /关键点/u);
        assert.deepEqual(f.controller.getState().controls.map(({ key, target, positionState }) => ({ key, target, positionState })), before);
        const landmarks = Array.from({ length: 33 }, () => ({ world: [0, -1.5, 0], visibility: 1, presence: 1 }));
        for (const [i, value] of [[11, [0.2, -1, 0]], [12, [-0.2, -1, 0]], [13, [0.5, -1, 0]], [14, [-0.5, -1, 0]],
            [15, [0.8, -1, 0]], [16, [-0.8, -1, 0]], [23, [0.1, 0, 0]], [24, [-0.1, 0, 0]],
            [25, [0.1, 0.4, 0]], [26, [-0.1, 0.4, 0]], [27, [0.1, 0.8, 0]], [28, [-0.1, 0.8, 0]]]) landmarks[i].world = value;
        f.controller.applyImagePose({ landmarks, confidence: 1 });
        assert.equal(f.controller.getState().activeTargets, 11);
        f.run(30);
        f.controller.setTarget('leftHand', f.point('leftWrist').add(new f.T.Vector3(0, 0.02, 0)));
        assert.equal(f.controller.getState().controls.find(item => item.key === 'leftHand').positionState, 'On');
        assert.ok(f.bones.every(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()].every(Number.isFinite)));
    } finally { f.controller.dispose(); }
});

test('位置Off仍保留显式旋转驱动，标记立即跟随骨骼；放开取消残余拖动', async () => {
    const f = await fixture();
    try {
        await f.enable(); const c = f.controller;
        c.setTarget('leftHand', f.point('leftWrist').add(new f.T.Vector3(0, 0.12, 0.12)),
            new f.T.Quaternion().setFromAxisAngle(new f.T.Vector3(0, 0, 1), 0.4));
        f.run(60); c.setTargetState('leftHand', 'Off', 'On');
        const released = c.getState().controls.find(item => item.key === 'leftHand');
        assert.equal(c.getState().activeTargets, 1); assert.equal(released.rotationState, 'On');
        assert.ok(new f.T.Vector3().fromArray(released.target).distanceTo(f.point('leftWrist')) < 1e-8);
        c.setTargetState('leftHand', 'Off', 'Off');
        const marker = c.getState().controls.find(item => item.key === 'leftHand');
        const event = { button: 0, isPrimary: true, pointerId: 7, clientX: marker.screen.x, clientY: marker.screen.y,
            currentTarget: f.canvas, stopImmediatePropagation() {}, preventDefault() {} };
        f.pointerHandlers.get('pointerdown')(event);
        assert.equal(c.getState().controls.find(item => item.key === 'leftHand').positionState, 'On');
        c.setTargetState('leftHand', 'Off', 'Off');
        f.pointerHandlers.get('pointermove')({ ...event, currentTarget: window, clientX: event.clientX + 80 });
        const final = c.getState().controls.find(item => item.key === 'leftHand');
        assert.equal(c.getState().activeTargets, 0);
        assert.ok(new f.T.Vector3().fromArray(final.target).distanceTo(f.point('leftWrist')) < 1e-8, '放开后旧拖动改写标记位置');
    } finally { f.controller.dispose(); }
});

test('真Ammo人体牵引手腕带动躯干、缩小误差且原生分配不随帧增长', async () => {
    const f = await fixture();
    try {
        await f.enable(); const c = f.controller;
        assert.equal(c.getState().targets, 11);
        const initial = f.point('leftWrist'), target = initial.clone().add(new f.T.Vector3(0.08, 0.22, 0.22));
        const allocations = c.getState().physics.allocations;
        c.setTarget('leftHand', target); f.run(180);
        const error = f.point('leftWrist').distanceTo(target);
        assert.ok(error < initial.distanceTo(target), `手腕误差未收敛：${error}`);
        const control = c.getState().controls.find(item => item.key === 'leftHand'), projected = target.clone().project(f.camera);
        assert.ok(Math.abs(control.screen.x - (projected.x + 1) * 300) < 1e-6, '屏幕命中坐标未对应活动目标标记');
        assert.ok(Math.abs(control.screen.y - (1 - projected.y) * 300) < 1e-6);
        assert.ok(f.bindings['bones:chest'].bone.quaternion.angleTo(new f.T.Quaternion()) > 0.002, '躯干未参与受力');
        assert.equal(c.getState().physics.allocations, allocations);
        for (const bone of f.bones) assert.ok([...bone.quaternion.toArray(), ...bone.position.toArray()].every(Number.isFinite));
    } finally { f.controller.dispose(); }
});

test('真Ammo膝脚多目标产生深屈膝，PMX旋转范围及骨长保持', async () => {
    const f = await fixture();
    try {
        await f.enable();
        const foot = f.point('leftAnkle'), knee = f.point('leftKnee');
        const target = foot.clone().add(new f.T.Vector3(0, 0.45, 0.2));
        f.controller.setTarget('leftFoot', target);
        f.controller.setTarget('leftKnee', knee.clone().add(new f.T.Vector3(0, 0.1, -0.25)));
        f.run(300);
        const rotation = f.bindings['bones:leftKnee'].bone.quaternion;
        const euler = new f.T.Euler().setFromQuaternion(rotation, 'XYZ');
        assert.ok(rotation.angleTo(new f.T.Quaternion()) > Math.PI / 4, `深屈膝不足：${euler.x}`);
        assert.ok(euler.x >= -2.6 - 1e-6 && euler.x <= 1e-6);
        assert.ok(Math.abs(euler.y) < 1e-6 && Math.abs(euler.z) < 1e-6);
        assert.ok(f.point('leftAnkle').distanceTo(target) < foot.distanceTo(target));
        f.bones.forEach((bone, index) => {
            if (bone !== f.bindings['bones:center'].bone) assert.ok(bone.position.distanceTo(f.initial[index].position) < 1e-8, `骨长发生变化：${bone.name}`);
        });
    } finally { f.controller.dispose(); }
});

test('On固定目标、Hold拒绝修改、Comply让步，旋转目标产生实际力矩', async () => {
    const f = await fixture();
    try {
        await f.enable(); const c = f.controller;
        const goal = f.point('leftWrist').add(new f.T.Vector3(-0.9, 0, 0));
        c.setTarget('leftHand', goal); f.run(45);
        assert.deepEqual(c.getState().controls.find(item => item.key === 'leftHand').target, goal.toArray());
        c.setTargetState('leftHand', 'Hold', 'Off');
        assert.throws(() => c.setTarget('leftHand', goal), /保持目标/u);
        c.setTargetState('leftHand', 'Comply', 'Off'); f.run(120);
        const moved = new f.T.Vector3().fromArray(c.getState().controls.find(item => item.key === 'leftHand').target);
        assert.ok(moved.distanceTo(goal) > 0.05, 'Comply没有让步');
        c.resetTargets();
        const rotation = new f.T.Quaternion().setFromAxisAngle(new f.T.Vector3(0, 0, 1), 0.6);
        c.setTarget('rightHand', null, rotation); f.run(120);
        assert.ok(f.bindings['bones:rightWrist'].bone.quaternion.angleTo(new f.T.Quaternion()) > 0.05);
    } finally { f.controller.dispose(); }
});

test('骨盆目标移动center，重置/关闭/模式切换恢复全部人体增量', async () => {
    const f = await fixture();
    try {
        await f.enable(); const c = f.controller;
        c.setTarget('pelvis', f.point('hips').add(new f.T.Vector3(0.16, 0.06, 0))); f.run(90);
        assert.ok(f.bindings['bones:center'].bone.position.x > 0.04, '骨盆位移未传递center');
        c.resetTargets();
        f.bones.forEach((bone, index) => {
            assert.ok(bone.position.distanceTo(f.initial[index].position) < 1e-8);
            assert.ok(bone.quaternion.angleTo(f.initial[index].rotation) < 1e-8);
        });
        c.setTarget('leftHand', f.point('leftWrist').add(new f.T.Vector3(0, 0.2, 0))); f.run(60);
        await c.setMode('pbd', f.model);
        assert.equal(c.getState().physics, null); assert.equal(c.getState().targets, 7);
        f.bones.forEach((bone, index) => assert.ok(bone.quaternion.angleTo(f.initial[index].rotation) < 1e-8));
        c.setEnabled(false); assert.equal(c.getState().targets, 0);
    } finally { f.controller.dispose(); }
});

test('相同物理时间在30/60/120fps下保持接近结果', async () => {
    const points = [];
    for (const fps of [30, 60, 120]) {
        const f = await fixture();
        try {
            await f.enable(); f.controller.setTarget('leftHand', f.point('leftWrist').add(new f.T.Vector3(0, 0.15, 0.15)));
            f.run(fps * 2, 1 / fps); points.push(f.point('leftWrist'));
        } finally { f.controller.dispose(); }
    }
    assert.ok(points[0].distanceTo(points[1]) < 0.04, `30/60fps偏差：${points[0].distanceTo(points[1])}`);
    assert.ok(points[1].distanceTo(points[2]) < 0.04, `60/120fps偏差：${points[1].distanceTo(points[2])}`);
});

test('关闭期间迟到Ammo加载不重新接管，加载失败保留可用PBD', async () => {
    let complete;
    const f = await fixture(() => new Promise(resolve => { complete = resolve; }));
    try {
        const request = f.controller.setMode('physics', f.model);
        f.controller.setEnabled(false); complete(await realAmmo()); await request;
        assert.equal(f.controller.getState().mode, 'pbd'); assert.equal(f.controller.getState().physics, null);
        f.controller.setEnabled(true, f.model);
        const oldModelRequest = f.controller.setMode('physics', f.model);
        f.controller.apply({ ...f.model }); complete(await realAmmo()); await oldModelRequest;
        assert.equal(f.controller.getState().mode, 'pbd', '迟到初始化重新接管了旧模型');
        const failure = await fixture(async () => { throw new Error('fixture unavailable'); });
        try {
            failure.controller.setEnabled(true, failure.model);
            await assert.rejects(failure.controller.setMode('physics', failure.model), /unavailable/u);
            assert.equal(failure.controller.getState().mode, 'pbd'); assert.equal(failure.controller.getState().available, true);
        } finally { failure.controller.dispose(); }
    } finally { f.controller.dispose(); }
});

test('人体世界释放所有分配并保持原PMX配置', async () => {
    const f = await fixture();
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../3rd/mmd-ar-test/web-human-physics-drive.mjs');
    const original = JSON.stringify(f.model.mesh.geometry.userData.MMD), rig = createHumanPhysicsRig(f.model);
    const drive = createHumanPhysicsDrive(await realAmmo(), rig);
    try { assert.ok(drive.getState().allocations > 0); }
    finally { rig.restore(); drive.dispose(); f.controller.dispose(); }
    assert.equal(drive.getState().allocations, 0); assert.equal(drive.getState().bodyCount, 0);
    assert.equal(JSON.stringify(f.model.mesh.geometry.userData.MMD), original);
});

test('Off取消目标后人体惯性与重力继续，骨盆自由仍由人体物理运动', async () => {
    const f = await fixture();
    try {
        await f.enable();
        const initial = f.point('hips');
        f.controller.setBodySettings({ gravity: false, freePelvis: true });
        f.controller.setTarget('pelvis', initial.clone().add(new f.T.Vector3(0, 0.3, 0))); f.run(120);
        const airborne = f.point('hips');
        assert.ok(airborne.y > initial.y + 0.15, '骨盆目标没有使身体离地');
        f.controller.setTargetState('pelvis', 'Off', 'Off');
        f.controller.setBodySettings({ gravity: true }); f.run(30);
        assert.equal(f.controller.getState().activeTargets, 0);
        assert.ok(f.point('hips').y < airborne.y - 0.05, '取消离地目标后没有继续身体重力');
        assert.ok(f.controller.getState().physics.substeps > 0);
        f.run(60);
        assert.ok(Math.min(f.point('leftAnkle').y, f.point('rightAnkle').y) > 0.02, '地面没有约束下落脚部');
        f.controller.setEnabled(false);
        assert.ok(f.point('hips').distanceTo(initial) < 1e-8);
    } finally { f.controller.dispose(); }
});

test('骨盆存在PMX显式限位时也约束物理旋转，不因根代理而跳过', async () => {
    const f = await fixture();
    try {
        f.model.mesh.geometry.userData.MMD.iks[0].links.push({ index: f.bindings['bones:hips'].index,
            rotationMin: [-0.1, -0.1, -0.1], rotationMax: [0.1, 0.1, 0.1] });
        await f.enable();
        f.controller.setTarget('pelvis', null, new f.T.Quaternion().setFromAxisAngle(new f.T.Vector3(0, 0, 1), 0.6));
        f.run(90);
        const rotation = new f.T.Euler().setFromQuaternion(f.bindings['bones:hips'].bone.quaternion);
        assert.ok([rotation.x, rotation.y, rotation.z].every(value => Math.abs(value) <= 0.100001));
    } finally { f.controller.dispose(); }
});

test('center同级上下半身随物理骨盆转动，默认人体限位使用关节相对角', async () => {
    const f = await fixture();
    try {
        await f.enable();
        f.controller.setTarget('pelvis', null, new f.T.Quaternion().setFromAxisAngle(new f.T.Vector3(0, 1, 0), 1.3));
        f.run(180);
        const rotation = new f.T.Euler().setFromQuaternion(f.bindings['bones:upperBody'].bone.quaternion, 'YXZ');
        assert.ok(rotation.y > 0.9, `躯干世界转角被误限幅：${rotation.y}`);
    } finally { f.controller.dispose(); }
});

test('增强默认牵引在0.5/1秒内减小可达目标误差，软档保留且超调有界', async () => {
    const results = [];
    for (const strength of [0.15, null]) {
        const f = await fixture();
        try {
            await f.enable();
            if (strength !== null) f.controller.setBodySettings({ strength });
            else assert.equal(f.controller.getState().settings.strength, 0.85);
            const initial = f.point('leftWrist'), goal = initial.clone().add(new f.T.Vector3(0.08, 0.22, 0.22));
            f.controller.setTarget('leftHand', goal);
            const errors = []; let peak = 0;
            for (let frame = 1; frame <= 180; frame++) {
                f.run(1); peak = Math.max(peak, f.point('leftWrist').distanceTo(initial));
                if ([30, 60, 180].includes(frame)) errors.push(f.point('leftWrist').distanceTo(goal));
            }
            assert.ok(peak < initial.distanceTo(goal) * 1.35, `牵引超调过大：${peak}`);
            results.push(errors);
        } finally { f.controller.dispose(); }
    }
    for (const index of [0, 1]) {
        assert.ok(results[1][index] < 0.01, `默认${index ? 1 : 0.5}秒误差：${results[1][index]}`);
        assert.ok(results[1][index] < results[0][index] * 0.7, '软硬档未产生实际响应差异');
    }
});

test('强档保持与多点对抗在重力下持续稳定并保留PMX限位', async () => {
    const f = await fixture();
    try {
        await f.enable(); f.controller.setBodySettings({ strength: 1, gravity: true });
        for (const [key, semantic, offset] of [['leftHand', 'leftWrist', [-0.1, 0.2, 0.1]],
            ['rightHand', 'rightWrist', [0.1, 0.2, -0.1]], ['leftFoot', 'leftAnkle', [0, 0.2, 0.1]],
            ['pelvis', 'hips', [0, 0.04, 0]]]) {
            f.controller.setTarget(key, f.point(semantic).add(new f.T.Vector3(...offset)));
            f.controller.setTargetState(key, 'Hold', 'Off');
        }
        const allocations = f.controller.getState().physics.allocations;
        for (let i = 0; i < 600; i++) {
            f.run(1);
            assert.ok(f.bones.every(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()].every(Number.isFinite)));
            assert.ok(f.point('hips').distanceTo(f.initial[f.bindings['bones:hips'].index].position) < 0.3);
            for (const side of ['left', 'right']) {
                const angle = new f.T.Euler().setFromQuaternion(f.bindings['bones:' + side + 'Knee'].bone.quaternion);
                assert.ok(angle.x >= -2.600001 && angle.x <= 0.000001 && Math.abs(angle.y) < 1e-6 && Math.abs(angle.z) < 1e-6);
            }
        }
        assert.equal(f.controller.getState().physics.allocations, allocations);
    } finally { f.controller.dispose(); }
});
