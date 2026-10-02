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
        strength: number('strength', 0.3, 0, 30, 0.05),
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

export function advanceWindState(state, seconds, settings, modulateGust = true) {
    if (!settings.enabled) { state.strength = 0; return 0; }
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    const gain = -Math.expm1(-seconds / 0.3);
    // 用指数缓动在整个子步的平均强度施力，变频不会重复增加固定冲量。
    const average = settings.strength + (state.strength - settings.strength) * (0.3 / seconds) * gain;
    state.strength += (settings.strength - state.strength) * gain;
    const midpoint = state.time + seconds / 2;
    state.time += seconds;
    // 刚体路径先取未调制平均值，再按各刚体世界位置采样；旧调用保持同一阵风行为。
    if (!modulateGust) return Math.max(0, average);
    // 连续、确定性的双频阵风；相位只随实际物理子步推进，不使用渲染帧计数或随机跳变。
    const fluctuation = 0.65 * Math.sin(2 * Math.PI * 0.4 * midpoint)
        + 0.35 * Math.sin(2 * Math.PI * 0.73 * midpoint);
    return Math.max(0, average * (1 + settings.gust / 100 * fluctuation));
}

// 以PMX碰撞代理估算投影面积：盒尺寸是半长，胶囊height为两球心间距。
// 表驱动保持形状职责独立；方向由相对气流转换到刚体局部，不借用骨骼轴作为布面法线。
const projectedAreas = {
    0: (p) => Math.PI * p.width * p.width,
    1: (p, x, y, z) => 4 * (p.height * p.depth * Math.abs(x)
        + p.width * p.depth * Math.abs(y) + p.width * p.height * Math.abs(z)),
    2: (p, x, y) => Math.PI * p.width * p.width
        + 2 * p.width * p.height * Math.sqrt(Math.max(0, 1 - y * y))
};

export function rigidWindProjectedArea(params, x, y, z) {
    if (!Number.isFinite(params.width) || params.width <= 0
        || !Number.isFinite(params.height) || params.height < 0
        || !Number.isFinite(params.depth) || params.depth < 0
        || !Number.isFinite(x + y + z)) return 0;
    return projectedAreas[params.shapeType]?.(params, x, y, z) || 0;
}

export function sampleRigidWindStrength(average, time, gust, position) {
    if (gust <= 0) return average;
    const phase = 0.19 * position.x + 0.11 * position.y + 0.23 * position.z;
    const variation = 0.65 * Math.sin(2 * Math.PI * 0.4 * time + phase)
        + 0.35 * Math.sin(2 * Math.PI * 0.73 * time + 1.37 * phase);
    return Math.max(0, average * (1 + gust / 100 * variation));
}

/**
 * 输出可直接送入原求解器的等效力；不分配临时向量，不改动速度/质量/约束。
 * 自由体在COM受力，type2使用既有真实偏移形成等效力矩及受力点速度。
 * 非负阻力系数冻结于当前子步，按有效逆质量隐式衰减，避免小质量强风一步越过气流速度。
 */
export function calculateRigidWindForce(out, params, rotation, velocity, omega, lever, inertia,
    direction, strength, seconds) {
    out.x = 0; out.y = 0; out.z = 0;
    if (params.type === 0 || !Number.isFinite(params.weight) || !(params.weight > 0)
        || !Number.isFinite(strength) || !(strength > 0)
        || !Number.isFinite(seconds) || !(seconds > 0)) return out;
    const airSpeed = Math.sqrt(20 * strength);
    const x = direction.x * airSpeed - velocity.x - (omega.y * lever.z - omega.z * lever.y);
    const y = direction.y * airSpeed - velocity.y - (omega.z * lever.x - omega.x * lever.z);
    const z = direction.z * airSpeed - velocity.z - (omega.x * lever.y - omega.y * lever.x);
    const speed = Math.hypot(x, y, z);
    if (!(speed > 1e-12) || !Number.isFinite(speed)) return out;
    const nx = x / speed, ny = y / speed, nz = z / speed;
    // 用单位四元数的共轭旋转到局部，避免生成逆四元数/向量。
    const qx = -rotation.x, qy = -rotation.y, qz = -rotation.z, qw = rotation.w;
    const tx = 2 * (qy * nz - qz * ny), ty = 2 * (qz * nx - qx * nz), tz = 2 * (qx * ny - qy * nx);
    const area = rigidWindProjectedArea(params, nx + qw * tx + qy * tz - qz * ty,
        ny + qw * ty + qz * tx - qx * tz, nz + qw * tz + qx * ty - qy * tx);
    const drag = 0.5 * area * speed;
    let mobility = 1 / params.weight;
    if (params.type === 2 && params.boneIndex !== -1) {
        const rx = lever.x, ry = lever.y, rz = lever.z;
        const ax = 2 * (qy * rz - qz * ry), ay = 2 * (qz * rx - qx * rz), az = 2 * (qx * ry - qy * rx);
        const lx = rx + qw * ax + qy * az - qz * ay;
        const ly = ry + qw * ay + qz * ax - qx * az;
        const lz = rz + qw * az + qx * ay - qy * ax;
        // 受力点逆质量矩阵的迹是最大特征值的上界。只用沿风投影可能遗漏另一条极小惯量轴，
        // 斜风会使该轴一步过冲；用此上界同时限制各轴，零惯量轴由调用端力矩限幅锁住。
        mobility = (inertia.x > 0 ? (ly * ly + lz * lz) / inertia.x : 0)
            + (inertia.y > 0 ? (lx * lx + lz * lz) / inertia.y : 0)
            + (inertia.z > 0 ? (lx * lx + ly * ly) / inertia.z : 0);
    }
    const gain = drag / (1 + seconds * mobility * drag);
    if (!Number.isFinite(gain)) return out;
    out.x = x * gain; out.y = y * gain; out.z = z * gain;
    return out;
}
