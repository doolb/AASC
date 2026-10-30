export const TRAIL_LIMIT = 600;
const statuses = new Set(['waiting', 'tracking', 'warming', 'paused', 'gap']);
const vector = (value, bound) => Array.isArray(value) && value.length === 3
    && value.every(number => Number.isFinite(number) && Math.abs(number) <= bound);

/** 旧XYZ只能保留位置；缺少的历史测量必须留空，禁止用最新帧回填。 */
export function normalizeEstimatedTrailPoint(value) {
    if (Array.isArray(value)) return vector(value, 1e5)
        ? { position: [...value], time: null, velocity: null, status: null } : null;
    if (!value || !vector(value.position, 1e5)) return null;
    const time = value.time ?? null, velocity = value.velocity ?? null, status = value.status ?? null;
    if (time !== null && (!Number.isFinite(time) || time < 0 || time > 1e8)) return null;
    if (velocity !== null && !vector(velocity, 1e4)) return null;
    if (status !== null && !statuses.has(status)) return null;
    return { position: [...value.position], time, velocity: velocity && [...velocity], status };
}

/** 完整快照保留网页已抽稀的点序，逐点验证后整体返回，非法项不能部分写入。 */
export function normalizeEstimatedTrail(value) {
    if (!Array.isArray(value) || value.length > TRAIL_LIMIT) return null;
    const points = value.map(normalizeEstimatedTrailPoint);
    return points.some(point => point === null) ? null : points;
}

/** 时间推进本身不产生几何点；只补位置变化及单次停止/暂停/恢复端点。 */
export function shouldAppendEstimatedPoint(previous, next) {
    if (!previous) return true;
    const distance = next.position.reduce((sum, value, index) => sum + (value - previous.position[index]) ** 2, 0);
    if (distance > .0001) return true;
    if (next.status !== null && next.status !== previous.status) return true;
    if (next.velocity !== null && previous.velocity !== null) {
        return (Math.hypot(...next.velocity) <= 1e-6) !== (Math.hypot(...previous.velocity) <= 1e-6);
    }
    return false;
}

export function appendEstimatedTrail(trail, points) {
    for (const point of points) {
        if (!shouldAppendEstimatedPoint(trail.at(-1), point)) continue;
        trail.push(structuredClone(point));
        if (trail.length > TRAIL_LIMIT) trail.shift();
    }
}
