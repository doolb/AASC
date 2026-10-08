import { Quaternion, Vector3 } from 'three';

export const GRAVITY = 9.80665;
export const REST_ORIENTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const UP = new Vector3(0, 1, 0);
const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const vector = value => new Vector3().fromArray(value);
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

/** 指数映射保留大角度组合旋转；不是将三个欧拉角直接相加。 */
export function rotationStep(rate, dt) {
    const speed = rate.length();
    return speed < 1e-12 ? new Quaternion() : new Quaternion().setFromAxisAngle(rate.clone().divideScalar(speed), speed * dt);
}

function statistics(samples, key) {
    const mean = [0, 1, 2].map(axis => average(samples.map(sample => sample[key][axis])));
    const deviation = [0, 1, 2].map(axis => Math.sqrt(average(samples.map(sample => (sample[key][axis] - mean[axis]) ** 2))));
    return { mean, deviation };
}

export const DEFAULT_PROFILE = Object.freeze({ gyroDeadZone: 0.0035, accelDeadZone: 0.08,
    filterHz: 12, tiltGain: 0.25, assumedRest: false, maxGap: 0.15 });

/** 不读取模拟真值的六轴估计器；所有输入端共用，观察端不重复积分。 */
export class ImuEngine {
    constructor(profile = {}) {
        this.profile = { ...DEFAULT_PROFILE, ...profile };
        this.q = REST_ORIENTATION.clone();
        this.p = new Vector3(); this.v = new Vector3();
        this.gyroBias = [0, 0, 0]; this.accelBias = [0, 0, 0]; this.accelScale = [1, 1, 1];
        this.gyroNoise = [0, 0, 0]; this.faces = {};
        this.gyroCalibrated = false; this.accelCalibrated = false;
        this.lastTime = null; this.initialized = false;
        this.filteredGyro = null; this.filteredAcceleration = null;
        this.calibration = null; this.samples = 0; this.gaps = 0; this.rejected = 0; this.zeroCorrections = 0;
        this.quietSince = null; this.message = '等待六轴数据'; this.status = 'waiting'; this.lastSample = null;
    }

    beginCalibration(face = null) {
        if (face !== null && !/^[xyz][+-]$/.test(face)) throw new Error('校准面无效');
        this.calibration = { face, samples: [], since: null };
        this.message = face ? `六面校准 ${face}：该轴正/负方向朝上，保持静止 2 秒` : '请保持设备静止 2 秒';
    }

    calibrate(sample) {
        const capture = this.calibration;
        if (!capture) return;
        if (sample.kind !== 'gravity') { this.message = '六轴静置校准需要含重力加速度'; return; }
        const angular = vector(sample.gyro).length(), norm = vector(sample.accel).length();
        if (angular > 0.2 || Math.abs(norm - GRAVITY) > 1.5) {
            capture.samples = []; capture.since = null; this.message = '检测到运动，请重新保持静止'; return;
        }
        capture.since ??= sample.time;
        capture.samples.push(sample);
        if (capture.samples.length > 1200) capture.samples.shift();
        if (sample.time - capture.since < 2 || capture.samples.length < 20) return;
        const gyro = statistics(capture.samples, 'gyro'), accel = statistics(capture.samples, 'accel');
        if (Math.max(...gyro.deviation) > 0.03 || Math.max(...accel.deviation) > 0.18) {
            capture.samples = []; capture.since = null; this.message = '窗口噪声/运动过大，请保持静止重试'; return;
        }
        if (capture.face) {
            const axis = 'xyz'.indexOf(capture.face[0]), sign = capture.face[1] === '+' ? 1 : -1;
            if (sign * accel.mean[axis] < GRAVITY * 0.88) {
                this.message = `${capture.face} 方向未朝上，请调整设备`; capture.samples = []; capture.since = null; return;
            }
            this.faces[capture.face] = accel.mean;
            this.message = `已采集 ${Object.keys(this.faces).length}/6 面`;
            if (Object.keys(this.faces).length === 6) {
                const bias = [0, 1, 2].map(axis => (this.faces['xyz'[axis] + '+'][axis] + this.faces['xyz'[axis] + '-'][axis]) / 2);
                const scale = [0, 1, 2].map(axis => 2 * GRAVITY / (this.faces['xyz'[axis] + '+'][axis] - this.faces['xyz'[axis] + '-'][axis]));
                if (scale.every(value => value > 0.8 && value < 1.2) && bias.every(value => Math.abs(value) < 1.5)) {
                    this.accelBias = bias; this.accelScale = scale; this.accelCalibrated = true;
                    this.message = '加速度六面校准完成';
                } else this.message = '六面结果不一致，请重新采集';
            }
        } else {
            this.gyroBias = gyro.mean; this.gyroNoise = gyro.deviation; this.gyroCalibrated = true;
            const measured = vector(accel.mean.map((value, axis) => (value - this.accelBias[axis]) * this.accelScale[axis]))
                .applyQuaternion(this.q).normalize();
            this.q.premultiply(new Quaternion().setFromUnitVectors(measured, UP)).normalize();
            this.message = '陀螺仪零偏校准完成；加速度六面校准独立进行';
        }
        this.v.set(0, 0, 0); this.filteredGyro = null; this.filteredAcceleration = null;
        this.calibration = null;
    }

    resetOrigin() { this.p.set(0, 0, 0); this.stopVelocity(); }
    stopVelocity() { this.v.set(0, 0, 0); this.zeroCorrections += 1; this.message = '已按用户确认停稳清零速度'; }
    resetHeading() {
        const forward = new Vector3(0, 1, 0).applyQuaternion(this.q);
        const yaw = Math.atan2(-forward.x, -forward.z);
        // 绕世界竖直轴抵消当前航向，保留已有倾斜；同向叠加会把航向误差翻倍。
        this.q.premultiply(new Quaternion().setFromAxisAngle(UP, -yaw)).normalize();
        this.message = '已重置相对航向，保持倾斜';
    }
    pause() { this.lastTime = null; this.v.set(0, 0, 0); this.filteredGyro = null;
        this.filteredAcceleration = null; this.status = 'paused'; this.message = '数据中断，冻结位置；恢复时速度从零开始'; }

    push(sample) {
        if (!sample || !Number.isFinite(sample.time) || !finite3(sample.gyro) || !finite3(sample.accel)
            || !['gravity', 'linear'].includes(sample.kind)) { this.rejected += 1; return false; }
        if (this.lastTime !== null && sample.time <= this.lastTime) { this.rejected += 1; return false; }
        this.calibrate(sample);
        this.lastSample = sample; this.samples += 1;
        const dt = this.lastTime === null ? 0 : sample.time - this.lastTime;
        this.lastTime = sample.time;
        const force = vector(sample.accel.map((value, axis) => (value - this.accelBias[axis]) * this.accelScale[axis]));
        if (!this.initialized) {
            if (sample.kind === 'gravity' && force.length() > 1) this.q.setFromUnitVectors(force.clone().normalize(), UP);
            this.initialized = true;
        }
        if (dt > this.profile.maxGap) {
            this.gaps += 1; this.v.set(0, 0, 0); this.filteredGyro = null; this.filteredAcceleration = null;
            this.status = 'gap'; this.message = '断流：未跨空白区积分，速度重新初始化'; return true;
        }
        this.status = 'tracking';
        if (!this.calibration && !this.gyroCalibrated) this.message = '未校准：先保持静止并校准零偏';
        const gyro = vector(sample.gyro.map((value, axis) => value - this.gyroBias[axis]));
        const blend = this.profile.filterHz <= 0 ? 1 : 1 - Math.exp(-2 * Math.PI * this.profile.filterHz * dt);
        // 姿态必须与当前加速度属于同一采样区间；单独低通角速度会把重力投影成虚假平移。
        // 降噪在扣除重力后的世界线性加速度上进行，避免混用不同延迟的六轴数据。
        const rate = gyro.clone();
        if (rate.length() < this.profile.gyroDeadZone) rate.set(0, 0, 0);
        // 用户确认静置后采集零偏时，不把尚未扣除的零偏积成不可观测航向误差。
        if (this.calibration && this.calibration.face === null) rate.set(0, 0, 0);
        const midpoint = this.q.clone().multiply(rotationStep(rate, dt / 2));
        this.q.multiply(rotationStep(rate, dt)).normalize();
        const acceleration = force.applyQuaternion(midpoint);
        if (sample.kind === 'gravity') acceleration.y -= GRAVITY;
        this.filteredAcceleration ??= acceleration.clone(); this.filteredAcceleration.lerp(acceleration, blend);
        const linear = this.filteredAcceleration.clone();
        if (linear.length() < this.profile.accelDeadZone) linear.set(0, 0, 0);
        if (dt > 0) {
            this.p.addScaledVector(this.v, dt).addScaledVector(linear, 0.5 * dt * dt);
            this.v.addScaledVector(linear, dt);
        }
        const quiet = rate.length() < 0.02 && acceleration.length() < 0.12;
        this.quietSince = quiet ? this.quietSince ?? sample.time : null;
        const assumedStopped = this.profile.assumedRest && this.quietSince !== null && sample.time - this.quietSince > 0.7;
        // 低加速度不能证明静止，必须由用户启用停稳假设；一般运动不使用加速度纠正倾斜。
        if (assumedStopped && sample.kind === 'gravity' && this.profile.tiltGain > 0 && dt > 0) {
            const direction = vector(sample.accel.map((value, axis) => (value - this.accelBias[axis]) * this.accelScale[axis]))
                .applyQuaternion(midpoint).normalize();
            const correction = new Quaternion().setFromUnitVectors(direction, UP);
            this.q.premultiply(new Quaternion().slerp(correction, 1 - Math.exp(-this.profile.tiltGain * dt))).normalize();
        }
        if (assumedStopped) {
            this.v.set(0, 0, 0); this.zeroCorrections += 1;
            this.message = '手持停稳假设已清零速度；匀速运动也可能被误判';
        }
        this.correctedGyro = rate.toArray(); this.linearAcceleration = linear.toArray();
        return true;
    }

    snapshot() {
        return { position: this.p.toArray(), velocity: this.v.toArray(), quaternion: this.q.toArray(),
            gyro: this.correctedGyro || [0, 0, 0], linear: this.linearAcceleration || [0, 0, 0],
            rawGyro: this.lastSample?.gyro || [0, 0, 0], rawAccel: this.lastSample?.accel || [0, 0, 0],
            time: this.lastSample?.time ?? 0, samples: this.samples, gaps: this.gaps, rejected: this.rejected,
            zeroCorrections: this.zeroCorrections, status: this.status, message: this.message,
            gyroCalibrated: this.gyroCalibrated, accelCalibrated: this.accelCalibrated,
            calibrationActive: Boolean(this.calibration), faces: Object.keys(this.faces).length,
            gyroBias: [...this.gyroBias], gyroNoise: [...this.gyroNoise], kind: this.lastSample?.kind || 'gravity' };
    }
}
