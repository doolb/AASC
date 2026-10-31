const norm = values => Math.hypot(...values);
const distance = (a, b) => norm(a.map((value, axis) => value - b[axis]));
const bounded = (value, min, max) => Math.max(min, Math.min(max, value));

/** 世界坐标中的均值和向量波动；不能用显示死区后的零值冒充静稳观测。 */
function statistics(entries, key) {
    const mean = [0, 1, 2].map(axis => entries.reduce((sum, entry) => sum + entry[key][axis], 0) / entries.length);
    const variation = Math.sqrt(entries.reduce((sum, entry) => sum + distance(entry[key], mean) ** 2, 0) / entries.length);
    return { mean, variation };
}

/** 只消费固定延迟窗口已有的未来观测；减速证据与静稳确认缺一不可，原静稳仍独立兜底。 */
export class StopRecovery {
    constructor() {
        this.active = false; this.enabled = false; this.braking = []; this.reference = null;
        this.state = 'disabled'; this.source = 'none'; this.reason = '快停尚未启用';
        this.brakingAt = null; this.decisionTime = null; this.evidenceEndTime = null;
        this.windowSeconds = 0; this.gyroMeanError = null; this.gyroVariation = null; this.accelVariation = null;
        this.corrections = 0;
    }

    /** 退出只看当前源帧；不能让未来的新动作提前解除过去中心帧的停稳。 */
    isMoving(acceleration, rate) {
        return this.active && (distance(acceleration, this.reference.acceleration) > this.reference.accelLimit
            || distance(rate, this.reference.rate) > this.reference.rateLimit);
    }

    update(center, neighbors, acceleration, velocity, dt) {
        const frame = center.frame, profile = frame.profile;
        this.enabled = Boolean(profile.stopRecoveryEnabled !== false && profile.denoiseEnabled
            && profile.remoteAutoRest && frame.kind === 'gravity');
        if (!this.enabled) {
            this.active = false; this.braking = []; this.reference = null;
            this.state = 'disabled'; this.source = 'none'; this.reason = '需开启远端静稳、多帧降噪及快停';
            return false;
        }
        if (this.isMoving(center.acceleration, center.rate)) {
            this.active = false; this.reference = null; this.braking = [];
            this.state = 'motion'; this.source = 'none'; this.reason = '当前源帧出现新运动，退出快停';
            return false;
        }
        if (this.active) return true;
        this.source = center.hold ? 'legacy' : 'none';
        this.state = center.hold ? 'fallback' : 'waiting';
        this.reason = center.hold ? '原静稳兜底清速' : '等待减速及未来强静稳';
        this.braking = this.braking.filter(item => frame.time - item.time <= 1.2);
        const speed = norm(velocity), magnitude = norm(acceleration);
        const projection = speed > .08 ? acceleration.reduce((sum, value, axis) => sum + value * velocity[axis], 0) / speed : 0;
        const rawProjection = speed > .08 ? center.acceleration.reduce((sum, value, axis) => sum + value * velocity[axis], 0) / speed : 0;
        // 原始对齐观测也必须支持减速；一次脉冲的低通尾巴不能累计成多帧刹车证据。
        if (dt > 0 && dt <= profile.maxGap && magnitude > .15 && projection < -.12
            && norm(center.acceleration) > .15 && rawProjection < -.12) {
            this.braking.push({ time: frame.time, duration: dt, impulse: -projection * dt });
            if (this.braking.length > 128) this.braking.shift();
            this.brakingAt = frame.time;
        }
        const duration = this.braking.reduce((sum, item) => sum + item.duration, 0);
        const impulse = this.braking.reduce((sum, item) => sum + item.impulse, 0);
        if (center.hold || speed <= .08 || this.braking.length < 2 || duration < .04 - 1e-8 || impulse < .008) return false;
        this.state = 'braking'; this.reason = '已有减速证据，等待未来强静稳';
        const future = neighbors.filter(entry => entry.frame.time >= frame.time && entry.frame.time <= frame.time + .3 + 1e-8);
        this.windowSeconds = future.length ? future.at(-1).frame.time - frame.time : 0;
        if (future.length < 8 || this.windowSeconds < .24 - 1e-8
            || future.some((entry, index) => index && entry.frame.time - future[index - 1].frame.time > Math.min(.08, profile.maxGap) + 1e-8)) return false;
        const accel = statistics(future, 'acceleration'), gyro = statistics(future, 'rate');
        const noise = frame.restNoise, gyroNoise = norm(noise?.gyroDeviation || [0, 0, 0]);
        this.gyroMeanError = distance(gyro.mean, noise?.gyroMean || [0, 0, 0]);
        this.gyroVariation = gyro.variation; this.accelVariation = accel.variation;
        const meanForce = [...accel.mean]; meanForce[1] += frame.gravityMagnitude;
        if (!(frame.gravityMagnitude >= 9 && frame.gravityMagnitude <= 10.4)
            || norm(accel.mean) > .2 || Math.abs(norm(meanForce) - frame.gravityMagnitude) > .15
            || this.gyroMeanError > bounded(3 * gyroNoise / Math.sqrt(future.length), .015, .03)
            || gyro.variation > bounded(.5 * gyroNoise, .008, .02)
            || accel.variation > bounded(.4 * (noise?.forceVariation || 0), .03, .08)) return false;
        this.active = true; this.state = 'rest'; this.source = 'future'; this.reason = '减速后未来强静稳，清除残速';
        this.decisionTime = frame.time; this.evidenceEndTime = future.at(-1).frame.time; this.corrections += 1;
        this.reference = { acceleration: accel.mean, rate: gyro.mean,
            accelLimit: bounded(6 * accel.variation, .06, .3), rateLimit: bounded(6 * gyro.variation, .04, .15) };
        this.braking = [];
        return true;
    }

    snapshot() {
        return Object.fromEntries(['enabled', 'active', 'state', 'source', 'reason', 'brakingAt', 'decisionTime',
            'evidenceEndTime', 'windowSeconds', 'gyroMeanError', 'gyroVariation', 'accelVariation', 'corrections']
            .map(key => [key, this[key]]));
    }
}
