import { Euler, Quaternion, Vector3 } from 'three';

// 拟合与最终显示骨架共用同一约束，不能只在拟合结束后才修剪角度。
export function limitJointRotation(node, rotation) {
    if (!node.hasModelLimits && node.hingeAxis !== null) {
        const axis = node.hingeAxis;
        let angle = 2 * Math.atan2(rotation[['x', 'y', 'z'][axis]], rotation.w);
        angle = Math.atan2(Math.sin(angle), Math.cos(angle));
        angle = Math.max(node.limits.low[axis], Math.min(node.limits.high[axis], angle));
        return new Quaternion().setFromAxisAngle(new Vector3().setComponent(axis, 1), angle);
    }
    const euler = new Euler().setFromQuaternion(rotation, 'XYZ');
    for (let axis = 0; axis < 3; axis++) euler[['x', 'y', 'z'][axis]] = Math.max(node.limits.low[axis], Math.min(node.limits.high[axis], euler[['x', 'y', 'z'][axis]]));
    return new Quaternion().setFromEuler(euler);
}
