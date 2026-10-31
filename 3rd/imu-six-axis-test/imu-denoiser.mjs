import { Quaternion, Vector3 } from 'three';
import { StopRecovery } from './imu-stop-recovery.mjs';
import { InstantPreintegration } from './imu-preintegration.mjs';
import { SourceFilter, ConservativeDenoise, constantSignal } from './imu-conservative-denoise.mjs';

const vector = values => new Vector3().fromArray(values);
const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const difference = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

/** 差分MAD在局部匀加速/匀角加速下仍去掉常量趋势；只用于选窗口，不据此宣称信噪比。 */
function noiseLevel(entries, key) {
    if (entries.length < 4) return 0;
    const sigmas = [0, 1, 2].map(axis => {
        const differences = entries.slice(1).map((entry, index) => entry[key][axis] - entries[index][key][axis]);
        const center = median(differences);
        return median(differences.map(value => Math.abs(value - center))) * 1.04836;
    });
    return Math.hypot(...sigmas);
}

/** 密度加权局部二阶拟合；用真实时间而非批次索引，三轴共享同一个时间支持。 */
function fit(entries, values, time, radius) {
    if (entries.length < 5) return null;
    const sums = [0, 0, 0, 0, 0], rhs = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (let index = 0; index < entries.length; index += 1) {
        const x = (entries[index].frame.time - time) / radius;
        const before = entries[Math.max(0, index - 1)].frame.time;
        const after = entries[Math.min(entries.length - 1, index + 1)].frame.time;
        const weight = Math.max(1e-6, (after - before) / 2);
        let power = 1;
        for (let degree = 0; degree < 5; degree += 1) { sums[degree] += weight * power; power *= x; }
        for (let axis = 0; axis < 3; axis += 1) {
            rhs[axis][0] += weight * values[index][axis];
            rhs[axis][1] += weight * values[index][axis] * x;
            rhs[axis][2] += weight * values[index][axis] * x * x;
        }
    }
    const [a, b, c, d, e] = sums;
    const determinant = a * (c * e - d * d) - b * (b * e - c * d) + c * (b * d - c * c);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-16) return null;
    const inverse = [
        [c * e - d * d, c * d - b * e, b * d - c * c],
        [c * d - b * e, a * e - c * c, b * c - a * d],
        [b * d - c * c, b * c - a * d, a * c - b * b]
    ];
    const coefficients = rhs.map(axis => inverse.map(row => row.reduce((sum, v, i) => sum + v * axis[i], 0) / determinant));
    const residual = Math.sqrt(entries.reduce((sum, entry, index) => {
        const x = (entry.frame.time - time) / radius;
        return sum + values[index].reduce((s, v, axis) => s + (v - coefficients[axis][0] - coefficients[axis][1] * x - coefficients[axis][2] * x * x) ** 2, 0);
    }, 0) / entries.length);
    return { value: coefficients.map(axis => axis[0]), residual };
}

function smoothPose(entries, center, radius) {
    const reference = new Quaternion().fromArray(center.frame.quaternion), inverse = reference.clone().invert();
    const tangents = entries.map(entry => {
        const relative = inverse.clone().multiply(new Quaternion().fromArray(entry.frame.quaternion));
        if (relative.w < 0) { relative.x *= -1; relative.y *= -1; relative.z *= -1; relative.w *= -1; }
        const length = Math.hypot(relative.x, relative.y, relative.z);
        const scale = length > 1e-10 ? 2 * Math.atan2(length, relative.w) / length : 2;
        return [relative.x * scale, relative.y * scale, relative.z * scale];
    });
    const result = fit(entries, tangents, center.frame.time, radius);
    if (!result) return [...center.frame.quaternion];
    // 快速转向时切空间低阶模型也会失配；缩小同一中心的支持，不能只保护平移而拖慢转向。
    if (result.residual > .005 && radius > .1) {
        return smoothPose(entries.filter(entry => Math.abs(entry.frame.time - center.frame.time) <= .1 + 1e-8), center, .1);
    }
    const offset = vector(result.value), length = offset.length();
    if (length > 1e-10) reference.multiply(new Quaternion().setFromAxisAngle(offset.divideScalar(length), length));
    return reference.normalize().toArray();
}

/** 原始融合提供运动对齐，窗口只输出已有历史时刻；不会把未来姿态配给过去加速度。 */
export class FixedLagDenoiser {
    constructor() { this.reset(); }

    reset(seed = null, reason = '等待窗口预热') {
        this.stopRecovery = new StopRecovery();
        this.preintegration = new InstantPreintegration();
        this.sourceFilter = new SourceFilter(); this.conservative = new ConservativeDenoise();
        this.entries = []; this.frame = seed ? structuredClone(seed) : null;
        if (this.frame?.integration) this.frame.integration = { ...this.frame.integration, state: 'priming', dt: 0 };
        if (this.frame) this.frame.integrationAcceleration = [0, 0, 0];
        this.lastOutputTime = null; this.latestInputTime = seed?.time ?? null;
        this.position = vector(seed?.position || [0, 0, 0]); this.velocity = vector(seed?.velocity || [0, 0, 0]);
        this.filteredAcceleration = null; this.reason = reason;
        this.state = 'warming'; this.windowSamples = 0; this.noise = 0;
    }

    push(frame, acceleration, rate, hold) {
        if (!this.entries.length && this.lastOutputTime === null) {
            this.state = 'warming'; this.reason = '等待窗口预热';
        }
        const lag = frame.profile.denoiseLagMs / 1000;
        this.latestInputTime = frame.time;
        let signal = this.sourceFilter.prepare(frame.time, acceleration, frame.profile.filterHz, frame.integration?.convention || 'interval');
        let value = this.sourceFilter.commit(signal, hold).acceleration;
        if (hold) { value = [0, 0, 0]; signal = constantSignal(signal.start, signal.end, value); }
        if (frame.integration?.convention !== 'instantaneous') {
            if (Math.hypot(...value) < frame.profile.accelDeadZone) value = [0, 0, 0];
            signal = constantSignal(signal.start, signal.end, value);
        }
        this.entries.push({ frame: structuredClone(frame), acceleration: [...acceleration], rate: [...rate], hold, signal, value });
        if (this.entries.length > 512) { this.reset(this.frame, '窗口超限，重新预热'); this.latestInputTime = frame.time; return; }
        for (const center of this.entries) {
            if (center.frame.time <= (this.lastOutputTime ?? -Infinity) || center.frame.time > frame.time - lag + 1e-8) continue;
            const neighbors = this.entries.filter(entry => Math.abs(entry.frame.time - center.frame.time) <= lag + 1e-8);
            this.emit(center, neighbors, lag);
        }
        const earliest = (this.lastOutputTime ?? frame.time - lag) - lag - .001;
        while (this.entries.length && this.entries[0].frame.time < earliest) this.entries.shift();
    }

    emit(center, neighbors, radius) {
        const fullNeighbors = neighbors;
        this.noise = noiseLevel(neighbors, 'acceleration');
        const accelLimit = Math.max(.35, this.noise * 6), rateLimit = Math.max(.08, noiseLevel(neighbors, 'rate') * 6);
        let first = 0, last = neighbors.length - 1;
        const centerIndex = neighbors.indexOf(center);
        // 对跳变分段而非删除大幅读数：真正短脉冲单独成段，左右窗口不会把它摊开或吞掉。
        for (let index = 1; index < neighbors.length; index += 1) {
            if (neighbors[index].hold === neighbors[index - 1].hold
                && difference(neighbors[index].acceleration, neighbors[index - 1].acceleration) <= accelLimit
                && difference(neighbors[index].rate, neighbors[index - 1].rate) <= rateLimit) continue;
            if (index <= centerIndex) first = index;
            else { last = index - 1; break; }
        }
        let window = neighbors.slice(first, last + 1);
        this.state = first || last < neighbors.length - 1 ? 'edge' : 'tracking';
        this.windowSamples = window.length;
        const dt = this.lastOutputTime === null ? 0 : center.frame.time - this.lastOutputTime;
        this.filteredAcceleration = vector(center.value);
        const fastStopped = this.stopRecovery.update(center, fullNeighbors, center.value, this.velocity.toArray(), dt);
        const result = this.conservative.advance(this.position, this.velocity, center, fullNeighbors, radius, this.noise, center.hold || fastStopped);
        const linear = vector(result.acceleration);
        if (linear.length() < center.frame.profile.accelDeadZone) linear.set(0, 0, 0);
        if (center.hold || fastStopped) {
            this.velocity.set(0, 0, 0); this.filteredAcceleration.set(0, 0, 0); linear.set(0, 0, 0);
        }
        this.preintegration.select(center.frame.integration?.convention || 'interval');
        this.preintegration.state = result.state; this.preintegration.dt = result.dt;
        this.frame = { ...structuredClone(center.frame), position: this.position.toArray(), velocity: this.velocity.toArray(),
            integrationAcceleration: [...result.acceleration],
            integration: this.preintegration.snapshot(center.frame.time),
            quaternion: smoothPose(window, center, radius), linear: linear.toArray(), stopRecovery: this.stopRecovery.snapshot() };
        this.lastOutputTime = center.frame.time; this.reason = '运动对齐多帧降噪';
    }

    snapshot(raw, enabled) {
        const frame = enabled && this.frame ? structuredClone(this.frame) : raw;
        if (enabled && this.state === 'warming') { frame.status = 'warming'; frame.message = '多帧窗口预热，等待未来样本'; }
        const lag = enabled && this.state === 'warming' ? null
            : enabled && this.latestInputTime !== null ? Math.max(0, (this.latestInputTime - frame.time) * 1000) : 0;
        return { ...frame, stopRecovery: enabled ? this.stopRecovery.snapshot() : new StopRecovery().snapshot(),
            profile: { ...raw.profile }, denoise: { enabled, state: enabled ? this.state : 'disabled',
            reason: enabled ? this.reason : '多帧降噪已关闭', lagMs: raw.profile.denoiseLagMs,
            actualLagMs: lag, latestInputTime: enabled ? this.latestInputTime ?? raw.time : raw.time, queuedSamples: this.entries.length,
            windowSamples: this.windowSamples, noiseEstimate: this.noise } };
    }
}
