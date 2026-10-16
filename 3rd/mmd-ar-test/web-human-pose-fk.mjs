import { Euler, Quaternion, Vector3 } from 'three';
import { limitJointRotation } from './web-human-joint-limits.mjs';

// 快照只保存参与身体语义点的真实父链，包含未绑定控制点的中间骨。
// 求值不写原模型；局部角先经过与rig.write相同的约束，再用真实父链推导全部位置。
export function createPoseFK(rig) {
    const mesh = rig.model.mesh, records = [], byBone = new Map(), byNode = new Map();
    mesh.updateWorldMatrix(true, true);
    const source = rig.animatedPoses();
    function include(bone) {
        if (bone === mesh) return -1;
        if (!bone) throw new Error('身体骨架父链未连接到模型');
        if (byBone.has(bone)) return byBone.get(bone);
        const parent = include(bone.parent), index = records.length;
        records.push({ parent, position: bone.position.clone().multiplyScalar(rig.metersPerUnit),
            quaternion: bone.quaternion.clone(), scale: bone.scale.clone(), node: null });
        byBone.set(bone, index); return index;
    }
    for (const node of rig.nodes) { const index = include(node.bone); records[index].node = node; byNode.set(node, index); }
    const parameters = [], initial = [], reference = [], controls = new Map();
    for (const node of rig.nodes) {
        const root = node === rig.pelvis && !node.hasModelLimits;
        const basis = !root && !node.hasModelLimits && node.parentNode
            ? source.get(node.parentNode).quaternion.clone().multiply(node.jointFrameRotation) : null;
        const relative = root ? new Quaternion() : basis ? basis.clone().invert().multiply(source.get(node).quaternion) : records[byNode.get(node)].quaternion.clone();
        const angles = new Euler().setFromQuaternion(relative, 'XYZ').toArray().slice(0, 3);
        // 根部优化量是相对当前世界旋转的增量；绑定候选必须先换算该增量，
        // 不能直接填零，否则连续换图仍从上一张图的朝向开始。
        const referenceAngles = root ? new Euler().setFromQuaternion(source.get(node).quaternion.clone().normalize()
            .invert().multiply(node.quaternion.clone().normalize()), 'XYZ').toArray().slice(0, 3) : [0, 0, 0];
        if (!node.hasModelLimits && node.hingeAxis !== null) {
            const axis = node.hingeAxis;
            angles.fill(0); angles[axis] = Math.atan2(Math.sin(2 * Math.atan2(relative[['x', 'y', 'z'][axis]], relative.w)),
                Math.cos(2 * Math.atan2(relative[['x', 'y', 'z'][axis]], relative.w)));
        }
        const indices = [];
        const movable = node === rig.pelvis || /^(upperBody|chest|leftShoulder|rightShoulder|leftArm|rightArm|leftElbow|rightElbow|leftLeg|rightLeg|leftKnee|rightKnee)$/u.test(node.semantic);
        for (let axis = 0; axis < 3; axis++) {
            const low = root ? -Math.PI : node.limits.low[axis], high = root ? Math.PI : node.limits.high[axis];
            if (!movable || high - low < 1e-6) continue;
            indices.push([axis, initial.length]);
            parameters.push({ node, axis, low, high }); initial.push(Math.max(low, Math.min(high, angles[axis])));
            reference.push(Math.max(low, Math.min(high, referenceAngles[axis])));
        }
        controls.set(node, { root, angles, indices });
    }
    const identity = { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3(1, 1, 1) };
    function evaluate(values) {
        if (values.length !== initial.length || !values.every(Number.isFinite)) throw new Error('关节拟合参数无效');
        const worlds = [], visiting = new Set();
        function world(index) {
            if (index < 0) return identity;
            if (worlds[index]) return worlds[index];
            if (visiting.has(index)) throw new Error('身体关节依赖存在循环');
            visiting.add(index);
            const record = records[index], parent = world(record.parent), node = record.node;
            let local = record.quaternion;
            if (node) {
                const control = controls.get(node), angles = [...control.angles];
                for (const [axis, i] of control.indices) angles[axis] = Math.max(parameters[i].low, Math.min(parameters[i].high, values[i]));
                const relative = new Quaternion().setFromEuler(new Euler(...angles, 'XYZ'));
                if (control.root) local = parent.quaternion.clone().invert().multiply(source.get(node).quaternion).multiply(relative);
                else {
                    const limited = limitJointRotation(node, relative);
                    const physicalParent = node.parentNode && !node.hasModelLimits ? world(byNode.get(node.parentNode)) : null;
                    local = physicalParent ? parent.quaternion.clone().invert().multiply(physicalParent.quaternion)
                        .multiply(node.jointFrameRotation).multiply(limited) : limited;
                }
            }
            const result = { position: record.position.clone().multiply(parent.scale).applyQuaternion(parent.quaternion).add(parent.position),
                quaternion: parent.quaternion.clone().multiply(local).normalize(), scale: parent.scale.clone().multiply(record.scale) };
            worlds[index] = result; visiting.delete(index); return result;
        }
        const poses = new Map(rig.nodes.map(node => [node, world(byNode.get(node))]));
        return { poses };
    }
    return { initial, reference, parameters, evaluate, source };
}
