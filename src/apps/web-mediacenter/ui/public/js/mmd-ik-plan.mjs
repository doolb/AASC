// 动作生成、存储和显示端共用的数据契约；不执行源码，也不接受世界坐标或逐帧脚本。
export const IK_TARGET_BONES = Object.freeze({ head: 'head', leftHand: 'leftWrist', rightHand: 'rightWrist',
    leftElbow: 'leftElbow', rightElbow: 'rightElbow', leftKnee: 'leftKnee', rightKnee: 'rightKnee',
    leftFoot: 'leftAnkle', rightFoot: 'rightAnkle', pelvis: 'hips', chest: 'upperBody' });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeName = key => typeof key === 'string' && key.length > 0 && key.length <= 100
    && !Object.hasOwn(Object.prototype, key) && !/[\u0000-\u001f]/u.test(key);
const keys = value => JSON.stringify(Object.keys(value).sort());
export const isIKSource = source => typeof source === 'string' && source.trim().startsWith('{');

export function normalizeIKPlan(input, capabilities = null) {
    if (!object(input) || input.format !== 'ik-targets' || input.version !== 1
        || !Number.isFinite(input.duration) || input.duration < 0.2 || input.duration > 15
        || !Array.isArray(input.frames) || input.frames.length < 2 || input.frames.length > 48) throw new Error('IK动作格式、时长或帧数无效');
    const available = capabilities?.ikTargets;
    const morphs = capabilities?.morphs?.map(item => typeof item === 'string' ? item : item.name);
    const vector = (value, limit) => {
        if (!Array.isArray(value) || value.length !== 3 || value.some(n => !Number.isFinite(n) || Math.abs(n) > limit)) {
            throw new Error('IK目标位移或角度超出范围');
        }
        return [...value];
    };
    const frames = input.frames.map((frame, index) => {
        if (!object(frame) || !Number.isFinite(frame.time) || frame.time < 0 || frame.time > input.duration
            || (index && frame.time <= input.frames[index - 1].time) || !object(frame.targets)
            || Object.keys(frame.targets).length > 11 || !object(frame.morphs || {})) throw new Error('IK关键帧时间或目标无效');
        const targets = {};
        for (const [key, value] of Object.entries(frame.targets)) {
            if (!Object.hasOwn(IK_TARGET_BONES, key) || (available && !available.includes(key)) || !object(value)
                || !Object.keys(value).length || Object.keys(value).some(property => !['position', 'rotation'].includes(property))) {
                throw new Error('IK目标部位不可用：' + key);
            }
            targets[key] = Object.fromEntries(Object.entries(value).map(([property, values]) =>
                [property, vector(values, property === 'position' ? 0.5 : 90)]));
        }
        const expressions = {};
        if (Object.keys(frame.morphs || {}).length > 16) throw new Error('IK动作表情数量超限');
        for (const [key, value] of Object.entries(frame.morphs || {})) {
            if (!safeName(key) || (morphs && !morphs.includes(key)) || !Number.isFinite(value) || value < 0 || value > 1) {
                throw new Error('IK动作表情不可用：' + key);
            }
            expressions[key] = value;
        }
        return { time: frame.time, targets, morphs: expressions };
    });
    if (frames[0].time !== 0 || frames.at(-1).time !== input.duration || !Object.keys(frames[0].targets).length) {
        throw new Error('IK动作需从0开始，在指定时长结束，且包含身体目标');
    }
    const first = frames[0];
    for (const [index, frame] of frames.entries()) {
        if (keys(frame.targets) !== keys(first.targets) || keys(frame.morphs) !== keys(first.morphs)) throw new Error('IK关键帧通道必须保持一致');
        for (const key of Object.keys(first.targets)) {
            if (keys(frame.targets[key]) !== keys(first.targets[key])) throw new Error('IK目标通道必须保持一致');
            for (const [property, value] of Object.entries(frame.targets[key])) {
                if ((index === 0 || index === frames.length - 1) && value.some(n => Math.abs(n) > 1e-6)) {
                    throw new Error('IK动作首尾必须回到基准姿态');
                }
                if (index) {
                    const previous = frames[index - 1], dt = frame.time - previous.time;
                    const speed = Math.hypot(...value.map((n, axis) => n - previous.targets[key][property][axis])) / dt;
                    // smoothstep区间的峰值速度为平均速度的1.5倍，校验实际插值峰值。
                    if (speed * 1.5 > (property === 'position' ? 2 : 360)) throw new Error('IK目标变化过快');
                }
            }
        }
        if ((index === 0 || index === frames.length - 1) && Object.values(frame.morphs).some(n => n > 1e-6)) {
            throw new Error('IK表情首尾必须释放');
        }
    }
    const plan = { format: 'ik-targets', version: 1, duration: input.duration, frames };
    if (new TextEncoder().encode(JSON.stringify(plan)).length > 16384) throw new Error('IK动作最多16KiB');
    return plan;
}

export function parseIKSource(source, capabilities) {
    if (typeof source !== 'string' || new TextEncoder().encode(source).length > 16384) throw new Error('IK动作源码无效或过大');
    return normalizeIKPlan(JSON.parse(source), capabilities);
}

/** 生成与旧动作共用的采样器；IK轨道交给目标混合，不作为骨骼旋转轨道执行。 */
export function createIKSampler(source, model, parameters = {}) {
    const available = Object.keys(IK_TARGET_BONES).filter(key => {
        const bone = model.bindings['bones:' + IK_TARGET_BONES[key]];
        return bone && !bone.dynamic;
    });
    const plan = parseIKSource(source, { ikTargets: available, morphs: model.morphs });
    const cycle = parameters.duration ?? plan.duration, count = parameters.count ?? 1;
    if (!Number.isFinite(cycle) || cycle < 0.2 || cycle > 15 || !Number.isInteger(count) || count < 1 || count > 8) throw new Error('IK动作时长或次数无效');
    const interpolate = (time, read) => {
        const t = Math.min(plan.duration, Math.max(0, (time >= cycle * count ? cycle : time % cycle) / cycle * plan.duration));
        const index = Math.max(1, plan.frames.findIndex(frame => frame.time >= t));
        const a = plan.frames[index - 1], b = plan.frames[index];
        const fraction = Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
        const blend = fraction * fraction * (3 - 2 * fraction), first = read(a), next = read(b);
        return first.map((value, axis) => value + (next[axis] - value) * blend);
    };
    const tracks = [];
    for (const [key, channels] of Object.entries(plan.frames[0].targets)) {
        for (const property of Object.keys(channels)) tracks.push({ kind: 'ik', key, property,
            index: model.bindings['bones:' + IK_TARGET_BONES[key]].index,
            evaluate: time => interpolate(time, frame => frame.targets[key][property]) });
    }
    for (const name of Object.keys(plan.frames[0].morphs)) tracks.push({ kind: 'morph',
        index: model.morphs.find(item => item.name === name).index,
        evaluate: time => interpolate(time, frame => [frame.morphs[name]]) });
    return { duration: cycle * count, tracks, warnings: [], format: 'ik-targets', plan };
}
