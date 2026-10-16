'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MAP = { leftArm: 11, rightArm: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
    leftLeg: 23, rightLeg: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28 };
const KEYS = { pelvis: 'hips', chest: 'upperBody', leftHand: 'leftWrist', rightHand: 'rightWrist', leftFoot: 'leftAnkle', rightFoot: 'rightAnkle' };
async function fixture() {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const f = await makeModel(), rig = createHumanPhysicsRig(f.model);
    const { limitJointRotation } = await import('../3rd/mmd-ar-test/web-human-joint-limits.mjs');
    // PMX初始直膝0°低于模型显式最小0.5°；回环真值先取合法姿态，避免把必要限位纠正当漂移。
    for (const node of rig.nodes) if (node.hasModelLimits) node.bone.quaternion.copy(limitJointRotation(node, node.bone.quaternion));
    f.model.mesh.updateWorldMatrix(true, true);
    return { ...f, rig, node: name => rig.nodes.find(n => n.semantic === name) };
}
function project(f, projection = 'perspective') {
    const { T, rig, node, model } = f, anchor = rig.targetToWorld(rig.pelvis.position);
    const camera = new T.PerspectiveCamera(40, 1, .01, 1000);
    camera.position.copy(anchor).add(new T.Vector3(4, 1, 35).multiplyScalar(model.mesh.getWorldScale(new T.Vector3()).x)); camera.lookAt(anchor); camera.updateMatrixWorld(true);
    model.mesh.updateWorldMatrix(true, true);
    const q = camera.getWorldQuaternion(new T.Quaternion()).invert(), landmarks = Array(33).fill(null);
    for (const [name, i] of Object.entries(MAP)) {
        const world = node(name).bone.getWorldPosition(new T.Vector3());
        const p = projection === 'perspective' ? world.project(camera) : world.sub(anchor).applyQuaternion(q).multiplyScalar(.03);
        landmarks[i] = { x: projection === 'perspective' ? (p.x + 1) / 2 : .5 + p.x,
            y: projection === 'perspective' ? (1 - p.y) / 2 : .35 - p.y,
            visibility: 1, presence: 1, source: 'rtmpose-m', dimensions: 2 };
    }
    return { camera, pose: { source: 'rtmpose-m', dimensions: 2, imageAspect: 1, landmarks } };
}

test('真实PMX当前姿态精确投影回环不得改坏3D：倾斜躯干也不移动原腿/旋转', async () => {
    const { fitImagePose2D } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture();
    for (const angle of [.35, .6, .75]) for (const projection of ['weak-perspective', 'perspective']) {
        f.node('upperBody').bone.quaternion.setFromEuler(new f.T.Euler(0, 0, angle));
        const { pose, camera } = project(f, projection);
        const result = fitImagePose2D(pose, f.rig, camera, { projection });
        for (const target of result.targets) {
            const bone = f.node(KEYS[target.key] || target.key).bone;
            const expected = bone.getWorldPosition(new f.T.Vector3());
            const error = f.rig.targetToLocal(expected).distanceTo(f.rig.targetToLocal(new f.T.Vector3().fromArray(target.position)));
            assert.ok(error <= .001, `${projection}/angle=${angle}/${target.key} drift=${error}m, image=${result.error}`);
            if (target.rotation) assert.ok(new f.T.Quaternion().fromArray(target.rotation).angleTo(bone.getWorldQuaternion(new f.T.Quaternion())) <= Math.PI / 1800);
        }
    }
});

test('只读FK快照精确保持当前父链/中间骨；越界关节被同一物理限位截断', async () => {
    const { createPoseFK } = await import('../3rd/mmd-ar-test/web-human-pose-fk.mjs');
    const { nodeOffset } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const f = await fixture(), before = f.model.bones.map(b => b.bone.quaternion.toArray());
    const fk = createPoseFK(f.rig), actual = f.rig.animatedPoses(), initial = fk.evaluate(fk.initial);
    for (const [node, pose] of initial.poses) {
        assert.ok(pose.position.distanceTo(actual.get(node).position) < 1e-8, node.semantic);
        assert.ok(pose.quaternion.clone().normalize().angleTo(actual.get(node).quaternion.clone().normalize()) < 1e-5, node.semantic);
    }
    const params = fk.initial.map((v, i) => v + (i % 2 ? -4 : 4)), limited = fk.evaluate(params);
    assert.deepEqual(f.model.bones.map(b => b.bone.quaternion.toArray()), before, '拟合改写原骨架');
    const bodies = new Map([...limited.poses].map(([node, pose]) => [node, { ...pose,
        position: pose.position.clone().add(nodeOffset(node, pose.quaternion)) }]));
    try {
        f.rig.write(bodies, actual);
        const achieved = f.rig.animatedPoses();
        for (const [node, pose] of limited.poses) assert.ok(achieved.get(node).quaternion.clone().normalize().angleTo(pose.quaternion.clone().normalize()) < 1e-6, node.semantic + '拟合与物理限位不一致');
    } finally { f.rig.restore(); }
});

test('已屈肘屈膝的合法当前姿态在模型缩放旋转后仍保持真实3D', async () => {
    const { fitImagePose2D } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture();
    f.node('upperBody').bone.quaternion.setFromEuler(new f.T.Euler(.2, 0, .4));
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
        f.node(side + 'Elbow').bone.quaternion.multiply(new f.T.Quaternion().setFromAxisAngle(new f.T.Vector3(0, 1, 0), sign));
        f.node(side + 'Leg').bone.quaternion.setFromEuler(new f.T.Euler(-.6, 0, 0));
        f.node(side + 'Knee').bone.quaternion.setFromEuler(new f.T.Euler(.8, 0, 0));
    }
    f.model.mesh.position.set(3, 2, -1); f.model.mesh.rotation.y = .7; f.model.mesh.scale.setScalar(2);
    const { pose, camera } = project(f);
    const fitted = fitImagePose2D(pose, f.rig, camera);
    for (const t of fitted.targets) {
        const expected = f.node(KEYS[t.key] || t.key).bone.getWorldPosition(new f.T.Vector3());
        assert.ok(f.rig.targetToLocal(expected).distanceTo(f.rig.targetToLocal(new f.T.Vector3().fromArray(t.position))) <= .001, t.key);
    }
});

test('模型显式骨盆角度范围参与FK搜索，不能绕过或完全冻结该参数', async () => {
    const { createPoseFK } = await import('../3rd/mmd-ar-test/web-human-pose-fk.mjs');
    const f = await fixture();
    f.rig.pelvis.hasModelLimits = true;
    f.rig.pelvis.limits = { low: [-.1, -.1, -.1], high: [.1, .1, .1] };
    const fk = createPoseFK(f.rig);
    assert.equal(fk.parameters.filter(p => p.node === f.rig.pelvis).length, 3);
    const result = fk.evaluate(fk.initial.map(() => 10)), q = result.poses.get(f.rig.pelvis).quaternion;
    const e = new f.T.Euler().setFromQuaternion(q);
    assert.ok([e.x, e.y, e.z].every(v => Math.abs(v) <= .100001));
});

test('异步FK拟合支持取消且不写原模型；二维缺点拒绝，当前已匹配姿态保持', async () => {
    const { fitImagePose2DAsync } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const f = await fixture(), { pose, camera } = project(f);
    const before = f.model.bones.map(b => b.bone.quaternion.toArray());
    await assert.rejects(fitImagePose2DAsync(pose, f.rig, camera, { isCurrent: () => false }), { name: 'AbortError' });
    pose.landmarks[23] = null;
    await assert.rejects(fitImagePose2DAsync(pose, f.rig, camera), /肩|骨盆|躯干/u);
    assert.deepEqual(f.model.bones.map(b => b.bone.quaternion.toArray()), before);
});

test('连续换图可从绑定姿态参选，不被上一张图的根部朝向困住', async () => {
    const { createPoseFK } = await import('../3rd/mmd-ar-test/web-human-pose-fk.mjs');
    const f = await fixture(), expected = f.rig.pelvis.quaternion.clone().normalize();
    f.rig.pelvis.bone.quaternion.setFromEuler(new f.T.Euler(0, .7, 0));
    f.model.mesh.updateWorldMatrix(true, true);
    const fk = createPoseFK(f.rig);
    assert.ok(Array.isArray(fk.reference));
    const pose = fk.evaluate(fk.reference).poses.get(f.rig.pelvis);
    assert.ok(pose.quaternion.clone().normalize().angleTo(expected) < 1e-6);
    assert.ok(fk.evaluate(fk.initial).poses.get(f.rig.pelvis).quaternion.clone().normalize().angleTo(expected) > .6);
});
