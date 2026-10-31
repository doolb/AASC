import { Vector3 } from 'three';

const vector = values => new Vector3().fromArray(values);
const zero = () => [0, 0, 0];
const difference = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

/** 指数响应的重复积分系数；短区间用级数，避免相近大数相减。 */
function exponentialMoments(z) {
    if (z < .5) return [1, 2, 3, 4].map(order => {
        let factorial = 1;
        for (let i = 2; i <= order; i += 1) factorial *= i;
        let term = 1 / factorial, sum = term;
        for (let i = 1; i <= 14; i += 1) { term *= -z / (order + i); sum += term; }
        return sum;
    });
    const values = [-Math.expm1(-z) / z];
    for (const divisor of [1, 2, 6]) values.push((1 / divisor - values.at(-1)) / z);
    return values;
}

/** 对区间内线性输入及其一阶低通响应精确求三阶原函数；不使用拟合输出近似冲量。 */
export function integrateSignal(signal, duration = signal.end - signal.start) {
    const h = duration, a = zero(), velocity = zero(), position = zero(), third = zero();
    const lambda = 2 * Math.PI * signal.hz, phi = lambda > 0 ? exponentialMoments(lambda * h) : null;
    for (let axis = 0; axis < 3; axis += 1) {
        const base = signal.input0[axis], slope = signal.slope[axis];
        a[axis] = base + slope * h;
        velocity[axis] = base * h + slope * h * h / 2;
        position[axis] = base * h * h / 2 + slope * h ** 3 / 6;
        third[axis] = base * h ** 3 / 6 + slope * h ** 4 / 24;
        if (!phi) continue;
        const delta = signal.filtered0[axis] - base;
        a[axis] = base + slope * h * (1 - phi[0]) + delta * Math.exp(-lambda * h);
        velocity[axis] = base * h + slope * h * h * (.5 - phi[1]) + delta * h * phi[0];
        position[axis] = base * h * h / 2 + slope * h ** 3 * (1 / 6 - phi[2]) + delta * h * h * phi[1];
        third[axis] = base * h ** 3 / 6 + slope * h ** 4 * (1 / 24 - phi[3]) + delta * h ** 3 * phi[2];
    }
    return { acceleration: a, velocity, position, third };
}

export function constantSignal(start, end, acceleration) {
    return { start, end, input0: [...acceleration], slope: zero(), filtered0: [...acceleration], hz: 0 };
}

/** 只保存源输入侧的前值；原始估计与延迟支路各自拥有实例。 */
export class SourceFilter {
    constructor() { this.reset(); }
    reset() { this.time = null; this.input = null; this.filtered = null; }
    prepare(time, acceleration, hz, convention = 'instantaneous') {
        const start = this.time ?? time, h = time - start;
        const input0 = convention === 'instantaneous' && h > 0 ? this.input : acceleration;
        const slope = h > 0 ? acceleration.map((value, axis) => (value - input0[axis]) / h) : zero();
        return { start, end: time, input0: [...input0], slope,
            filtered0: [...(this.filtered || acceleration)], hz, input1: [...acceleration] };
    }
    commit(signal, hold = false) {
        const result = integrateSignal(signal);
        this.time = signal.end; this.input = hold ? zero() : [...signal.input1];
        this.filtered = hold ? zero() : result.acceleration;
        return result;
    }
    hold(time) { this.time = time; this.input = zero(); this.filtered = zero(); }
}

/** 支持内局部重基准：原函数的仿射偏移不影响对称窗口修正，避免长会话消减误差。 */
class IntegralWindow {
    constructor(entries, noise) {
        this.entries = entries;
        const pulses = entries.map(() => zero());
        const threshold = Math.max(.35, noise * 6);
        // 拆分孤立真实脉冲，平滑背景并直通脉冲；不以变化的滤波权重修改整段积分。
        for (let i = 1; i < entries.length - 1; i += 1) {
            const left = entries[i - 1], center = entries[i], right = entries[i + 1];
            if (center.signal.hz > 0 || left.hold || center.hold || right.hold
                || difference(left.value, right.value) > threshold) continue;
            const ratio = (center.frame.time - left.frame.time) / (right.frame.time - left.frame.time);
            const baseline = left.value.map((value, axis) => value + (right.value[axis] - value) * ratio);
            if (difference(center.value, baseline) > threshold) pulses[i] = center.value.map((value, axis) => value - baseline[axis]);
        }
        this.pulses = pulses; this.nodes = [{ velocity: zero(), position: zero(), third: zero() }];
        this.signals = entries.map((entry, i) => {
            if (entry.signal.hz > 0) return entry.signal;
            const current = entry.value.map((value, axis) => value - pulses[i][axis]);
            const start = entry.signal.start, end = entry.signal.end, h = end - start;
            const previous = entry.frame.integration?.convention === 'instantaneous' && i > 0
                ? entries[i - 1].value.map((value, axis) => value - pulses[i - 1][axis]) : current;
            return { start, end, input0: previous, filtered0: previous,
                slope: h > 0 ? current.map((value, axis) => (value - previous[axis]) / h) : zero(), hz: 0 };
        });
        for (let i = 1; i < entries.length; i += 1) this.nodes.push(this.advance(this.nodes.at(-1), this.signals[i], entries[i].frame.time));
    }
    advance(node, signal, time) {
        const h = time - signal.start, moments = integrateSignal(signal, h);
        return { acceleration: moments.acceleration,
            velocity: node.velocity.map((v, axis) => v + moments.velocity[axis]),
            position: node.position.map((p, axis) => p + node.velocity[axis] * h + moments.position[axis]),
            third: node.third.map((j, axis) => j + node.position[axis] * h + node.velocity[axis] * h * h / 2 + moments.third[axis]) };
    }
    at(time) {
        const first = this.entries[0], h = time - first.frame.time;
        if (h <= 0) {
            const a = first.value.map((value, axis) => value - this.pulses[0][axis]);
            const slope = first.frame.integration?.convention === 'instantaneous' && this.signals[1]?.hz === 0
                ? this.signals[1].slope : zero();
            const result = integrateSignal({ input0: a, slope, hz: 0 }, h);
            return { acceleration: result.acceleration, velocity: result.velocity, position: result.position, third: result.third };
        }
        for (let i = 1; i < this.entries.length; i += 1) {
            if (time <= this.entries[i].frame.time + 1e-8) return this.advance(this.nodes[i - 1], this.signals[i], Math.min(time, this.entries[i].frame.time));
        }
        throw new Error('守恒降噪缺少未来源样本');
    }
}

/** 按同一输入的原函数计算区间冲量和时间矩；窗口平滑不改变完整动作的净积分。 */
export class ConservativeDenoise {
    constructor() { this.previous = null; }
    correction(center, entries, lag, noise) {
        const radius = Math.min(.08, lag / 3), time = center.frame.time;
        if (entries.some(entry => entry.hold && Math.abs(entry.frame.time - time) <= radius + 1e-8)) {
            return { c: zero(), d: zero(), acceleration: [...center.value] };
        }
        const window = new IntegralWindow(entries, noise);
        const before = window.at(time - radius), now = window.at(time), after = window.at(time + radius);
        const index = entries.indexOf(center), pulse = window.pulses[index];
        return { c: now.position.map((p, axis) => (after.third[axis] - before.third[axis]) / (2 * radius) - p),
            d: now.velocity.map((v, axis) => (after.position[axis] - before.position[axis]) / (2 * radius) - v),
            acceleration: now.acceleration.map((a, axis) => (after.velocity[axis] - before.velocity[axis]) / (2 * radius) + pulse[axis]) };
    }
    advance(position, velocity, center, entries, lag, noise, hold) {
        const time = center.frame.time, correction = this.correction(center, entries, lag, noise);
        const dt = this.previous ? time - this.previous.time : 0;
        let state = dt > 0 ? 'tracking' : 'priming';
        if (hold) {
            velocity.set(0, 0, 0); correction.acceleration = zero(); correction.c = zero(); correction.d = zero(); state = 'held';
        } else if (dt > 0) {
            const moments = integrateSignal(center.signal);
            position.addScaledVector(velocity, dt).add(vector(moments.position));
            for (let axis = 0; axis < 3; axis += 1) {
                position.setComponent(axis, position.getComponent(axis) + correction.c[axis] - this.previous.c[axis] - this.previous.d[axis] * dt);
                velocity.setComponent(axis, velocity.getComponent(axis) + moments.velocity[axis] + correction.d[axis] - this.previous.d[axis]);
            }
        }
        this.previous = { time, c: correction.c, d: correction.d };
        return { acceleration: correction.acceleration, state, dt };
    }
}
