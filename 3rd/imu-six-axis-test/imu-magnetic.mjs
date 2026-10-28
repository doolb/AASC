import { Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const RAD = Math.PI / 180;
const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
const limited = (error, gain, dt, rate) => Math.sign(error) * Math.min(Math.abs(error) * (1 - Math.exp(-gain * dt)), rate * dt);

/** 磁场只约束相对航向；倾斜用可信加速度纠偏。磁干扰不会重建已有参考。 */
export class MagneticAssist {
    constructor() { this.reset(); }

    reset() {
        this.reference = null; this.referenceNorm = null; this.referenceDip = null;
        this.history = []; this.stableSince = null; this.lastWorldForce = null;
        this.lastObservation = null; this.candidate = null; this.candidateNorm = null; this.candidateDip = null;
        this.diagnostics = { enabled: true, available: null, state: 'missing', reason: '等待磁场数据',
            fieldMagnitude: null, observationAge: null, headingResidual: null, accuracy: null,
            gravityTrusted: false, referenceReady: false, correctionDegrees: 0 };
    }

    /** 断流保留磁航向基准，但丢弃连续窗口和时序，恢复后重新确认。 */
    suspend(reason = '等待数据恢复') {
        this.history = []; this.stableSince = null; this.lastWorldForce = null;
        this.lastObservation = null; this.candidate = null;
        Object.assign(this.diagnostics, { state: 'waiting', reason, gravityTrusted: false, correctionDegrees: 0,
            fieldMagnitude: null, observationAge: null, headingResidual: null, accuracy: null });
    }

    reject(state, reason) {
        this.stableSince = null; this.candidate = null;
        Object.assign(this.diagnostics, { state, reason, correctionDegrees: 0 });
        return new Quaternion();
    }

    /** 磁场与陀螺异频：从有界历史插值出磁场测量时刻的姿态，不把旧磁场当当前观测。 */
    poseAt(time) {
        for (let index = this.history.length - 1; index >= 0; index -= 1) {
            const before = this.history[index];
            if (before.time > time + 1e-6) continue;
            const after = this.history[index + 1];
            if (!after || after.time === before.time) return before.q.clone();
            return before.q.clone().slerp(after.q, Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time))));
        }
        return null;
    }

    update(sample, force, q, dt, enabled = true) {
        const d = this.diagnostics;
        Object.assign(d, { enabled, available: sample.magneticAvailable ?? (sample.magnetic ? true : null),
            fieldMagnitude: null, observationAge: null, headingResidual: null, accuracy: null,
            gravityTrusted: false, referenceReady: Boolean(this.reference), correctionDegrees: 0 });
        if (!enabled) {
            this.reset(); Object.assign(this.diagnostics, { enabled: false, available: d.available });
            return this.reject('disabled', '磁场辅助已关闭');
        }
        this.history.push({ time: sample.time, q: q.clone() });
        while (this.history.length > 64 || sample.time - this.history[0].time > 0.3) this.history.shift();
        if (d.available === false) return this.reject('unsupported', '设备未提供可用磁力计');
        const observation = sample.magnetic;
        if (!observation) return this.reject('missing', '等待磁场数据（旧APK可继续六轴）');
        if (!finite3(observation.field) || !Number.isFinite(observation.time)
            || !Number.isInteger(observation.accuracy) || observation.accuracy < 0 || observation.accuracy > 3) {
            return this.reject('invalid', '磁场观测格式无效');
        }
        const age = sample.time - observation.time;
        d.accuracy = observation.accuracy;
        d.observationAge = Math.max(0, age);
        if (age < -1e-6 || age > 0.12) return this.reject('stale', '磁场时序不匹配或已过期');
        if (this.lastObservation !== null && observation.time < this.lastObservation) return this.reject('stale', '磁场时间倒退');
        this.lastObservation = observation.time;
        const field = new Vector3().fromArray(observation.field), norm = field.length();
        d.fieldMagnitude = norm;
        if (observation.accuracy < 2) return this.reject('interference', `磁力计精度${observation.accuracy}/3，等待磁校准`);
        if (norm < 10 || norm > 100) return this.reject('interference', '磁场强度不可信');
        const pose = this.poseAt(observation.time);
        if (!pose) return this.reject('waiting', '等待磁场时刻的姿态历史');
        const worldForce = force.clone().applyQuaternion(q), forceNorm = force.length();
        const direction = worldForce.clone().normalize();
        const forceJump = this.lastWorldForce ? worldForce.distanceTo(this.lastWorldForce) : 0;
        this.lastWorldForce = worldForce.clone();
        d.gravityTrusted = sample.kind === 'gravity' && Math.abs(forceNorm - 9.80665) <= 0.35
            && angle(direction, UP) <= 12 * RAD && forceJump <= 0.4;
        if (!d.gravityTrusted) return this.reject('dynamic', '运动加速度或倾斜残差过大，暂停重力/磁场纠偏');

        // 使用陀螺传播、加速度门控的竖直方向做倾斜补偿；水平面是世界XZ，不能直接取手机XY。
        const worldField = field.applyQuaternion(pose);
        const dip = Math.asin(Math.max(-1, Math.min(1, worldField.y / norm)));
        const horizontal = worldField.clone().addScaledVector(UP, -worldField.dot(UP));
        if (horizontal.length() < 5) return this.reject('interference', '磁场水平分量不足');
        horizontal.normalize();
        const target = this.reference || this.candidate;
        const normReference = this.reference ? this.referenceNorm : this.candidateNorm;
        const dipReference = this.reference ? this.referenceDip : this.candidateDip;
        if (target && (angle(horizontal, target) > (this.reference ? 35 : 5) * RAD
            || Math.abs(norm / normReference - 1) > (this.reference ? 0.2 : 0.1)
            || Math.abs(dip - dipReference) > (this.reference ? 15 : 5) * RAD)) {
            return this.reject('interference', '磁场与稳定参考不一致');
        }
        if (!this.candidate) {
            this.candidate = horizontal.clone(); this.candidateNorm = norm; this.candidateDip = dip;
        }
        this.stableSince ??= observation.time;
        if (observation.time - this.stableSince < 0.5) {
            Object.assign(d, { state: 'settling', reason: '正在确认重力与磁场稳定窗口' });
            return new Quaternion();
        }
        if (!this.reference) {
            this.reference = horizontal.clone(); this.referenceNorm = norm; this.referenceDip = dip;
            d.referenceReady = true;
        }
        const residual = Math.atan2(UP.dot(horizontal.clone().cross(this.reference)), horizontal.dot(this.reference));
        d.headingResidual = residual / RAD;
        const yaw = limited(residual, 1, dt, 5 * RAD);
        const tiltAngle = angle(direction, UP);
        const fullTilt = new Quaternion().setFromUnitVectors(direction, UP);
        const tilt = new Quaternion().slerp(fullTilt, tiltAngle > 1e-9 ? limited(tiltAngle, 0.8, dt, 3 * RAD) / tiltAngle : 0);
        const correction = new Quaternion().setFromAxisAngle(UP, yaw).multiply(tilt);
        // 校正整个短历史的世界参考，避免下一次异频观测重新引入已修正的航向误差。
        for (const item of this.history) item.q.premultiply(correction).normalize();
        this.lastWorldForce.applyQuaternion(correction);
        Object.assign(d, { state: 'active', reason: '重力倾斜补偿与磁航向辅助中', correctionDegrees: yaw / RAD });
        return correction;
    }

    snapshot() { return { ...this.diagnostics }; }
}
