// 工程预设用于近似各关节的支撑/活动差异，不是人体实测常数。
// 质量和有效惯量已由驱动换算；这里不再按质量重复放大阻尼。
export const BODY_DAMPING_PARTS = Object.freeze([
    { key: 'pelvis', label: '骨盆', factor: 1.40 },
    { key: 'torso', label: '躯干', factor: 1.30 },
    { key: 'neck', label: '颈', factor: 1.15 },
    { key: 'head', label: '头', factor: 1.10 },
    { key: 'shoulder', label: '肩 / 上臂', factor: 1.05 },
    { key: 'elbow', label: '肘 / 前臂', factor: 0.95 },
    { key: 'wrist', label: '腕 / 手', factor: 0.85 },
    { key: 'hip', label: '髋 / 大腿', factor: 1.20 },
    { key: 'knee', label: '膝 / 小腿', factor: 1.10 },
    { key: 'ankle', label: '踝 / 脚', factor: 1.15 }
].map(part => Object.freeze(part)));

const PART_BY_SEMANTIC = Object.freeze({ hips: 'pelvis', upperBody: 'torso', chest: 'torso',
    neck: 'neck', head: 'head', Shoulder: 'shoulder', Arm: 'shoulder', Elbow: 'elbow',
    Wrist: 'wrist', Leg: 'hip', Knee: 'knee', Ankle: 'ankle' });

export function normalizeDampingMultipliers(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(BODY_DAMPING_PARTS.map(({ key, factor }) => [key,
        Number.isFinite(source[key]) ? Math.max(0.2, Math.min(2.5, source[key])) : factor]));
}

export function bodyDampingPart(semantic) {
    return PART_BY_SEMANTIC[semantic.replace(/^(left|right)/u, '')] || null;
}

export function bodyDamping(settings, semantic, minimum = 0) {
    const part = bodyDampingPart(semantic);
    // 先处理原自然姿态/导引保护，再乘部位系数，小于1的系数仍能生效。
    return Math.max(minimum, settings.damping) * (settings.dampingMultipliers[part] ?? 1);
}
