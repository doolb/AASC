import { Quaternion, Vector3 } from 'three';
import { SourceFilter } from './imu-conservative-denoise.mjs';

/** APK已将加速度插值到陀螺时刻；旧输入/模拟器没有该字段，保留其区间约定。 */
export function samplingConvention(sample) {
    const before = sample?.accelBeforeTime, after = sample?.accelAfterTime;
    if (before === undefined && after === undefined) return 'interval';
    if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after > 86400
        || after < before || before > sample.time + 1e-6 || after + 1e-6 < sample.time
        || after - before > .100001) return null;
    return 'instantaneous';
}

/** 只缓存同一支路的前一个源端点；不存真值、不改变死区或静稳门槛。 */
export class InstantPreintegration {
    constructor() { this.reset(); }

    reset() {
        this.convention = null; this.previousRate = null; this.rateTime = null;
        this.previousAcceleration = null; this.accelerationTime = null;
        this.state = 'priming'; this.dt = 0;
        this.sourceFilter = new SourceFilter();
    }

    select(convention) {
        if (this.convention !== convention) { this.reset(); this.convention = convention; }
    }

    /** 二样本角增量含旋转顺序交叉项；当前姿态对应当前测量时刻，而非半个区间。 */
    rotation(rate, time, maxGap) {
        const dt = this.rateTime === null ? 0 : time - this.rateTime;
        const angle = new Vector3();
        if (dt > 0 && dt <= maxGap) {
            angle.copy(this.previousRate).add(rate).multiplyScalar(dt / 2)
                .addScaledVector(this.previousRate.clone().cross(rate), dt * dt / 12);
        }
        this.previousRate = rate.clone(); this.rateTime = time;
        const length = angle.length();
        return length > 1e-12 ? new Quaternion().setFromAxisAngle(angle.divideScalar(length), length) : new Quaternion();
    }

    /** 对端点加速度的线性插值精确积分；区间输入保持原常加速度算法及运算顺序。 */
    advance(position, velocity, acceleration, time, maxGap, dt, hold = false) {
        const interval = this.accelerationTime === null ? 0 : time - this.accelerationTime;
        this.dt = this.convention === 'instantaneous' ? interval : dt;
        if (hold) {
            this.sourceFilter.hold(time);
            velocity.set(0, 0, 0); this.state = 'held';
            this.previousAcceleration = new Vector3(); this.accelerationTime = time;
            return;
        }
        this.state = this.dt > 0 && this.dt <= maxGap ? 'tracking' : 'priming';
        if (this.state === 'tracking') {
            if (this.convention === 'instantaneous') {
                position.addScaledVector(velocity, interval)
                    .addScaledVector(this.previousAcceleration, interval * interval / 3)
                    .addScaledVector(acceleration, interval * interval / 6);
                velocity.addScaledVector(this.previousAcceleration, interval / 2).addScaledVector(acceleration, interval / 2);
            } else {
                position.addScaledVector(velocity, dt).addScaledVector(acceleration, .5 * dt * dt);
                velocity.addScaledVector(acceleration, dt);
            }
        }
        if (this.state === 'priming') this.dt = 0;
        this.previousAcceleration = acceleration.clone(); this.accelerationTime = time;
    }

    /** 原生支路直接积低通连续响应的区间矩，显示硬死区不参与此处的运动积分。 */
    advanceFiltered(position, velocity, signal, hold = false) {
        const moments = this.sourceFilter.commit(signal, hold);
        this.dt = signal.end - signal.start; this.state = this.dt > 0 ? 'tracking' : 'priming';
        if (hold) { velocity.set(0, 0, 0); this.state = 'held'; moments.acceleration = [0, 0, 0]; }
        if (!hold && this.dt > 0) {
            position.addScaledVector(velocity, this.dt).add(new Vector3().fromArray(moments.position));
            velocity.add(new Vector3().fromArray(moments.velocity));
        }
        this.previousAcceleration = new Vector3().fromArray(moments.acceleration); this.accelerationTime = signal.end;
        return moments.acceleration;
    }

    snapshot(time, convention = this.convention || 'interval') {
        return { convention, state: this.state, time, dt: this.dt };
    }
}
