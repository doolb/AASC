// 重力角度保持 1:1；死区只决定是否接受目标，缓动只决定到达目标的速度。
export const DEFAULT_GRAVITY_SETTINGS = Object.freeze({ deadZoneDegrees: 0.5, smoothingMs: 20 });

export function normalizeGravitySettings(value = {}) {
    const read = (key, max) => {
        const number = typeof value[key] === 'number' ? value[key] : NaN;
        return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : DEFAULT_GRAVITY_SETTINGS[key];
    };
    return { deadZoneDegrees: read('deadZoneDegrees', 3), smoothingMs: read('smoothingMs', 500) };
}

export function createGravityFilter(THREE, initialSettings = {}) {
    let settings = normalizeGravitySettings(initialSettings);
    const raw = new THREE.Quaternion();
    const target = new THREE.Quaternion();
    const current = new THREE.Quaternion();
    const acceptRaw = (force = false) => {
        if (force || target.angleTo(raw) + 1e-12 >= settings.deadZoneDegrees * Math.PI / 180) {
            target.copy(raw);
            return true;
        }
        return false;
    };
    return {
        setTarget(value, force = false) {
            if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)
                || Math.hypot(...value) < 1e-9) return false;
            raw.fromArray(value).normalize();
            acceptRaw(force);
            return true;
        },
        setSettings(value) {
            settings = normalizeGravitySettings({ ...settings, ...value });
            acceptRaw();
            return { ...settings };
        },
        update(delta) {
            if (settings.smoothingMs <= 0) current.copy(target);
            else if (Number.isFinite(delta) && delta > 0) {
                current.slerp(target, 1 - Math.exp(-delta / (settings.smoothingMs / 1000)));
            }
            // 最终精确到达完整目标，避免小角度残留；不以死区作为缓动停止条件。
            if (current.angleTo(target) < 1e-6) current.copy(target);
            return current;
        },
        isSettled: () => current.angleTo(target) < 1e-6,
        getState: () => ({ raw: raw.toArray(), target: target.toArray(), current: current.toArray(), settings: { ...settings } })
    };
}
