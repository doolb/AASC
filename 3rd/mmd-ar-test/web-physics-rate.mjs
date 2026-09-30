// 仅独立网页使用：高频预算覆盖runtime最多0.1秒的帧间隔，并留一个累计余量。
// 不超过90Hz时维持既有3子步，避免改变默认65Hz的低频行为。
export function getWebPhysicsStepOptions(value) {
    const number = Number(value);
    const fps = Number.isFinite(number)
        ? Math.round(Math.min(180, Math.max(30, number)) / 5) * 5 : 65;
    return { unitStep: 1 / fps, maxStepNum: fps <= 90 ? 3 : Math.ceil(fps * 0.1) + 1 };
}
