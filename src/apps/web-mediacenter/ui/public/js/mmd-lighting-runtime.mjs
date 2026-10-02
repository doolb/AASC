/* PMX 运行时模块：状态由主实例访问器持有，资源不复制。 */
export function createPmxLighting(context) {
    const { KEY_LIGHT_DISTANCE, ambientLight, ambientOcclusion, applyAoRadius, applyShadowMode, fillLight, getModelBounds, getWebPhysicsStepOptions, helper, keyLight, lightingState, setPmxFillShadowMode, setPmxLightingMode, setPmxRimLights } = context;
/* aasc-module-body-begin */
    const normalizeLightNumber = (value, minimum, maximum, fallback) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(maximum, Math.max(minimum, number));
    };

    const normalizePhysicsFps = (value) => {
        // 更新其他灯光参数时保留当前物理频率；初始化的当前值为测试默认90Hz。
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
            return lightingState.physicsFps;
        }
        const clamped = normalizeLightNumber(value, 30, 180, lightingState.physicsFps);
        return Math.round(clamped / 5) * 5;
    };

    const normalizeRotationPhysicsLimit = (value) => {
        const clamped = normalizeLightNumber(value, 30, 1440, lightingState.rotationPhysicsLimit);
        return Math.round(clamped / 10) * 10;
    };

    const normalizeLightColor = (value, fallback = '#ffffff') => {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/iu.test(color) ? color : fallback;
    };

    const normalizeLightDirection = (value) => ({
        longitude: normalizeLightNumber(value?.longitude, -180, 180, 31),
        latitude: normalizeLightNumber(value?.latitude, -90, 90, 46)
    });

    const lightDirectionToPosition = (value) => {
        const direction = normalizeLightDirection(value);
        const longitude = direction.longitude * Math.PI / 180;
        const latitude = direction.latitude * Math.PI / 180;
        const horizontalDistance = Math.cos(latitude) * KEY_LIGHT_DISTANCE;
        return {
            x: Math.sin(longitude) * horizontalDistance,
            y: Math.sin(latitude) * KEY_LIGHT_DISTANCE,
            z: Math.cos(longitude) * horizontalDistance
        };
    };

    const setLighting = (lighting = {}) => {
        const keyDirection = normalizeLightDirection(lighting.keyDirection);
        lightingState.ambientColor = normalizeLightColor(lighting.ambientColor);
        lightingState.ambientIntensity = normalizeLightNumber(lighting.ambientIntensity, 0, 4, 1.8);
        lightingState.keyColor = normalizeLightColor(lighting.keyColor);
        lightingState.keyIntensity = normalizeLightNumber(lighting.keyIntensity, 0, 5, 2.3);
        lightingState.keyDirection = keyDirection;
        lightingState.fillEnabled = lighting.fillEnabled === true;
        lightingState.fillColor = normalizeLightColor(lighting.fillColor);
        lightingState.fillIntensity = normalizeLightNumber(lighting.fillIntensity, 0, 5, 1);
        lightingState.fillDirection = {
            longitude: normalizeLightNumber(lighting.fillDirection?.longitude, -180, 180, -45),
            latitude: normalizeLightNumber(lighting.fillDirection?.latitude, -90, 90, 25)
        };
        lightingState.rimLights = lightingState.rimLights.map((defaults, index) => {
            const value = Array.isArray(lighting.rimLights) ? lighting.rimLights[index] : null;
            return {
                enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaults.enabled,
                color: normalizeLightColor(value?.color, defaults.color),
                intensity: normalizeLightNumber(value?.intensity, 0, 5, defaults.intensity),
                direction: {
                    longitude: normalizeLightNumber(value?.direction?.longitude, -180, 180, defaults.direction.longitude),
                    latitude: normalizeLightNumber(value?.direction?.latitude, -90, 90, defaults.direction.latitude)
                }
            };
        });
        lightingState.pmxToonEnabled = lighting.pmxToonEnabled === true;
        lightingState.physicsFps = normalizePhysicsFps(lighting.physicsFps);
        lightingState.rotationPhysicsLimit = normalizeRotationPhysicsLimit(lighting.rotationPhysicsLimit);
        lightingState.pmxAoColor = normalizeLightColor(lighting.pmxAoColor, '#931231');
        lightingState.pmxAoIntensity = normalizeLightNumber(lighting.pmxAoIntensity, 0, 2, 0.6);
        lightingState.pmxAoRadiusPercent = Math.round(normalizeLightNumber(lighting.pmxAoRadiusPercent, 1, 20, 6));
        lightingState.pmxAoResolution = lighting.pmxAoResolution === 'full' ? 'full' : 'half';
        lightingState.pmxAoSampleCount = [12, 24, 32].includes(Number(lighting.pmxAoSampleCount))
            ? Number(lighting.pmxAoSampleCount) : 24;
        lightingState.pmxAoBlurPassCount = Math.round(normalizeLightNumber(lighting.pmxAoBlurPassCount, 0, 3, 1));
        lightingState.pmxAoBlurRadii = [0, 1, 2].map((index) => Math.round(normalizeLightNumber(
            lighting.pmxAoBlurRadii?.[index], 1, 5, 3
        )));
        const currentPhysics = helper.current?.objects?.get(context.currentMesh)?.physics;
        if (currentPhysics) Object.assign(currentPhysics, getWebPhysicsStepOptions(lightingState.physicsFps, context.physicsStabilityReferenceHz));
        ambientLight.color.set(lightingState.ambientColor);
        ambientLight.intensity = lightingState.ambientIntensity;
        keyLight.color.set(lightingState.keyColor);
        keyLight.intensity = lightingState.keyIntensity;
        fillLight.color.set(lightingState.fillColor);
        fillLight.intensity = lightingState.fillEnabled ? lightingState.fillIntensity : 0;
        setPmxLightingMode(context.currentMesh, lightingState.pmxToonEnabled);
        setPmxRimLights(context.currentMesh, lightingState.rimLights);
        // 兼容旧版持久化的布尔开关；新字段优先，避免切换阴影来源后又被旧值覆盖。
        context.shadowSource = ['none', 'key', 'fill'].includes(lighting.shadowSource)
            ? lighting.shadowSource : lighting.shadowEnabled === false ? 'none' : 'key';
        context.webFillShadowMode = lighting.webFillShadowMode === true;
        context.keyShadowEnabled = lighting.keyShadowEnabled !== false;
        context.shadowEnabled = context.webFillShadowMode
            ? context.keyShadowEnabled || (lightingState.fillEnabled && context.shadowSource === 'fill')
            : (context.shadowSource !== 'none' && (context.shadowSource !== 'fill' || lightingState.fillEnabled));
        setPmxFillShadowMode(context.currentMesh, context.webFillShadowMode && context.keyShadowEnabled
            && lightingState.fillEnabled && context.shadowSource === 'key');
        context.pmxAoEnabled = lighting.pmxAoEnabled !== false;
        ambientOcclusion.setEnabled(context.pmxAoEnabled);
        ambientOcclusion.setResolution(lightingState.pmxAoResolution);
        ambientOcclusion.setSampleCount(lightingState.pmxAoSampleCount);
        ambientOcclusion.setBlurPasses(lightingState.pmxAoBlurPassCount, lightingState.pmxAoBlurRadii);
        ambientOcclusion.setColor(lightingState.pmxAoColor);
        ambientOcclusion.setIntensity(lightingState.pmxAoIntensity);
        applyAoRadius(getModelBounds(context.currentRotationPivot || context.currentMesh));
        applyShadowMode();
        return {
            ambientColor: lightingState.ambientColor,
            ambientIntensity: ambientLight.intensity,
            keyColor: lightingState.keyColor,
            keyIntensity: keyLight.intensity,
            keyDirection,
            fillEnabled: lightingState.fillEnabled,
            fillColor: lightingState.fillColor,
            fillIntensity: lightingState.fillIntensity,
            fillDirection: { ...lightingState.fillDirection },
            rimLights: lightingState.rimLights.map((rim) => ({ ...rim, direction: { ...rim.direction } })),
            pmxToonEnabled: lightingState.pmxToonEnabled,
            shadowEnabled: context.shadowEnabled,
            shadowSource: context.shadowSource,
            keyShadowEnabled: context.keyShadowEnabled,
            physicsFps: lightingState.physicsFps,
            rotationPhysicsLimit: lightingState.rotationPhysicsLimit,
            pmxAoEnabled: context.pmxAoEnabled,
            pmxAoColor: lightingState.pmxAoColor,
            pmxAoIntensity: lightingState.pmxAoIntensity,
            pmxAoRadiusPercent: lightingState.pmxAoRadiusPercent,
            pmxAoResolution: lightingState.pmxAoResolution,
            pmxAoSampleCount: lightingState.pmxAoSampleCount,
            pmxAoBlurPassCount: lightingState.pmxAoBlurPassCount,
            pmxAoBlurRadii: [...lightingState.pmxAoBlurRadii]
        };
    };

/* aasc-module-body-end */
    // 主运行时的阴影拟合也需要同一方向换算函数；显式返回，避免模块拆分后作用域丢失。
    return { setLighting, lightDirectionToPosition };
}
