// 共用基准值：Ammo作为STOP_ERP的标定Hz，XPBD作为每帧子步数。
// 缺失/空串/非法值回退45，其余1–180按整数取整；不修改弹簧/质量/阻尼。
export function normalizeWebStabilityReference(value) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return 45;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.min(180, Math.max(1, number))) : 45;
}

// 仅独立网页使用：全频率预算覆盖runtime最多0.1秒的帧间隔，并留一个累计余量。
// 预算只是上限，正常画面帧仍按实际累计时间执行，低频掉帧不再丢失模拟时间。
export function getWebPhysicsStepOptions(value, stabilityReferenceHz = 45) {
    // 缺失或空白输入不能经Number转换成0后错误地落到30Hz。
    const number = value === null || (typeof value === 'string' && value.trim() === '') ? NaN : Number(value);
    const fps = Number.isFinite(number)
        ? Math.round(Math.min(180, Math.max(30, number)) / 5) * 5 : 90;
    return { unitStep: 1 / fps, maxStepNum: Math.ceil(fps * 0.1) + 1,
        stabilityReferenceHz: normalizeWebStabilityReference(stabilityReferenceHz) };
}
