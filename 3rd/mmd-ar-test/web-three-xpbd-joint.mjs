import { Euler, Quaternion, Vector3 } from 'three';
import { XPBDSolver } from './vendor/three-xpbd/esm/solver/XPBDSolver.mjs';
import { createXpbdJoint } from './web-xpbd-rigid.mjs';

// 上游球/铰链关节不是PMX Spring6DOF；这里只适配PMX坐标，纠正使用上游数值接口。
// 每子步仅一轮，初始lambda=0，遵循上游applyBodyPairCorrection的单轮柔度公式。
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const AXES = ['x', 'y', 'z'];

export function createThreeXpbdJoint(params, a, b) {
    const joint = createXpbdJoint(params, a, b);
    const pa = new Vector3(), pb = new Vector3(), delta = new Vector3(), normal = new Vector3();
    const qa = new Quaternion(), qb = new Quaternion(), relative = new Quaternion(), euler = new Euler();
    const ax = new Vector3(), ay = new Vector3(), az = new Vector3(), gradient = new Vector3();
    const velocity = new Vector3(), correction = new Vector3();

    const linearFrame = (axis) => {
        pa.copy(joint.localA).applyQuaternion(a.quaternion).add(a.position);
        pb.copy(joint.localB).applyQuaternion(b.quaternion).add(b.position);
        qa.multiplyQuaternions(a.quaternion, joint.rotationA);
        normal.set(0, 0, 0).setComponent(axis, 1).applyQuaternion(qa);
        return delta.subVectors(pb, pa).dot(normal);
    };
    const rotationFrame = (axis) => {
        qa.multiplyQuaternions(a.quaternion, joint.rotationA);
        qb.multiplyQuaternions(b.quaternion, joint.rotationB);
        euler.setFromQuaternion(relative.copy(qa).invert().multiply(qb), 'XYZ');
        ax.set(1, 0, 0).applyQuaternion(qa);
        ay.set(0, Math.cos(euler.x), Math.sin(euler.x)).applyQuaternion(qa);
        az.set(Math.sin(euler.y), -Math.sin(euler.x) * Math.cos(euler.y),
            Math.cos(euler.x) * Math.cos(euler.y)).applyQuaternion(qa);
        gradient.crossVectors(axis === 0 ? ay : axis === 1 ? az : ax,
            axis === 0 ? az : axis === 1 ? ax : ay).multiplyScalar(1 / Math.max(0.01, Math.cos(euler.y)));
        normal.copy(gradient).normalize();
        return euler[AXES[axis]];
    };
    const linearCorrection = (error, compliance, h, velocityLevel = false) => {
        // A框架旋转改变参考轴，A的有效力臂为rA+delta，即世界B锚点。
        XPBDSolver.applyBodyPairCorrection(a, b, correction.copy(normal).multiplyScalar(error),
            compliance, h, pb, pb, velocityLevel);
    };
    const angularCorrection = (error, compliance, h, velocityLevel = false) => {
        const magnitude = gradient.length();
        if (magnitude < 1e-10) return;
        // Euler梯度为gamma*n：归一化纠正时误差除gamma，柔度除gamma²。
        XPBDSolver.applyBodyPairCorrection(a, b, correction.copy(normal).multiplyScalar(error / magnitude),
            compliance / (magnitude * magnitude), h, null, null, velocityLevel);
    };
    joint.solvePos = (h) => {
        for (let axis = 0; axis < 3; axis += 1) {
            if (params.springPosition[axis] > 0) linearCorrection(linearFrame(axis), 1 / params.springPosition[axis], h);
            const value = linearFrame(axis), low = params.translationLimitation1[axis], high = params.translationLimitation2[axis];
            if (low <= high && (value < low || value > high || low === high)) linearCorrection(value - clamp(value, low, high), 0, h);
            if (params.springRotation[axis] > 0) angularCorrection(rotationFrame(axis), 1 / params.springRotation[axis], h);
            const angle = rotationFrame(axis), min = params.rotationLimitation1[axis], max = params.rotationLimitation2[axis];
            if (min <= max && (angle < min || angle > max || min === max)) angularCorrection(angle - clamp(angle, min, max), 0, h);
        }
    };
    const speedError = (value, low, high, speed, tolerance, h) => {
        if (low > high) return 0;
        if (low === high) return speed;
        if (value <= low + tolerance && speed < 0) return speed - Math.max(speed, Math.min(0, (low - value) / h));
        if (value >= high - tolerance && speed > 0) return speed - Math.min(speed, Math.max(0, (high - value) / h));
        return 0;
    };
    joint.solveVel = (h) => {
        const tolerance = Math.min(a.contactTolerance, b.contactTolerance);
        for (let axis = 0; axis < 3; axis += 1) {
            const value = linearFrame(axis);
            const speed = velocity.subVectors(b.getVelocityAt(pb), a.getVelocityAt(pb)).dot(normal);
            linearCorrection(speedError(value, params.translationLimitation1[axis], params.translationLimitation2[axis], speed, tolerance, h), 0, h, true);
            const angle = rotationFrame(axis);
            const angularSpeed = velocity.subVectors(b.omega, a.omega).dot(gradient);
            angularCorrection(speedError(angle, params.rotationLimitation1[axis], params.rotationLimitation2[axis], angularSpeed, 1e-4, h), 0, h, true);
        }
    };
    return joint;
}
