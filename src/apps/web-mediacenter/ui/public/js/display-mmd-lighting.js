/*
 * 显示端 MMD/VRM 灯光面板。
 *
 * 面板修改当前浏览器显示端的 AmbientLight、DirectionalLight、阴影、PMX AO 和物理目标频率，
 * 设置保存到 localStorage，避免把显示调试参数混入 WebSocket 或 Offline APK 配置。
 */
(function exposeDisplayMmdLighting(root) {
    const STORAGE_KEY = 'aasc.display.mmdLighting.v1';
    const DEFAULT_PHYSICS_FPS = 90;
    const DEFAULT_ROTATION_PHYSICS_LIMIT = 720;
    const DEFAULT_LIGHTING = root.DisplayMmd.DEFAULT_MMD_LIGHTING;

    const state = {
        initialized: false,
        elements: null,
        lighting: null,
        resolutionObserver: null
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function observeRenderResolution() {
        const canvas = byId('displayMmdCanvas');
        const label = byId('displayMmdRenderResolution');
        if (!canvas || !label) return;
        const update = () => {
            label.textContent = `${canvas.width}×${canvas.height} px`;
        };
        // 绘制缓冲属性由 DisplayMmd/PMX runtime 在 resize 后设置；直接读取可避免把 CSS 尺寸误报为渲染像素。
        state.resolutionObserver = new MutationObserver(update);
        state.resolutionObserver.observe(canvas, {
            attributes: true,
            attributeFilter: ['width', 'height']
        });
        update();
    }

    function getRimElements(index) {
        const prefix = `displayMmdRim${index}`;
        return {
            enabled: byId(`${prefix}Enabled`),
            color: byId(`${prefix}Color`),
            intensity: byId(`${prefix}Intensity`),
            intensityValue: byId(`${prefix}IntensityValue`),
            directionLongitude: byId(`${prefix}DirectionLongitude`),
            directionLongitudeValue: byId(`${prefix}DirectionLongitudeValue`),
            directionLatitude: byId(`${prefix}DirectionLatitude`),
            directionLatitudeValue: byId(`${prefix}DirectionLatitudeValue`)
        };
    }

    function getBlurRadiusElements(index) {
        return {
            field: byId(`displayMmdPmxAoBlurRadius${index}Field`),
            input: byId(`displayMmdPmxAoBlurRadius${index}`),
            output: byId(`displayMmdPmxAoBlurRadius${index}Value`)
        };
    }

    function getElements() {
        return {
            toggle: byId('displayMmdLightingToggle'),
            panel: byId('displayMmdLightingPanel'),
            reset: byId('displayMmdLightingReset'),
            preset: byId('displayMmdLightingPreset'),
            shadowSource: byId('displayMmdShadowSource'),
            pmxToonEnabled: byId('displayMmdPmxToonEnabled'),
            pmxAoEnabled: byId('displayMmdPmxAoEnabled'),
            pmxAoColor: byId('displayMmdPmxAoColor'),
            pmxAoIntensity: byId('displayMmdPmxAoIntensity'),
            pmxAoIntensityValue: byId('displayMmdPmxAoIntensityValue'),
            pmxAoRadiusPercent: byId('displayMmdPmxAoRadiusPercent'),
            pmxAoRadiusPercentValue: byId('displayMmdPmxAoRadiusPercentValue'),
            pmxAoResolution: byId('displayMmdPmxAoResolution'),
            pmxAoSampleCount: byId('displayMmdPmxAoSampleCount'),
            pmxAoBlurPassCount: byId('displayMmdPmxAoBlurPassCount'),
            pmxAoBlurRadii: [1, 2, 3].map(getBlurRadiusElements),
            physicsFps: byId('displayMmdPhysicsFps'),
            physicsFpsValue: byId('displayMmdPhysicsFpsValue'),
            rotationPhysicsLimit: byId('displayMmdRotationPhysicsLimit'),
            rotationPhysicsLimitValue: byId('displayMmdRotationPhysicsLimitValue'),
            ambientColor: byId('displayMmdAmbientColor'),
            ambientIntensity: byId('displayMmdAmbientIntensity'),
            ambientIntensityValue: byId('displayMmdAmbientIntensityValue'),
            keyColor: byId('displayMmdKeyColor'),
            keyShadowEnabled: byId('displayMmdKeyShadowEnabled'),
            keyIntensity: byId('displayMmdKeyIntensity'),
            keyIntensityValue: byId('displayMmdKeyIntensityValue'),
            keyDirectionLongitude: byId('displayMmdKeyDirectionLongitude'),
            keyDirectionLongitudeValue: byId('displayMmdKeyDirectionLongitudeValue'),
            keyDirectionLatitude: byId('displayMmdKeyDirectionLatitude'),
            keyDirectionLatitudeValue: byId('displayMmdKeyDirectionLatitudeValue'),
            fillEnabled: byId('displayMmdFillEnabled'),
            fillColor: byId('displayMmdFillColor'),
            fillIntensity: byId('displayMmdFillIntensity'),
            fillIntensityValue: byId('displayMmdFillIntensityValue'),
            fillDirectionLongitude: byId('displayMmdFillDirectionLongitude'),
            fillDirectionLongitudeValue: byId('displayMmdFillDirectionLongitudeValue'),
            fillDirectionLatitude: byId('displayMmdFillDirectionLatitude'),
            fillDirectionLatitudeValue: byId('displayMmdFillDirectionLatitudeValue'),
            rimLights: [getRimElements(1), getRimElements(2)]
        };
    }

    function formatNumber(value, digits = 2) {
        return Number(value).toFixed(digits);
    }

    function setPanelOpen(open) {
        const { toggle, panel } = state.elements;
        const nextOpen = open === true;
        panel.hidden = !nextOpen;
        toggle.setAttribute('aria-expanded', String(nextOpen));
    }

    function updateOutputs() {
        const { elements } = state;
        elements.ambientIntensityValue.textContent = formatNumber(elements.ambientIntensity.value);
        elements.keyIntensityValue.textContent = formatNumber(elements.keyIntensity.value);
        elements.fillIntensityValue.textContent = formatNumber(elements.fillIntensity.value);
        elements.rimLights.forEach((rim) => {
            rim.intensityValue.textContent = formatNumber(rim.intensity.value);
            rim.directionLongitudeValue.textContent = `${formatNumber(rim.directionLongitude.value, 0)}°`;
            rim.directionLatitudeValue.textContent = `${formatNumber(rim.directionLatitude.value, 0)}°`;
        });
        elements.fillDirectionLongitudeValue.textContent = `${formatNumber(elements.fillDirectionLongitude.value, 0)}°`;
        elements.fillDirectionLatitudeValue.textContent = `${formatNumber(elements.fillDirectionLatitude.value, 0)}°`;
        elements.keyDirectionLongitudeValue.textContent = `${formatNumber(elements.keyDirectionLongitude.value, 0)}°`;
        elements.keyDirectionLatitudeValue.textContent = `${formatNumber(elements.keyDirectionLatitude.value, 0)}°`;
        elements.physicsFpsValue.textContent = `${elements.physicsFps.value} Hz`;
        elements.rotationPhysicsLimitValue.textContent = `${elements.rotationPhysicsLimit.value}°/秒`;
        elements.pmxAoIntensityValue.textContent = formatNumber(elements.pmxAoIntensity.value);
        elements.pmxAoRadiusPercentValue.textContent = `${elements.pmxAoRadiusPercent.value}%`;
        elements.pmxAoBlurRadii.forEach(({ input, output }) => {
            output.textContent = `${input.value} px`;
        });
    }

    function updateForm(lighting) {
        const { elements } = state;
        elements.ambientColor.value = lighting.ambientColor;
        elements.ambientIntensity.value = String(lighting.ambientIntensity);
        elements.keyColor.value = lighting.keyColor;
        if (elements.keyShadowEnabled) elements.keyShadowEnabled.checked = lighting.keyShadowEnabled !== false;
        elements.keyIntensity.value = String(lighting.keyIntensity);
        elements.keyDirectionLongitude.value = String(lighting.keyDirection.longitude);
        elements.keyDirectionLatitude.value = String(lighting.keyDirection.latitude);
        elements.fillEnabled.checked = lighting.fillEnabled === true;
        elements.fillColor.value = lighting.fillColor;
        elements.fillIntensity.value = String(lighting.fillIntensity);
        elements.fillDirectionLongitude.value = String(lighting.fillDirection.longitude);
        elements.fillDirectionLatitude.value = String(lighting.fillDirection.latitude);
        elements.rimLights.forEach((rim, index) => {
            const settings = lighting.rimLights[index];
            rim.enabled.checked = settings.enabled;
            rim.color.value = settings.color;
            rim.intensity.value = String(settings.intensity);
            rim.directionLongitude.value = String(settings.direction.longitude);
            rim.directionLatitude.value = String(settings.direction.latitude);
        });
        elements.shadowSource.value = lighting.shadowSource;
        elements.pmxToonEnabled.checked = lighting.pmxToonEnabled === true;
        elements.pmxAoEnabled.checked = lighting.pmxAoEnabled !== false;
        elements.pmxAoColor.value = lighting.pmxAoColor;
        elements.pmxAoIntensity.value = String(lighting.pmxAoIntensity);
        elements.pmxAoRadiusPercent.value = String(lighting.pmxAoRadiusPercent);
        elements.pmxAoResolution.value = lighting.pmxAoResolution;
        elements.pmxAoSampleCount.value = String(lighting.pmxAoSampleCount);
        elements.pmxAoBlurPassCount.value = String(lighting.pmxAoBlurPassCount);
        elements.pmxAoBlurRadii.forEach(({ field, input }, index) => {
            input.value = String(lighting.pmxAoBlurRadii[index]);
            field.hidden = index >= lighting.pmxAoBlurPassCount;
        });
        elements.physicsFps.value = String(lighting.physicsFps);
        elements.rotationPhysicsLimit.value = String(lighting.rotationPhysicsLimit);
        updateOutputs();
    }

    function readForm() {
        const { elements } = state;
        return {
            ambientColor: elements.ambientColor.value,
            ambientIntensity: elements.ambientIntensity.value,
            keyColor: elements.keyColor.value,
            keyShadowEnabled: elements.keyShadowEnabled?.checked ?? true,
            keyIntensity: elements.keyIntensity.value,
            keyDirection: {
                longitude: elements.keyDirectionLongitude.value,
                latitude: elements.keyDirectionLatitude.value
            },
            fillEnabled: elements.fillEnabled.checked,
            fillColor: elements.fillColor.value,
            fillIntensity: elements.fillIntensity.value,
            fillDirection: {
                longitude: elements.fillDirectionLongitude.value,
                latitude: elements.fillDirectionLatitude.value
            },
            rimLights: elements.rimLights.map((rim) => ({
                enabled: rim.enabled.checked,
                color: rim.color.value,
                intensity: rim.intensity.value,
                direction: { longitude: rim.directionLongitude.value, latitude: rim.directionLatitude.value }
            })),
            shadowSource: elements.shadowSource.value,
            pmxToonEnabled: elements.pmxToonEnabled.checked,
            pmxAoEnabled: elements.pmxAoEnabled.checked,
            pmxAoColor: elements.pmxAoColor.value,
            pmxAoIntensity: elements.pmxAoIntensity.value,
            pmxAoRadiusPercent: elements.pmxAoRadiusPercent.value,
            pmxAoResolution: elements.pmxAoResolution.value,
            pmxAoSampleCount: elements.pmxAoSampleCount.value,
            pmxAoBlurPassCount: elements.pmxAoBlurPassCount.value,
            pmxAoBlurRadii: elements.pmxAoBlurRadii.map(({ input }) => input.value),
            physicsFps: elements.physicsFps.value,
            rotationPhysicsLimit: elements.rotationPhysicsLimit.value
        };
    }

    function saveLighting(lighting) {
        try {
            root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(lighting));
        } catch (error) {
            console.warn('[显示端 MMD] 保存灯光设置失败:', error);
        }
    }

    function readSavedLighting() {
        try {
            const raw = root.localStorage?.getItem(STORAGE_KEY);
            const saved = raw ? JSON.parse(raw) : null;
            if (saved?.keyDirection) return saved;
            if (saved?.keyPosition && typeof saved.keyPosition === 'object') {
                const position = saved.keyPosition;
                const distance = Math.hypot(Number(position.x), Number(position.y), Number(position.z));
                if (Number.isFinite(distance) && distance > 0) {
                    return {
                        ...saved,
                        keyDirection: {
                            longitude: Math.atan2(Number(position.x), Number(position.z)) * 180 / Math.PI,
                            latitude: Math.asin(Number(position.y) / distance) * 180 / Math.PI
                        }
                    };
                }
            }
            return saved;
        } catch (error) {
            console.warn('[显示端 MMD] 读取灯光设置失败:', error);
            return null;
        }
    }

    function applyLighting(input, save = true) {
        if (!root.DisplayMmd?.setLighting) return;
        state.lighting = root.DisplayMmd.setLighting(input);
        updateForm(state.lighting);
        if (save) saveLighting(state.lighting);
    }

    function markCustomPreset() {
        // 命名预设的修改状态由统一面板管理。
    }

    function handleFormInput() {
        markCustomPreset();
        applyLighting(readForm());
    }

    function bindEvents() {
        const { elements } = state;
        elements.toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const nextOpen = elements.panel.hidden;
            if (nextOpen) root.DisplayMmdAr?.closePanel?.();
            setPanelOpen(nextOpen);
        });
        elements.panel.addEventListener('click', (event) => event.stopPropagation());
        elements.reset.addEventListener('click', () => {
            elements.preset.value = 'custom';
            applyLighting({
                ...DEFAULT_LIGHTING,
                physicsFps: DEFAULT_PHYSICS_FPS,
                rotationPhysicsLimit: DEFAULT_ROTATION_PHYSICS_LIMIT
            });
        });

        [
            elements.ambientColor,
            elements.ambientIntensity,
            elements.keyColor,
            elements.keyShadowEnabled,
            elements.keyIntensity,
            elements.keyDirectionLongitude,
            elements.keyDirectionLatitude,
            elements.fillEnabled,
            elements.fillColor,
            elements.fillIntensity,
            elements.fillDirectionLongitude,
            elements.fillDirectionLatitude,
            ...elements.rimLights.flatMap((rim) => [
                rim.enabled, rim.color, rim.intensity, rim.directionLongitude, rim.directionLatitude
            ]),
            elements.pmxToonEnabled,
            elements.pmxAoEnabled,
            elements.pmxAoColor,
            elements.pmxAoIntensity,
            elements.pmxAoRadiusPercent
        ].filter(Boolean).forEach((element) => element.addEventListener('input', handleFormInput));
        elements.pmxAoResolution.addEventListener('change', handleFormInput);
        elements.shadowSource.addEventListener('change', handleFormInput);
        elements.pmxAoSampleCount.addEventListener('change', handleFormInput);
        elements.pmxAoBlurPassCount.addEventListener('change', handleFormInput);
        elements.pmxAoBlurRadii.forEach(({ input }) => input.addEventListener('input', handleFormInput));
        elements.physicsFps.addEventListener('input', () => applyLighting(readForm()));
        elements.rotationPhysicsLimit.addEventListener('input', () => applyLighting(readForm()));
        document.addEventListener('click', () => setPanelOpen(false));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setPanelOpen(false);
        });
    }

    function initialize() {
        if (state.initialized || !root.DisplayMmd?.setLighting) return;
        state.elements = getElements();
        if (Object.values(state.elements).flatMap((value) => (
            Array.isArray(value) ? value.flatMap((group) => Object.values(group)) : [value]
        )).some((element) => !element)) return;
        state.initialized = true;
        const saved = readSavedLighting();
        state.lighting = root.DisplayMmd.setLighting(saved || DEFAULT_LIGHTING);
        updateForm(state.lighting);
        observeRenderResolution();
        state.elements.preset.value = 'custom';
        const stripPhysics = value => {
            const { physicsFps, rotationPhysicsLimit, shadowEnabled, webFillShadowMode, ...lighting } = value;
            return lighting;
        };
        root.DisplayMmdLightingPresetGroups.lighting = {
            normalize: value => stripPhysics(root.DisplayMmd.normalizeLightingPreset(value)),
            read: () => stripPhysics(root.DisplayMmd.getLighting()),
            apply: value => applyLighting(value)
        };
        bindEvents();
    }

    root.DisplayMmdLighting = Object.freeze({
        close: () => setPanelOpen(false),
        initialize,
        apply: value => applyLighting({ ...root.DisplayMmd.getLighting(), ...value })
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
}(window));

/* aasc-shared:addPhysicsRateLighting */

/* aasc-shared:lighting-presets */
