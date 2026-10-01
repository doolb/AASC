// 风参数属于独立测试构建；强度为效果等级，经纬度标的是风来源，与灯光坐标一致。
// 归一化函数自包含，构建时也将同一函数嵌入经典Display/面板脚本，避免三处规则漂移。
export function normalizeWindSettings(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max, step) => {
        const raw = input[key];
        if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return fallback;
        return Number((Math.round(Math.min(max, Math.max(min, parsed)) / step) * step).toFixed(2));
    };
    return { enabled: input.enabled === true,
        strength: number('strength', 0.3, 0, 3, 0.05),
        longitude: number('longitude', 0, -180, 180, 1),
        latitude: number('latitude', 0, -90, 90, 1),
        gust: number('gust', 0, 0, 100, 5) };
}

export function windFlowDirection(settings) {
    const longitude = settings.longitude * Math.PI / 180;
    const latitude = settings.latitude * Math.PI / 180;
    // 灯光换算的是来源位置；气流从来源吹来，所以这里取相反方向。
    return { x: -Math.sin(longitude) * Math.cos(latitude), y: -Math.sin(latitude),
        z: -Math.cos(longitude) * Math.cos(latitude) };
}

export function createWindState() {
    return { strength: 0, time: 0 };
}

export function advanceWindState(state, seconds, settings) {
    if (!settings.enabled) { state.strength = 0; return 0; }
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    const gain = -Math.expm1(-seconds / 0.3);
    // 用指数缓动在整个子步的平均强度施力，变频不会重复增加固定冲量。
    const average = settings.strength + (state.strength - settings.strength) * (0.3 / seconds) * gain;
    state.strength += (settings.strength - state.strength) * gain;
    const midpoint = state.time + seconds / 2;
    state.time += seconds;
    // 连续、确定性的双频阵风；相位只随实际物理子步推进，不使用渲染帧计数或随机跳变。
    const fluctuation = 0.65 * Math.sin(2 * Math.PI * 0.4 * midpoint)
        + 0.35 * Math.sin(2 * Math.PI * 0.73 * midpoint);
    return Math.max(0, average * (1 + settings.gust / 100 * fluctuation));
}
