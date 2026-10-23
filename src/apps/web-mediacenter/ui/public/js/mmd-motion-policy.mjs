// 自动生成采用更小的动作预算；人工MPL编辑仍使用原编译规则。
export function validateMotionSource(source) {
    if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > 16384) throw new Error('自动MPL需为1–16KiB');
    if (/\b(?:base|center|move|repeat|loop|while|import|include)\b/u.test(source)) throw new Error('自动动作禁止根位移、循环或外部资源');
    if ((source.match(/@pose\b/gu) || []).length > 32 || (source.match(/@animation\b/gu) || []).length > 8) throw new Error('自动动作结构过多');
    return source;
}
export function validateMotionSampler(sampler, model, buffer) {
    if (!Number.isFinite(sampler.duration) || sampler.duration < 0.2 || sampler.duration > 15) throw new Error('自动动作时长必须为0.2～15秒');
    if (sampler.warnings.length || !sampler.tracks.length || sampler.tracks.length > 96) throw new Error('动作存在缺失或过多的模型轨道');
    const view = new DataView(buffer), bones = view.getUint32(50, true), end = 54 + bones * 111;
    if (bones + view.getUint32(end, true) > 20000) throw new Error('自动动作超过20000关键帧');
    for (const track of sampler.tracks) {
        if (!model.allowed(track, [])) throw new Error('自动动作包含根骨骼或物理控制轨道');
        const bone = track.kind === 'bone' ? model.bones[track.index] : null;
        const rest = bone?.restQuaternion?.toArray();
        let previous = null;
        for (let frame = 0; frame <= Math.ceil(sampler.duration * 30); frame++) {
            const values = Array.from(track.evaluate(Math.min(frame / 30, sampler.duration)));
            if (values.some(v => !Number.isFinite(v))) throw new Error('自动动作包含非法数值');
            if (track.kind === 'morph' && (values[0] < 0 || values[0] > 1)) throw new Error('表情权重超出范围');
            if (track.property === 'position' && values.some((v, i) => Math.abs(v - bone.restPosition.toArray()[i]) > 0.0001)) throw new Error('自动动作不支持骨骼位移');
            if (track.property === 'quaternion') {
                const length = Math.hypot(...values);
                if (Math.abs(length - 1) > 0.02) throw new Error('自动动作旋转无效');
                const q = values.map(v => v / length);
                const angle = other => 2 * Math.acos(Math.min(1, Math.abs(q.reduce((sum, v, i) => sum + v * other[i], 0)))) * 180 / Math.PI;
                const limit = /頭|首|head|neck/iu.test(bone.name) ? 75 : 150;
                if (angle(rest) > limit + 0.01 || (previous && angle(previous) > 12.1)) throw new Error('自动动作幅度或旋转速度超出限制');
                previous = q;
            }
        }
    }
}
