'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeModel } = require('./helpers/mmd-human-real-pmx');

const example = () => ({ format: 'ik-targets', version: 1, duration: 2, frames: [
    { time: 0, targets: { head: { rotation: [0, 0, 0] } } },
    { time: 1, targets: { head: { rotation: [12, 0, 0] } } },
    { time: 2, targets: { head: { rotation: [0, 0, 0] } } }
] });
const contract = () => import('../src/apps/web-mediacenter/ui/public/js/mmd-ik-plan.mjs');

test('全部28类内置动作走IK目标，极短/多轮时缩幅且不写骨骼轨道，源码与采样一致', async () => {
    const { model } = await makeModel();
    const { ADVANCED_GESTURES } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-reply-gestures.mjs');
    const { createBuiltinIKSampler } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-reply-ik-gestures.mjs');
    for (const gesture of ADVANCED_GESTURES) for (const parameters of [
        { duration: 0.2, count: 8, strength: 1 }, { duration: 4, count: 1, strength: 0.7 },
        { duration: 15, count: 8, strength: 1 }, { duration: 2, count: 2, strength: 0 }
    ]) {
        const result = createBuiltinIKSampler({ name: gesture.name, ...parameters }, model);
        assert.equal(result.duration, parameters.duration);
        assert.ok(result.plan.frames.length <= 48);
        assert.ok(result.tracks.some(track => track.kind === 'ik'));
        assert.ok(result.tracks.every(track => ['ik', 'morph'].includes(track.kind)));
        assert.deepEqual(JSON.parse(result.source), result.plan);
        for (const track of result.tracks) {
            assert.ok(track.evaluate(result.duration * 0.4).every(Number.isFinite));
            assert.ok(track.evaluate(0).every(value => value === 0));
            assert.ok(track.evaluate(result.duration).every(value => value === 0));
        }
        if (parameters.strength === 0) for (const track of result.tracks) assert.ok(track.evaluate(result.duration * 0.4).every(value => value === 0));
    }
});

test('内置IK表情按真实Morph/独立权重解析，缺部位告警且动态骨不接管，参数错误明确拒绝', async () => {
    const { model } = await makeModel();
    const { createBuiltinIKPlan } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-reply-ik-gestures.mjs');
    model.morphs = [{ name: '照れ', index: 0, supported: true, panel: 1 }];
    const result = createBuiltinIKPlan({ name: '比心', duration: 4, strength: 0.7 }, model);
    assert.ok(Math.abs(result.plan.frames[2].morphs['照れ'] - 0.7 * 0.24 * 0.9) < 1e-8);
    assert.ok(result.plan.frames[2].targets.leftHand.position.every((value, index) => Math.abs(value - [-0.12, 0.19, 0.13][index]) < 1e-8));
    model.bindings['bones:leftWrist'].dynamic = true;
    model.bindings['bones:rightWrist'] = null;
    const degraded = createBuiltinIKPlan({ name: '比心' }, model);
    assert.deepEqual(Object.keys(degraded.plan.frames[1].targets), ['head']);
    assert.match(degraded.warnings.join(' '), /leftHand.*rightHand/);
    model.bindings['bones:head'] = null;
    assert.throws(() => createBuiltinIKPlan({ name: '比心' }, model), /缺少/);
    for (const options of [{ name: '不存在' }, { duration: NaN }, { strength: -1 }, { count: 0 }, { count: 1.5 }]) {
        assert.throws(() => createBuiltinIKPlan({ name: '点头', ...options }, model));
    }
});

test('IK格式规范化保留原输入，约束时长/部位/通道/首尾/速度与真实Morph', async () => {
    const { normalizeIKPlan } = await contract();
    const original = example(), normalized = normalizeIKPlan(original, { ikTargets: ['head'], morphs: [] });
    normalized.frames[1].targets.head.rotation[0] = 10;
    assert.equal(original.frames[1].targets.head.rotation[0], 12);
    const changes = [value => { value.duration = 16; }, value => { value.frames[1].time = 0; },
        value => { value.frames[2].time = 1.9; }, value => { value.frames[0].targets.head.rotation[0] = 1; },
        value => { value.frames[1].targets.hand = { position: [0, 0, 0] }; },
        value => { value.frames[1].targets.head.rotation[0] = NaN; },
        value => { value.frames[1].targets.head.rotation[0] = 91; },
        value => { value.frames[1].time = 0.001; },
        value => { value.frames[1].time = 0.1; value.frames[1].targets.head.rotation[0] = 30; },
        value => { value.frames[1].targets.head.position = [0, 0.51, 0]; },
        value => { value.frames[1].morphs = { fictional: 0.5 }; }];
    for (const change of changes) { const value = example(); change(value); assert.throws(() => normalizeIKPlan(value, { ikTargets: ['head'], morphs: [] })); }
    assert.throws(() => normalizeIKPlan(example(), { ikTargets: [], morphs: [] }), /不可用/);
    assert.throws(() => normalizeIKPlan({ ...example(), frames: Array(49).fill(example().frames[0]) }), /帧数/);
});

test('IK采样复用动作时长/次数，生成目标轨道和真实Morph而不生成骨骼旋转轨道', async () => {
    const { model } = await makeModel(); const { createIKSampler } = await contract();
    const value = example();
    for (const frame of value.frames) frame.morphs = { smile: frame.time === 1 ? 0.3 : 0 };
    model.morphs = [{ name: 'smile', index: 0 }];
    const sampler = createIKSampler(JSON.stringify(value), model, { duration: 1, count: 2 });
    assert.equal(sampler.duration, 2);
    assert.deepEqual(sampler.tracks.map(track => track.kind), ['ik', 'morph']);
    assert.deepEqual(sampler.tracks[0].evaluate(0), [0, 0, 0]);
    assert.deepEqual(sampler.tracks[0].evaluate(0.5), [12, 0, 0]);
    assert.deepEqual(sampler.tracks[0].evaluate(1.5), [12, 0, 0]);
    assert.deepEqual(sampler.tracks[0].evaluate(2), [0, 0, 0]);
    assert.equal(sampler.tracks[1].evaluate(0.5)[0], 0.3);
});

test('新旧候选/版本共存，IK格式导入导出不更改旧默认或丢失MPL', async () => {
    const storage = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-storage.mjs');
    const record = storage.emptyHumanLibrary();
    record.actions.push({ actionId: '旧动作', active: 'old', versions: [{ id: 'old', source: '@pose rest {}' }] });
    const candidate = { id: 'ik1', requestId: 'job1', description: '点头', format: 'ik-targets',
        source: JSON.stringify(example()), providerId: 'fixture', model: 'model' };
    record.candidates.push(candidate);
    const restored = await storage.importHumanLibrary(storage.exportHumanLibrary(record));
    assert.equal(restored.actions[0].active, 'old');
    assert.deepEqual(restored.candidates, [candidate]);
    assert.throws(() => storage.validateHumanLibrary({ ...record,
        candidates: [{ ...candidate, source: JSON.stringify({ ...example(), duration: 99 }) }] }), /IK/);
});

test('IK混合遵循外部时钟，零强度不接管，停止后释放，采样不直接旋转骨骼', async () => {
    const { model } = await makeModel(), { createIKSampler } = await contract();
    const { createHumanMixer } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-mixer.mjs');
    const sampler = createIKSampler(JSON.stringify(example()), model), mixer = createHumanMixer();
    model.allowed = () => true;
    const head = model.bindings['bones:head'].bone, original = head.quaternion.clone();
    let time = 1;
    const layers = strength => [{ sampler, start: 0, duration: 2, speed: 1, strength, mode: 'override', mask: [] }];
    mixer.start({ owner: 'voice', layers: layers(0), duration: 2, clock: () => time });
    mixer.mix(model); assert.equal(mixer.ikTargets().size, 0);
    mixer.start({ owner: 'voice', layers: layers(1), duration: 2, clock: () => time });
    mixer.mix(model); assert.deepEqual(mixer.ikTargets().get('head').rotation, [12, 0, 0]);
    mixer.advance(0.1); mixer.mix(model); assert.deepEqual(mixer.ikTargets().get('head').rotation, [12, 0, 0]);
    assert.equal(head.quaternion.angleTo(original), 0);
    mixer.stop('voice'); mixer.mix(model); assert.equal(mixer.ikTargets().size, 0);
    time = 0;
    mixer.start({ owner: 'other', layers: layers(1), duration: 2, clock: () => time });
    mixer.mix(model); assert.equal(mixer.ikTargets().size, 0);
});

test('真实PMX旧姿态转换为IK世界目标，明确手部目标释放上游且模型变换保持归一意图', async () => {
    const { T, model } = await makeModel();
    const { createHumanPhysicsRig } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-physics-rig.mjs');
    const { createAutomaticIKTargets } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-ik-targets.mjs');
    const rig = createHumanPhysicsRig(model), animated = rig.animatedPoses();
    const wrist = rig.nodes.find(node => node.semantic === 'leftWrist');
    const targets = createAutomaticIKTargets(rig, animated);
    assert.ok(targets.length >= 14); assert.ok(targets.every(target => target.automatic));
    assert.ok(!targets.some(target => target.node === rig.pelvis));
    assert.ok(targets.find(target => target.node === wrist).target.distanceTo(model.bindings['bones:leftWrist'].bone.getWorldPosition(new T.Vector3())) < 1e-5);
    model.mesh.scale.setScalar(1.8); model.mesh.rotation.y = 0.5; model.mesh.updateMatrixWorld(true);
    const plan = new Map([['leftHand', { position: [0, 0.12, 0] }]]);
    const posed = createAutomaticIKTargets(rig, animated, plan);
    const hand = posed.find(target => target.node === wrist);
    assert.ok(rig.targetToLocal(hand.target).distanceTo(wrist.position.clone().add(new T.Vector3(0, 0.192, 0))) < 1e-6);
    assert.equal(hand.rotationState, 'Off');
    assert.equal(posed.find(target => target.node.semantic === 'leftElbow').positionState, 'Off');
    assert.equal(posed.find(target => target.node.semantic === 'rightWrist').positionState, 'On');
    rig.restore();
});

test('正式Human默认IK初始化、隐藏期间取消、恢复、手动接管和关闭均走真实资源生命周期', { timeout: 15000 }, async () => {
    const { T, model } = await makeModel();
    const globals = new Map(['window', 'document', 'Ammo'].map(key => [key, globalThis[key]]));
    const events = { addEventListener() {}, removeEventListener() {} };
    globalThis.window = { ...events };
    globalThis.document = { ...events, hidden: false, querySelector: () => null, getElementById: () => null };
    globalThis.Ammo = await require('../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js')({
        wasmBinary: fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm')) });
    const { createHumanInterfaceElement } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-interface.mjs');
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 10, 30); camera.lookAt(0, 10, 0); scene.add(model.mesh);
    const helper = { enabled: { physics: true } };
    const api = createHumanInterfaceElement({ getMesh: () => model.mesh, getHelper: () => helper,
        getProfile: () => ({}), getCamera: () => camera, getScene: () => scene,
        canvas: { ...events, getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 320 }) },
        manualExpressions: { getState: () => ({ items: [] }), setHuman() {}, clearHuman() {} }, startRendering() {} });
    const settle = async predicate => {
        for (let i = 0; i < 200 && !predicate(); i++) { api.before(1 / 60, helper); await new Promise(resolve => setTimeout(resolve, 2)); }
        assert.ok(predicate(), JSON.stringify(api.getState()));
    };
    try {
        await settle(() => api.getState().ready);
        api.before(1 / 60, helper); api.setVisible(false);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(api.getInteractiveIKState().enabled, false, '迟到初始化不得在隐藏时开启');
        api.setVisible(true);
        await settle(() => !api.getState().automaticMotionBlocked);
        assert.equal(api.getInteractiveIKState().mode, 'physics');
        assert.equal(api.getInteractiveIKState().markersVisible, false);
        helper.onHumanPose(model.mesh); helper.onHumanAfterIK(model.mesh, 1 / 60);
        assert.ok(api.getInteractiveIKState().automaticTargets > 0);
        const source = JSON.parse(api.mpl.advancedSource({ name: '比心', duration: 4, strength: 0.7 }));
        assert.equal(source.format, 'ik-targets');
        const baseline = api.getInteractiveIKState().controls.find(item => item.key === 'leftHand').achieved[1];
        const request = await api.perform({ action: '比心', owner: 'test:builtin', duration: 4, strength: 0.7 });
        assert.equal(request.buffer, undefined, '内置IK不依赖MPL Worker编译');
        for (let frame = 0; frame < 120; frame++) {
            api.before(1 / 60, helper); helper.onHumanPose(model.mesh); helper.onHumanAfterIK(model.mesh, 1 / 60);
        }
        assert.ok(api.getInteractiveIKState().controls.find(item => item.key === 'leftHand').achieved[1] > baseline + 1);
        api.stop('test:builtin');
        assert.equal(api.getRequest(request.id).reason, 'stopped');
        const zero = await api.perform({ action: '比心', owner: 'test:zero', duration: 2, strength: 0 });
        api.before(0.1, helper); helper.onHumanPose(model.mesh); helper.onHumanAfterIK(model.mesh, 0.1);
        assert.equal(api.getInteractiveIKState().unreachable, 0);
        api.stop('test:zero'); assert.equal(api.getRequest(zero.id).active, false);
        api.setInteractiveTargetState('leftHand', 'On', 'Off');
        assert.equal(api.getState().automaticMotionBlocked, true);
        api.resetInteractiveIK(); assert.equal(api.getState().automaticMotionBlocked, false);
        api.setInteractiveMarkersVisible(true); assert.equal(api.getInteractiveIKState().markersVisible, true);
        api.setInteractiveIKEnabled(false); api.before(1 / 60, helper);
        assert.equal(api.getInteractiveIKState().enabled, false);
        assert.equal(api.getInteractiveIKState().automaticTargets, 0);
        assert.equal(api.getState().automaticMotionBlocked, true);
    } finally {
        api.dispose();
        assert.equal(scene.children.filter(child => child !== model.mesh).length, 0);
        for (const [key, value] of globals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
});

test('真实Ammo在30/60fps统一求解旧姿态和新IK目标，限位/有限姿态/释放/内存不累积', { timeout: 30000 }, async t => {
    const { createHumanPhysicsRig } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-physics-drive.mjs');
    const { createAutomaticIKTargets } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-ik-targets.mjs');
    const Ammo = await require('../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js')({
        wasmBinary: fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm')) });
    for (const fps of [30, 60]) {
        const { T, model } = await makeModel(), rig = createHumanPhysicsRig(model), drive = createHumanPhysicsDrive(Ammo, rig);
        const allocations = drive.getState().allocations, timings = [];
        const wrist = rig.nodes.find(node => node.semantic === 'leftWrist');
        let peakLift = 0, remaining = Infinity;
        try {
            for (let frame = 0; frame < fps * 3; frame++) {
                rig.restore(); const animated = rig.animatedPoses();
                const offset = frame < fps * 2 ? Math.sin(frame / (fps * 2) * Math.PI) * 0.1 : 0;
                const channels = frame < fps * 2 ? new Map([['leftHand', { position: [0, offset, 0] }]]) : new Map();
                const result = drive.step(1 / fps, animated, createAutomaticIKTargets(rig, animated, channels), {});
                timings.push(drive.getState().frameMs);
                const achieved = rig.targetToLocal(wrist.bone.getWorldPosition(new T.Vector3()));
                peakLift = Math.max(peakLift, achieved.y - wrist.position.y);
                remaining = achieved.distanceTo(wrist.position);
                assert.ok([...result.values()].every(pose => [...pose.position.toArray(), ...pose.quaternion.toArray()].every(Number.isFinite)));
                for (const bone of model.bones) assert.ok(bone.bone.quaternion.toArray().every(Number.isFinite));
                assert.equal(drive.getState().allocations, allocations);
            }
            assert.ok(peakLift > 0.02, `目标没有实际抬高手腕：${peakLift}`);
            assert.ok(remaining < peakLift, `释放后没有回到基准附近：${remaining} / ${peakLift}`);
            t.diagnostic(`${fps}fps求解平均${(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(2)}ms，${allocations}项原生分配固定`);
        } finally { drive.dispose(); rig.restore(); }
        assert.equal(drive.getState().allocations, 0);
    }
});
