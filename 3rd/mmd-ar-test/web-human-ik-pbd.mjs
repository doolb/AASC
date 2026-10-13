import { Vector3 } from 'three';

export const PBD_MAX_ITERATIONS = 12;
export const PBD_MAX_STEP = 15 * Math.PI / 180;
export const PBD_TARGET_EPSILON = 0.025;
export const KNEE_POLE_STRENGTH = 0.12;

const VECTOR_EPSILON_SQ = 1e-10;

// 限制短骨/零长度辅助骨的权重，避免少数异常骨段吸走大部分末端修正。
export function calculateInverseRotationalMass(segmentLength) {
    if (!Number.isFinite(segmentLength) || segmentLength < 0) return 1;
    return Math.max(0.25, Math.min(4, 1 / Math.max(0.25, segmentLength)));
}

// 将末端位置误差沿各骨骼的角度梯度分配，避免单个链节独自承担全部旋转。
// joints.position 是每个骨骼关节的世界坐标，inverseRotationalMass 由骨段长度决定。
export function calculatePbdAngularCorrections(endPosition, target, joints, {
    strength = 1,
    maxStep = PBD_MAX_STEP
} = {}) {
    if (!endPosition?.isVector3 || !target?.isVector3 || !Array.isArray(joints)
        || !Number.isFinite(strength) || strength <= 0 || !Number.isFinite(maxStep) || maxStep <= 0) return [];

    const error = new Vector3().subVectors(target, endPosition);
    const distance = error.length();
    if (!Number.isFinite(distance) || distance <= PBD_TARGET_EPSILON) return [];
    const direction = error.multiplyScalar(1 / distance);
    const gradients = [];
    let denominator = 0;

    for (const joint of joints) {
        const inverseRotationalMass = joint?.inverseRotationalMass;
        if (!joint?.position?.isVector3 || !Number.isFinite(inverseRotationalMass) || inverseRotationalMass <= 0) continue;
        const lever = new Vector3().subVectors(endPosition, joint.position);
        const gradient = new Vector3().crossVectors(lever, direction);
        const gradientLengthSq = gradient.lengthSq();
        if (gradientLengthSq <= VECTOR_EPSILON_SQ) continue;
        denominator += gradientLengthSq * inverseRotationalMass;
        gradients.push({ joint, gradient, gradientLengthSq, inverseRotationalMass });
    }

    if (!Number.isFinite(denominator) || denominator <= VECTOR_EPSILON_SQ) return [];
    return gradients.map(({ joint, gradient, gradientLengthSq, inverseRotationalMass }) => {
        const angle = Math.min(maxStep, distance * strength * inverseRotationalMass
            * Math.sqrt(gradientLengthSq) / denominator);
        return angle > 0 && Number.isFinite(angle)
            ? { joint, axis: gradient.normalize(), angle }
            : null;
    }).filter(Boolean);
}

// 从当前动画基准腿姿势构造膝盖偏好点；腿近乎伸直时没有稳定弯曲面，直接跳过软约束。
export function calculateKneePoleTarget(hip, knee, ankle, targetAnkle) {
    if (![hip, knee, ankle, targetAnkle].every(point => point?.isVector3)) return null;
    const baselineAxis = new Vector3().subVectors(ankle, hip);
    const baselineLengthSq = baselineAxis.lengthSq();
    if (!Number.isFinite(baselineLengthSq) || baselineLengthSq <= VECTOR_EPSILON_SQ) return null;

    const kneeFromHip = new Vector3().subVectors(knee, hip);
    const along = Math.max(0.12, Math.min(0.88, kneeFromHip.dot(baselineAxis) / baselineLengthSq));
    const baselinePole = kneeFromHip.addScaledVector(baselineAxis, -along);
    const poleLength = baselinePole.length();
    if (!Number.isFinite(poleLength) || poleLength <= Math.sqrt(baselineLengthSq) * 0.015) return null;

    const targetAxis = new Vector3().subVectors(targetAnkle, hip);
    if (targetAxis.lengthSq() <= VECTOR_EPSILON_SQ) return null;
    targetAxis.normalize();
    const preferredPole = baselinePole.addScaledVector(targetAxis, -baselinePole.dot(targetAxis));
    if (preferredPole.lengthSq() <= VECTOR_EPSILON_SQ) return null;
    preferredPole.setLength(poleLength);

    const targetLength = new Vector3().subVectors(targetAnkle, hip).length();
    return new Vector3().copy(hip).addScaledVector(targetAxis, along * targetLength).add(preferredPole);
}
