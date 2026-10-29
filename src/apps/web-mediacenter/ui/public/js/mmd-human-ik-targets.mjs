import { Euler, Quaternion, Vector3 } from 'three';
import { IK_TARGET_BONES } from './mmd-ik-plan.mjs';

/** 动画姿态只作为目标输入；最终身体姿态由同一物理关节链求解，手动目标在调用方优先。 */
export function createAutomaticIKTargets(rig, animated, channels = new Map()) {
    const targets = new Map();
    const explicit = new Set([...channels.keys()].map(key => rig.nodes.find(node => node.semantic === IK_TARGET_BONES[key])));
    for (const node of rig.nodes) {
        if (node === rig.pelvis) continue;
        const pose = animated.get(node);
        targets.set(node, { node, target: rig.targetToWorld(pose.position),
            targetRotation: rig.targetRotationToWorld(pose.quaternion), positionState: 'On', rotationState: 'On', automatic: true });
    }
    for (const [key, value] of channels) {
        const node = rig.nodes.find(node => node.semantic === IK_TARGET_BONES[key]);
        if (!node) throw new Error('当前身体物理不支持IK目标：' + key);
        const previous = targets.get(node) || { node, positionState: 'Off', rotationState: 'Off', automatic: true };
        previous.explicit = true;
        if (value.position) {
            // 物理代理把模型身高归一到1.6米；目标依附模型局部空间，镜头、旋转和缩放不改意图。
            previous.target = rig.targetToWorld(node.position.clone().add(new Vector3().fromArray(value.position).multiplyScalar(1.6)));
            previous.positionState = 'On';
            if (!value.rotation) previous.rotationState = 'Off';
        }
        if (value.rotation) {
            const angles = value.rotation.map(angle => angle * Math.PI / 180);
            const rotation = new Quaternion().setFromEuler(new Euler(...angles, 'XYZ')).multiply(node.quaternion);
            previous.targetRotation = rig.targetRotationToWorld(rotation);
            previous.rotationState = 'On';
        }
        targets.set(node, previous);
        // 给末端牵引留出上游自由度，不能同时把肩肘/髋膝硬钉在旧动画位置。
        for (let parent = node.parentNode; parent && parent !== rig.pelvis; parent = parent.parentNode) {
            if (explicit.has(parent)) continue;
            const upstream = targets.get(parent);
            if (upstream) { upstream.positionState = 'Off'; upstream.rotationState = 'Off'; }
        }
    }
    return [...targets.values()];
}
