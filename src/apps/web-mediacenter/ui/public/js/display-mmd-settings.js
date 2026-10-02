/* 显示端新增参数状态独立于显示主流程，重建运行时后由主模块补发。 */
(function exposeMmdSettings(root) {
    'use strict';
    root.createDisplayMmdSettings = ({ state }) => {
    let modelGravityRotation = [0, 0, 0, 1];
    let modelGravityForce = false;
    let modelGravitySettings = { deadZoneDegrees: 0.5, smoothingMs: 20 };
    function setModelGravityRotation(value, force = false) {
        if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)
            || Math.hypot(...value) < 1e-9) return false;
        modelGravityRotation = value.slice();
        modelGravityForce = force === true;
        state.runtime?.setModelGravityRotation?.(modelGravityRotation, modelGravityForce);
        return true;
    }

    function setModelGravitySettings(value) {
        modelGravitySettings = { ...modelGravitySettings, ...value };
        state.runtime?.setModelGravitySettings?.(modelGravitySettings);
    }

    let physicsStabilityReference = 45;
    function setPhysicsStabilityReference(value) {
        // 缺失/空串/非有限值回退45；其余3-180截断并按整数取整（与共享归一化一致）。
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
            physicsStabilityReference = 45;
        } else {
            const number = Number(value);
            physicsStabilityReference = Number.isFinite(number)
                ? Math.round(Math.min(180, Math.max(3, number))) : 45;
        }
        state.runtime?.setPhysicsStabilityReference?.(physicsStabilityReference);
        return physicsStabilityReference;
    }

    function normalizeWindSettings(value = {}) {
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
    let windSettings = normalizeWindSettings();
    function setWindSettings(value) {
        windSettings = normalizeWindSettings(value);
        state.runtime?.setWindSettings?.(windSettings);
        return { ...windSettings };
    }

        return Object.freeze({
            setModelGravityRotation, setModelGravitySettings, setPhysicsStabilityReference, setWindSettings,
            get modelGravityRotation() { return modelGravityRotation; },
            get modelGravityForce() { return modelGravityForce; },
            get modelGravitySettings() { return modelGravitySettings; },
            get physicsStabilityReference() { return physicsStabilityReference; },
            get windSettings() { return windSettings; }
        });
    };
})(window);
