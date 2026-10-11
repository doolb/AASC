// 刚体形状参数与既有物理一致，只描述形状，不创建诊断绘制器。
export function describeRigidBodyShape(params) {
    const { shapeType, width, height, depth, type } = params || {};
    if (![0, 1, 2].includes(type) || !Number.isFinite(width) || width <= 0) return null;
    const rules = {
        0: () => ({ key: 'sphere', scale: [width, width, width] }),
        1: () => Number.isFinite(height) && height > 0 && Number.isFinite(depth) && depth > 0
            ? { key: 'box', scale: [2 * width, 2 * height, 2 * depth] } : null,
        2: () => Number.isFinite(height) && height >= 0 && Number.isFinite(height / width)
            ? { key: `capsule:${height / width}`, ratio: height / width, scale: [width, width, width] } : null
    };
    return rules[shapeType]?.() || null;
}
