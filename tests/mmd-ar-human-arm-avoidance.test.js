'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture(shape = 0) {
    const THREE = await import('three');
    const { createHumanArmAvoidance } = await import('../3rd/mmd-ar-test/web-human-arm-avoidance.mjs');
    const arm = new THREE.Bone(), elbow = new THREE.Bone(), wrist = new THREE.Bone();
    arm.position.set(0, 2, 0); elbow.position.set(1, 0, 0); wrist.position.set(1, 0, 0); arm.add(elbow); elbow.add(wrist);
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); mesh.add(arm);
    mesh.bind(new THREE.Skeleton([arm, elbow, wrist]));
    const defaults = { width: 0.2, height: 0.2, depth: 0.2, friction: 0, restitution: 0, groupIndex: 0, groupTarget: 65535,
        position: [0, 0, 0], rotation: [0, 0, 0] };
    mesh.geometry.userData.MMD = { rigidBodies: [{ ...defaults, shapeType: 0, type: 0, boneIndex: 2 },
        { ...defaults, shapeType: shape, type: 1, boneIndex: -1 }], constraints: [], iks: [] };
    const entry = (bone, index) => ({ bone, index, dynamic: false });
    const model = { mesh, bindings: { 'bones:rightArm': entry(arm, 0), 'bones:rightElbow': entry(elbow, 1), 'bones:rightWrist': entry(wrist, 2) },
        groups: { rightArm: new Set([0, 1, 2]) } };
    const cloth = new THREE.Vector3(2, 2.15, 0);
    const physics = { getBodyPose(index, position, quaternion) { position.copy(cloth); quaternion.identity(); return index === 1; } };
    const avoidance = createHumanArmAvoidance();
    const frame = (enabled = true, dt = 1 / 60) => { avoidance.restore(); avoidance.apply(model, physics, dt, enabled); return avoidance.getState(); };
    return { THREE, model, mesh, arm, elbow, wrist, cloth, physics, avoidance, frame };
}

for (const shape of [0, 1, 2]) test(`物理形状${shape}接触触发有界IK，重复帧不累计旋转且接触减少`, async () => {
    const { frame, avoidance, wrist, THREE, arm, elbow } = await fixture(shape);
    const initial = frame(); assert.ok(initial.contacts > 0); const y = wrist.getWorldPosition(new THREE.Vector3()).y;
    // 600ms限制整个修正角速度：首帧和接触目标变化均不得突然跳到IK结果。
    const step = 35 * Math.PI / 180 / 0.6 / 60 + 1e-6;
    for (const bone of [arm, elbow]) assert.ok(bone.quaternion.angleTo(new THREE.Quaternion()) <= step);
    for (let i = 0; i < 75; i++) {
        const before = [arm.quaternion.clone(), elbow.quaternion.clone()]; frame();
        for (const [index, bone] of [arm, elbow].entries()) assert.ok(bone.quaternion.angleTo(before[index]) <= step);
    }
    const result = avoidance.getState(); assert.ok(result.remaining < initial.contacts);
    assert.ok(wrist.getWorldPosition(new THREE.Vector3()).y < y);
    assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) <= 35 * Math.PI / 180 + 1e-6);
    assert.ok(elbow.quaternion.angleTo(new THREE.Quaternion()) <= 35 * Math.PI / 180 + 1e-6);
    assert.ok(result.iterations <= 4); avoidance.dispose();
});

test('关闭避让从当前修正600ms释放，开关默认/保存/存储失败语义明确', async () => {
    const { frame, arm, avoidance, THREE } = await fixture();
    for (let i = 0; i < 40; i++) frame();
    const before = arm.quaternion.clone(); frame(false);
    assert.ok(arm.quaternion.angleTo(before) < 0.01);
    for (let i = 0; i < 36; i++) frame(false);
    assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
    const { readArmAvoidancePreference: read } = await import('../3rd/mmd-ar-test/web-human-arm-avoidance.mjs');
    assert.equal(read({ getItem: () => null }), true); assert.equal(read({ getItem: () => 'false' }), false);
    assert.equal(read({ getItem() { throw new Error('不可用'); } }), true); avoidance.dispose();
});

for (const fps of [30, 60, 120]) test(`风吹接触法线交替在${fps}fps保持稳定，短断续不回拉，稳定离开600ms释放`, async () => {
    const { frame, cloth, wrist, arm, elbow, THREE, avoidance } = await fixture();
    const dt = 1 / fps;
    // 先达到真实接触避让位置，再让同一裙摆刚体在手的前后高速晃动。
    for (let i = 0; i < 2 * fps; i++) frame(true, dt);
    let previous = wrist.getWorldPosition(new THREE.Vector3()), remaining = 0, path = 0;
    const start = previous.clone(), original = new THREE.Vector3(2, 2, 0);
    let previousDistance = previous.distanceTo(original);
    for (let i = 0; i < 2 * fps; i++) {
        cloth.set(2, 2.15, i % 2 ? 0.12 : -0.12);
        const state = frame(true, dt); remaining += state.remaining;
        const current = wrist.getWorldPosition(new THREE.Vector3());
        path += current.distanceTo(previous);
        assert.ok(current.distanceTo(original) <= previousDistance + 1e-6, '安全回归应单调接近原动作，不能来回抖动');
        assert.ok(state.stepDegrees <= 35 / 0.6 / fps + 1e-4); assert.ok(state.returnAttempts <= 2);
        previousDistance = current.distanceTo(original); previous = current;
    }
    // 允许安全回归的净位移，但来回抖动会产生明显多余路程；旧重算实现约12单位路径仍失败。
    assert.ok(path <= start.distanceTo(previous) * 1.1 + 0.002, '交替接触多余路程=' + path); assert.equal(remaining, 0);
    const held = arm.quaternion.clone(); cloth.set(20, 20, 20);
    for (let i = 0; i < Math.floor(fps * 0.05); i++) frame(true, dt);
    assert.ok(arm.quaternion.angleTo(held) < 1e-6);
    cloth.set(2, 2.15, 0); frame(true, dt);
    assert.ok(arm.quaternion.angleTo(held) < 0.002, '短暂无接触后不能先回拉再避让');
    cloth.set(20, 20, 20);
    for (let i = 0; i < Math.ceil(fps * 0.6) + 1; i++) frame(true, dt);
    for (const bone of [arm, elbow]) assert.ok(bone.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
    avoidance.dispose();
});

test('弱接触首次不激活，已避让时安全回归且边界噪声不来回抖动，真正离开后释放', async () => {
    const { frame, cloth, arm, elbow, THREE, avoidance } = await fixture();
    for (let i = 0; i < 80; i++) { cloth.set(2, 2.4 + (i % 2 ? 0.0001 : -0.0001), 0); frame(); }
    assert.equal(arm.quaternion.w, 1); assert.equal(elbow.quaternion.w, 1);
    cloth.set(2, 2.15, 0); for (let i = 0; i < 120; i++) frame();
    const initialAngle = elbow.quaternion.angleTo(new THREE.Quaternion());
    let previous = elbow.quaternion.angleTo(new THREE.Quaternion());
    for (let i = 0; i < 120; i++) {
        cloth.set(2, 2.4 + (i % 2 ? 0.0001 : -0.0001), 0); const state = frame();
        const angle = elbow.quaternion.angleTo(new THREE.Quaternion());
        assert.ok(angle <= previous + 1e-6); assert.equal(state.remaining, 0); previous = angle;
    }
    assert.ok(previous < initialAngle * 0.1, '弱接触不能永久保持多余避让修正');
    cloth.set(20, 20, 20); for (let i = 0; i < 37; i++) frame();
    assert.ok(elbow.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); avoidance.dispose();
});

for (const fps of [30, 60, 120]) test(`已显示无穿透且原动作仍有接触时在${fps}fps主动回归，遇阻安全停留`, async () => {
    const { frame, cloth, arm, elbow, THREE, avoidance } = await fixture();
    const dt = 1 / fps, identity = new THREE.Quaternion();
    for (let i = 0; i < 2 * fps; i++) frame(true, dt);
    const before = Math.max(arm.quaternion.angleTo(identity), elbow.quaternion.angleTo(identity));
    assert.equal(avoidance.getState().remaining, 0);
    // 裙摆退让但仍挡住原动作：旧实现因baseline接触永久保持；现在应收回多余修正。
    cloth.y = 2.25;
    let accepted = 0, attempted = 0;
    for (let i = 0; i < 2 * fps; i++) {
        const state = frame(true, dt); assert.ok(state.contacts > 0); assert.equal(state.remaining, 0);
        assert.ok(state.stepDegrees <= 35 / 0.6 / fps + 1e-4); assert.ok(state.returnAttempts <= 2);
        accepted += state.returning; attempted += state.returnAttempts;
    }
    const after = Math.max(arm.quaternion.angleTo(identity), elbow.quaternion.angleTo(identity));
    assert.ok(accepted > 0 && attempted > 0); assert.ok(after < before * 0.8); assert.ok(after > 0.001, '受阻不能强行回到穿透的原动作');
    // 边界受阻后稳定停留，继续试探但不会把候选穿透应用到骨骼。
    const held = [arm.quaternion.clone(), elbow.quaternion.clone()];
    for (let i = 0; i < fps; i++) { const state = frame(true, dt); assert.equal(state.remaining, 0); }
    for (const [index, bone] of [arm, elbow].entries()) assert.ok(bone.quaternion.angleTo(held[index]) < 1e-6);
    cloth.set(20, 20, 20); for (let i = 0; i < Math.ceil(0.6 * fps) + 1; i++) frame(true, dt);
    for (const bone of [arm, elbow]) assert.ok(bone.quaternion.angleTo(identity) < 1e-6);
    avoidance.dispose();
});

test('零delta不试回归，暂停求解空间/显式关闭及reset不残留回归状态', async () => {
    const f = await fixture(); for (let i = 0; i < 120; i++) f.frame();
    f.cloth.y = 2.25; const before = [f.arm.quaternion.clone(), f.elbow.quaternion.clone()];
    assert.equal(f.frame(true, 0).returnAttempts, 0);
    for (const [index, bone] of [f.arm, f.elbow].entries()) assert.ok(bone.quaternion.angleTo(before[index]) < 1e-6);
    f.avoidance.restore(); f.avoidance.apply(f.model, f.physics, 1 / 60, true, { paused: true });
    assert.ok(f.avoidance.getState().returnAttempts > 0); assert.equal(f.avoidance.getState().remaining, 0);
    assert.equal(f.frame(false).returnAttempts, 0); f.avoidance.reset();
    assert.equal(f.avoidance.getState().returnAttempts, 0); assert.equal(f.avoidance.getState().returning, 0); f.avoidance.dispose();
});

test('双侧合并探测独立接受/回退，一侧退让不使另一侧穿透或永久保持', async () => {
    const f = await fixture(), { THREE } = f;
    const arm = new THREE.Bone(), elbow = new THREE.Bone(), wrist = new THREE.Bone();
    arm.position.set(0, 2, 0); elbow.position.set(-1, 0, 0); wrist.position.set(-1, 0, 0);
    arm.add(elbow); elbow.add(wrist); f.mesh.add(arm);
    f.mesh.bind(new THREE.Skeleton([f.arm, f.elbow, f.wrist, arm, elbow, wrist]));
    const bodies = f.mesh.geometry.userData.MMD.rigidBodies;
    bodies.push({ ...bodies[0], boneIndex: 5 }, { ...bodies[1] });
    const entry = (bone, index) => ({ bone, index, dynamic: false });
    Object.assign(f.model.bindings, { 'bones:leftArm': entry(arm, 3), 'bones:leftElbow': entry(elbow, 4), 'bones:leftWrist': entry(wrist, 5) });
    f.model.groups.leftArm = new Set([3, 4, 5]);
    const cloth = new THREE.Vector3(-2, 2.15, 0);
    f.physics.getBodyPose = (index, position, quaternion) => {
        position.copy(index === 1 ? f.cloth : cloth); quaternion.identity(); return index === 1 || index === 3;
    };
    for (let i = 0; i < 120; i++) f.frame();
    const identity = new THREE.Quaternion(), before = f.elbow.quaternion.angleTo(identity), held = elbow.quaternion.clone();
    f.cloth.y = 2.25; let accepted = 0;
    for (let i = 0; i < 120; i++) {
        const state = f.frame(); assert.equal(state.remaining, 0); assert.ok(state.returnAttempts <= 2); accepted += state.returning;
    }
    assert.ok(accepted > 0); assert.ok(f.elbow.quaternion.angleTo(identity) < before * 0.8);
    assert.ok(elbow.quaternion.angleTo(held) < 1e-6, '仍受阻的一侧必须保留安全显示姿态'); f.avoidance.dispose();
});

test('接触方向反转与新的原动作连续接管，零delta不推进，关闭从当前修正600ms释放', async () => {
    const { frame, cloth, arm, elbow, model, physics, THREE, avoidance } = await fixture();
    for (let i = 0; i < 120; i++) frame();
    const before = [arm.quaternion.clone(), elbow.quaternion.clone()]; cloth.set(2, 1.85, 0);
    frame(true, 0);
    for (const [index, bone] of [arm, elbow].entries()) assert.ok(bone.quaternion.angleTo(before[index]) < 1e-6);
    let previous = elbow.quaternion.clone();
    for (let i = 0; i < 90; i++) {
        frame(); assert.ok(elbow.quaternion.angleTo(previous) <= 35 * Math.PI / 180 / 0.6 / 60 + 1e-6);
        previous.copy(elbow.quaternion);
    }
    // 新原动作改变后最大修正仍相对此帧原动作。
    avoidance.restore(); arm.rotation.z = 0.2; const original = arm.quaternion.clone();
    avoidance.apply(model, physics, 1 / 60);
    assert.ok(arm.quaternion.angleTo(original) <= 35 * Math.PI / 180 + 1e-6);
    const current = elbow.quaternion.clone(); frame(false);
    assert.ok(elbow.quaternion.angleTo(current) < 0.01);
    for (let i = 0; i < 36; i++) frame(false);
    assert.ok(elbow.quaternion.angleTo(new THREE.Quaternion()) < 1e-6); avoidance.dispose();
});

test('重建模型及reset丢弃连续接触与过滤目标，不带入上一模型的避让', async () => {
    const first = await fixture(), second = await fixture();
    for (let i = 0; i < 90; i++) first.frame();
    second.cloth.set(20, 20, 20);
    first.avoidance.apply(second.model, second.physics, 1 / 60);
    assert.equal(first.arm.quaternion.w, 1); assert.equal(first.elbow.quaternion.w, 1);
    assert.equal(second.arm.quaternion.w, 1); assert.equal(second.elbow.quaternion.w, 1);
    first.avoidance.reset(); first.avoidance.apply(second.model, second.physics, 1 / 60);
    assert.equal(second.elbow.quaternion.w, 1); first.avoidance.dispose(); second.avoidance.dispose();
});

test('暖启动和最终过滤后的姿态仍遵守原模型IK约束，不可达接触报告剩余', async () => {
    const { frame, cloth, model, arm, elbow, THREE, avoidance } = await fixture();
    model.mesh.geometry.userData.MMD.iks = [{ links: [
        { index: 0, rotationMin: [0, 0, -0.005], rotationMax: [0, 0, 0] },
        { index: 1, rotationMin: [0, 0, -0.1], rotationMax: [0, 0, 0] }
    ] }];
    for (let i = 0; i < 100; i++) {
        cloth.z = i % 2 ? 0.12 : -0.12; frame();
        for (const [index, bone] of [arm, elbow].entries()) {
            const angles = new THREE.Euler().setFromQuaternion(bone.quaternion);
            assert.ok(Math.abs(angles.x) < 1e-6 && Math.abs(angles.y) < 1e-6);
            assert.ok(angles.z >= (index ? -0.1 : -0.005) - 1e-6 && angles.z <= 1e-6);
        }
    }
    assert.ok(avoidance.getState().remaining > 0); avoidance.dispose();
});

test('物理实例销毁后不复用暖启动衣服快照，不再求解旧接触并平滑释放', async () => {
    const { frame, physics, arm, elbow, THREE, avoidance } = await fixture();
    for (let i = 0; i < 90; i++) frame();
    physics.disposed = true;
    for (let i = 0; i < 37; i++) {
        const state = frame(); assert.equal(state.contacts, 0); assert.equal(state.iterations, 0);
    }
    for (const bone of [arm, elbow]) assert.ok(bone.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
    avoidance.dispose();
});

test('碰撞组拒绝接触与无接触帧不修改动作，物理驱动手臂明确降级', async () => {
    const { frame, model, arm, elbow, avoidance } = await fixture();
    model.mesh.geometry.userData.MMD.rigidBodies[1].groupTarget = 0;
    assert.equal(frame().contacts, 0); assert.equal(arm.quaternion.w, 1); assert.equal(elbow.quaternion.w, 1);
    avoidance.reset(); model.bindings['bones:rightArm'].dynamic = true;
    assert.equal(frame().available, false); assert.match(avoidance.getState().reason, /缺少/u); avoidance.dispose();
});

test('刚体采样读取实际动态姿态，统一角色缩放/父级旋转空间并支持顶点模式基础刚体', async () => {
    const { THREE, mesh, model } = await fixture();
    const { createHumanRigidSnapshot } = await import('../3rd/mmd-ar-test/web-human-rigid-snapshot.mjs');
    const parent = new THREE.Group(); parent.position.set(3, 1, -2); parent.rotation.y = 0.7; parent.add(mesh);
    mesh.position.set(1, 2, 3); mesh.rotation.z = 0.2; mesh.scale.setScalar(2); parent.updateMatrixWorld(true);
    const physical = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, new THREE.Vector3(1, 1, 1));
    const expected = new THREE.Vector3(2, 3, 0), rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    const world = new THREE.Matrix4().multiplyMatrices(physical, new THREE.Matrix4().compose(expected, rotation, new THREE.Vector3(1, 1, 1)));
    const physics = { getBodyPose(index, p, q) { world.decompose(p, q, new THREE.Vector3()); return index === 1; } };
    const snapshot = createHumanRigidSnapshot(mesh); snapshot.sample({ base: physics }, model.groups.rightArm);
    assert.ok(snapshot.bodies[1].position.distanceTo(expected) < 1e-6);
    assert.ok(snapshot.bodies[1].quaternion.angleTo(rotation) < 1e-6);
    assert.ok(snapshot.bodies[0].position.distanceTo(new THREE.Vector3(2, 2, 0)) < 1e-6);
});

test('同帧缓存边界的窄阶段与完整物理检测一致，缺失前臂/手部刚体明确降级', async () => {
    const { model, physics, frame, avoidance, mesh, THREE } = await fixture(1);
    const { createHumanRigidSnapshot } = await import('../3rd/mmd-ar-test/web-human-rigid-snapshot.mjs');
    const { createPrimitiveContacts, prepareCollisionBody } = await import('../3rd/mmd-ar-test/web-xpbd-collision.mjs');
    const snapshot = createHumanRigidSnapshot(mesh), detector = createPrimitiveContacts();
    snapshot.sample(physics, model.groups.rightArm);
    const signature = list => list.map(c => [c.a.index, c.b.index, c.normal.toArray(), c.localA.toArray(), c.localB.toArray()]);
    detector.scan(snapshot.bodies, new Set());
    snapshot.bodies[0].position.add(new THREE.Vector3(0, -0.04, 0)); prepareCollisionBody(snapshot.bodies[0]);
    const fast = signature(detector.scanPrepared(snapshot.bodies, new Set()));
    assert.deepEqual(fast, signature(detector.scan(snapshot.bodies, new Set())));
    model.mesh.geometry.userData.MMD.rigidBodies[0].boneIndex = 0;
    assert.equal(frame().available, false); assert.match(avoidance.getState().reason, /刚体/u);
    detector.dispose(); avoidance.dispose();
});

test('刚体索引/接触顺序反转仍向衣服外侧避让', async () => {
    const f = await fixture();
    f.model.mesh.geometry.userData.MMD.rigidBodies.reverse();
    f.physics.getBodyPose = (index, position, quaternion) => { position.copy(f.cloth); quaternion.identity(); return index === 0; };
    const initial = f.frame(); assert.ok(initial.contacts > 0);
    for (let i = 0; i < 60; i++) f.frame();
    assert.equal(f.avoidance.getState().remaining, 0);
    assert.ok(f.wrist.getWorldPosition(new f.THREE.Vector3()).y < 2); f.avoidance.dispose();
});

test('旋转暂停读取原求解空间，避免未同步COM产生虚假接触；不修改物理姿态', async () => {
    const { THREE, mesh, model, physics, cloth } = await fixture();
    const { createHumanRigidSnapshot } = await import('../3rd/mmd-ar-test/web-human-rigid-snapshot.mjs');
    mesh.position.set(3, 0, 0); mesh.rotation.y = Math.PI / 2; mesh.updateMatrixWorld(true);
    physics.physicsTransform = new THREE.Matrix4();
    const snapshot = createHumanRigidSnapshot(mesh), original = cloth.clone();
    snapshot.sample(physics, model.groups.rightArm, { paused: true });
    assert.ok(snapshot.bodies[1].position.distanceTo(original) < 1e-6);
    snapshot.sample(physics, model.groups.rightArm);
    assert.ok(snapshot.bodies[1].position.distanceTo(original) > 1);
    assert.ok(cloth.distanceTo(original) < 1e-6);
    physics.disposed = true; assert.equal(snapshot.sample(physics, model.groups.rightArm), false);
});
