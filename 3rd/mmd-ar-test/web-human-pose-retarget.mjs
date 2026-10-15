import { Matrix4, Quaternion, Vector3 } from 'three';

// MediaPipe世界点以髋中心为原点；翻转Y/Z适配MMD局部坐标，左右仍使用人体语义。
// 图片只能估计深度和骨段方向，实际长度始终取当前模型绑定骨架，不把像素距离当作骨长。
export function retargetImagePose(pose, rig) {
    if (!Array.isArray(pose?.landmarks) || pose.landmarks.length !== 33 || !Number.isFinite(pose.confidence) || pose.confidence < 0.5) throw new Error('姿态关键点无效');
    const point = index => {
        const value = pose.landmarks[index];
        if (!Array.isArray(value?.world) || value.world.length !== 3 || !value.world.every(Number.isFinite)
            || !Number.isFinite(value.visibility) || !Number.isFinite(value.presence) || Math.min(value.visibility, value.presence) < 0.5) return null;
        const [x, y, z] = value.world; return new Vector3(x, -y, -z);
    };
    const node = semantic => rig.nodes.find(item => item.semantic === semantic);
    const ref = semantic => node(semantic)?.position.clone();
    const midpoint = (a, b) => a && b ? a.clone().add(b).multiplyScalar(0.5) : null;
    const leftHip = point(23), rightHip = point(24), leftShoulder = point(11), rightShoulder = point(12);
    const hip = midpoint(leftHip, rightHip), shoulder = midpoint(leftShoulder, rightShoulder);
    if (!hip || !shoulder) throw new Error('骨盆或肩部关键点不可见，请换一张躯干清晰的图片');
    const refPelvis = ref('hips'), refShoulder = midpoint(ref('leftArm'), ref('rightArm'));
    const refHipAxis = ref('leftLeg')?.sub(ref('rightLeg') || refPelvis), refShoulderAxis = ref('leftArm')?.sub(ref('rightArm') || refPelvis);
    if (!refPelvis || !refShoulder || !refHipAxis || !refShoulderAxis) throw new Error('当前模型缺少肩/髋骨骼，无法应用图片姿态');
    function basis(x, y) {
        x = x.clone().normalize(); y = y.clone().addScaledVector(x, -y.dot(x)).normalize();
        const z = x.clone().cross(y).normalize();
        if (Math.min(x.lengthSq(), y.lengthSq(), z.lengthSq()) < 0.9) throw new Error('姿态关键点退化，无法判断身体方向');
        return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    }
    const originalUp = refShoulder.clone().sub(refPelvis), up = shoulder.clone().sub(hip);
    const delta = (axis, original) => basis(axis, up).multiply(basis(original, originalUp).invert());
    const pelvisDelta = delta(leftHip.clone().sub(rightHip), refHipAxis);
    const torsoDelta = delta(leftShoulder.clone().sub(rightShoulder), refShoulderAxis);
    const anchor = rig.animatedPoses().get(rig.pelvis).position.clone(), targets = [];
    function target(key, position, rotation = null) {
        const world = rig.targetToWorld(position).toArray();
        if (!world.every(Number.isFinite)) throw new Error('姿态映射出现无效目标');
        targets.push({ key, position: world, rotation: rotation ? rig.targetRotationToWorld(rotation).toArray() : null });
    }
    target('pelvis', anchor, pelvisDelta.clone().multiply(rig.pelvis.quaternion));
    const chest = node('upperBody');
    if (chest) target('chest', anchor.clone().add(chest.position.clone().sub(refPelvis).applyQuaternion(torsoDelta)), torsoDelta.clone().multiply(chest.quaternion));
    for (const [side, indices] of [['left', [11, 13, 15, 23, 25, 27]], ['right', [12, 14, 16, 24, 26, 28]]]) {
        for (const [rootName, middleName, endName, start, rotation, middleKey, endKey] of [
            ['Arm', 'Elbow', 'Wrist', 0, torsoDelta, side + 'Elbow', side + 'Hand'],
            ['Leg', 'Knee', 'Ankle', 3, pelvisDelta, side + 'Knee', side + 'Foot']]) {
            const a = point(indices[start]), b = point(indices[start + 1]), c = point(indices[start + 2]);
            const root = ref(side + rootName), middle = ref(side + middleName), end = ref(side + endName);
            if (!a || !b || !root || !middle || a.distanceToSquared(b) < 1e-8) continue;
            const base = anchor.clone().add(root.clone().sub(refPelvis).applyQuaternion(rotation));
            const joint = base.add(b.clone().sub(a).normalize().multiplyScalar(root.distanceTo(middle)));
            target(middleKey, joint);
            if (c && end && b.distanceToSquared(c) > 1e-8) target(endKey, joint.clone().add(c.clone().sub(b).normalize().multiplyScalar(middle.distanceTo(end))));
        }
    }
    const head = ref('head'), neck = ref('neck'), face = midpoint(point(7), point(8)) || point(0);
    if (head && neck && face && face.distanceToSquared(shoulder) > 1e-8) {
        const base = anchor.clone().add(neck.clone().sub(refPelvis).applyQuaternion(torsoDelta));
        target('head', base.add(face.sub(shoulder).normalize().multiplyScalar(head.distanceTo(neck))));
    }
    if (targets.length < 3) throw new Error('可见身体关键点不足，未修改当前姿态');
    return targets;
}
