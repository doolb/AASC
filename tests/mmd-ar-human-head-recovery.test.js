const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture(settings = {}) {
    const THREE = await import('three');
    const { createHumanGaze } = await import('../3rd/mmd-ar-test/web-human-gaze.mjs');
    const { createHumanMixer } = await import('../3rd/mmd-ar-test/web-human-mixer.mjs');
    const mesh = new THREE.Object3D();
    mesh.geometry = { userData: { MMD: { grants: [] } } };
    mesh.morphTargetInfluences = [];
    const bones = ['head', 'eye', 'arm'].map((name, index) => {
        const bone = new THREE.Bone(); mesh.add(bone);
        return { name, index, bone, dynamic: false, restPosition: bone.position.clone(), restQuaternion: bone.quaternion.clone() };
    });
    const model = { mesh, bones, morphs: [], bindings: { 'bones:head': bones[0], 'bones:leftEye': bones[1] },
        allowed: (track, mask) => !mask || mask.includes(track.index) };
    const camera = new THREE.PerspectiveCamera(); camera.position.set(4, 0, 5); camera.lookAt(0, 0, 0);
    const gaze = createHumanGaze(), mixer = createHumanMixer();
    gaze.set({ strength: 1, headYaw: 85, headMs: 0, eyes: false, ...settings });
    const quaternion = angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const frame = (delta = 1 / 60) => {
        mixer.restore(); mixer.advance(delta);
        mixer.mix(model, [], [], (save, occupied, rotations) => gaze.apply(model, camera, delta, save, occupied, rotations));
        return bones[0].bone.quaternion.clone();
    };
    const action = ({ owner = 'test', angle = -0.6, duration = 1, fade = 0.12, index = 0,
        strength = 1, loop = false, layerStart = 0, layerDuration = duration, mask } = {}) => {
        const sampler = { duration, tracks: [{ kind: 'bone', index, property: 'quaternion',
            evaluate: () => quaternion(angle).toArray() }] };
        return mixer.start({ owner, duration, fade, loop, layers: [{ start: layerStart, duration: layerDuration,
            strength, sampler, mode: 'override', mask }] }).id;
    };
    const run = (seconds, fps = 60) => {
        let result;
        for (let i = 0; i < Math.round(seconds * fps); i++) result = frame(1 / fps);
        return result;
    };
    frame();
    return { THREE, model, camera, gaze, mixer, bones, quaternion, frame, action, run };
}

test('头部自然淡出从最后显示姿态开始，600ms内平滑返回跟随', async () => {
    const f = await fixture();
    const target = f.frame(), id = f.action();
    const held = f.run(0.85);
    assert.ok(held.angleTo(f.quaternion(-0.6)) < 1e-7);
    f.frame();
    const previous = f.bones[0].bone.quaternion.clone();
    const released = f.frame();
    assert.ok(released.angleTo(previous) < 1e-7, '首个淡出恢复帧必须连续');
    const halfway = f.run(0.3);
    assert.ok(halfway.angleTo(previous) > 0.2);
    assert.ok(halfway.angleTo(target) > 0.2, '恢复不能沿120ms动作淡出立即完成');
    const restored = f.run(0.3);
    assert.ok(restored.angleTo(target) < 1e-7);
    assert.equal(f.mixer.state(id).reason, 'ended');
    assert.ok(f.frame().angleTo(restored) < 1e-7, '结束后不能重启恢复或积累注视');
});

for (const fps of [30, 60, 120]) {
    test(`手动停止立即取消请求，头部在${fps}fps保持600ms恢复`, async () => {
        const f = await fixture();
        const target = f.frame(), id = f.action({ fade: 0 });
        const previous = f.run(0.2, fps);
        f.mixer.stop('test');
        assert.equal(f.mixer.state(id).reason, 'stopped');
        assert.ok(f.frame(1 / fps).angleTo(previous) < 1e-7);
        assert.ok(f.run(0.3, fps).angleTo(target) > 0.3);
        assert.ok(f.run(0.3, fps).angleTo(target) < 1e-7);
    });
}

test('恢复时相机目标移动仍更新，零delta不推进，卡顿最多推进100ms', async () => {
    const f = await fixture();
    f.action({ fade: 0 }); const previous = f.run(0.2);
    f.mixer.stop(); f.frame();
    assert.ok(f.frame(0).angleTo(previous) < 1e-7);
    const slow = f.frame(8);
    assert.ok(slow.angleTo(previous) < 0.15, '单次卡顿不跳过整个恢复');
    f.camera.position.set(-5, 2, 6);
    const restored = f.run(0.5);
    const expected = new f.THREE.Quaternion().setFromEuler(new f.THREE.Euler(
        -Math.atan2(2, Math.hypot(5, 6)), Math.atan2(-5, 6), 0, 'YXZ'));
    assert.ok(restored.angleTo(expected) < 1e-7);
    assert.ok(f.frame().angleTo(expected) < 1e-7);
});

test('恢复中新的头部动作接管，零权重淡入帧也取消旧恢复', async () => {
    const f = await fixture();
    const target = f.frame();
    f.action({ fade: 0 }); f.run(0.2); f.mixer.stop(); f.frame(); f.run(0.1);
    f.action({ owner: 'next', angle: 0.3 });
    assert.ok(f.frame(0).angleTo(target) < 1e-7, '新动作从已有混合规则淡入，不能被旧恢复覆盖');
    assert.ok(f.run(0.2).angleTo(f.quaternion(0.3)) < 1e-7);
});

test('零强度、遮罩排除和非头部动作不启动头部恢复', async () => {
    for (const params of [{ index: 2 }, { strength: 0 }, { mask: [2] }]) {
        const f = await fixture(); const before = f.frame();
        f.action(params); f.run(1.1);
        assert.ok(f.frame().angleTo(before) < 1e-7);
    }
});

test('多owner旋转占用必须全部释放，保留仍在播放的头部动作', async () => {
    const f = await fixture();
    f.action({ owner: 'long', angle: 0.3, duration: 2, fade: 0 });
    f.action({ owner: 'short', angle: -0.6, duration: 1 });
    f.run(0.9);
    assert.ok(f.run(0.3).angleTo(f.quaternion(0.3)) < 1e-7);
});

test('层窗口淡出启动恢复，循环下一轮的头部接管取消上一轮恢复', async () => {
    const f = await fixture();
    f.action({ loop: true, duration: 0.6, layerDuration: 0.4 });
    f.run(0.2);
    const held = f.bones[0].bone.quaternion.clone();
    f.run(0.15);
    assert.ok(f.bones[0].bone.quaternion.angleTo(held) < 0.1);
    assert.ok(f.run(0.45).angleTo(f.quaternion(-0.6)) < 1e-7, '下一轮动作必须拿回旋转通道');
});

test('reset、关闭头部和换模型清理旧恢复；普通headMs继续指数缓动', async () => {
    for (const cleanup of ['reset', 'disable', 'model']) {
        const f = await fixture(); const target = f.frame();
        f.action({ fade: 0 }); f.run(0.2); f.mixer.stop(); f.frame();
        if (cleanup === 'reset') f.gaze.reset();
        if (cleanup === 'disable') { f.gaze.set({ head: false }); f.frame(); f.gaze.set({ head: true }); }
        if (cleanup === 'model') {
            f.mixer.restore();
            f.model.bindings = { ...f.model.bindings };
            const replacement = { ...f.model };
            f.mixer.mix(replacement, [], [], (save, occupied, rotations) => f.gaze.apply(replacement, f.camera, 0, save, occupied, rotations));
        }
        assert.ok(f.frame().angleTo(target) < 1e-7);
    }
    const f = await fixture({ headMs: 200 });
    f.gaze.reset(); f.mixer.restore();
    const result = f.frame(0.1);
    const expected = Math.atan2(4, 5) * (1 - Math.exp(-0.5));
    assert.ok(result.angleTo(f.quaternion(expected)) < 1e-7);
});

test('头部恢复不延长眼球或其他骨骼的停止', async () => {
    const f = await fixture({ eyes: true, eyeMs: 0 });
    f.action({ fade: 0 }); f.action({ owner: 'arm', index: 2, fade: 0 });
    f.action({ owner: 'eye', index: 1, fade: 0 }); f.run(0.2);
    f.mixer.stop(); const headPose = f.frame();
    assert.ok(headPose.angleTo(f.quaternion(-0.6)) < 1e-7);
    assert.ok(f.bones[2].bone.quaternion.angleTo(f.quaternion(0)) < 1e-7);
    assert.ok(f.bones[1].bone.quaternion.angleTo(f.quaternion(Math.min(Math.atan2(4, 5), 20 * Math.PI / 180))) < 1e-7);
});

test('恢复期间点击目标动态生效，返回相机不会重新起计时', async () => {
    const f = await fixture();
    f.action({ fade: 0 }); f.run(0.2); f.mixer.stop(); f.frame(); f.run(0.1);
    assert.equal(f.gaze.point(f.model, f.camera, -0.8, 0.6), true);
    f.run(0.2);
    assert.equal(f.gaze.status(f.model).target, 'pointer');
    f.gaze.returnToCamera();
    const restored = f.run(0.3);
    assert.ok(restored.angleTo(f.quaternion(Math.atan2(4, 5))) < 1e-7);
});

test('默认200ms普通跟随下恢复角速度有界，淡入中停止也从当前姿态恢复', async () => {
    for (const playing of [0.05, 0.3]) {
        const f = await fixture({ headMs: 200 });
        f.run(1); f.action(); f.run(playing);
        let previous = f.bones[0].bone.quaternion.clone();
        f.mixer.stop();
        assert.ok(f.frame().angleTo(previous) < 1e-7);
        for (let i = 0; i < 36; i++) {
            const current = f.frame();
            assert.ok(current.angleTo(previous) < 0.07, '60fps单帧变化应小于4度');
            previous = current;
        }
        assert.ok(previous.angleTo(f.quaternion(Math.atan2(4, 5))) < 0.04);
        f.mixer.restore();
        assert.ok(f.bones[0].bone.quaternion.angleTo(f.quaternion(0)) < 1e-7, '显示恢复不能污染基础姿态');
    }
});
