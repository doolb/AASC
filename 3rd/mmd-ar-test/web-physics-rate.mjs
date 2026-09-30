// 仅独立网页使用：全频率预算覆盖runtime最多0.1秒的帧间隔，并留一个累计余量。
// 预算只是上限，正常画面帧仍按实际累计时间执行，低频掉帧不再丢失模拟时间。
export function getWebPhysicsStepOptions(value) {
    const number = Number(value);
    const fps = Number.isFinite(number)
        ? Math.round(Math.min(180, Math.max(30, number)) / 5) * 5 : 65;
    return { unitStep: 1 / fps, maxStepNum: Math.ceil(fps * 0.1) + 1 };
}
