/*
 * 显示端 MMD/VRM 灯光面板。
 *
 * 面板修改当前浏览器显示端的 AmbientLight、DirectionalLight、阴影、PMX AO 和物理目标频率，
 * 设置保存到 localStorage，避免把显示调试参数混入 WebSocket 或 Offline APK 配置。
 */
(function exposeDisplayMmdLighting(root) {
    const STORAGE_KEY = 'aasc.display.mmdLighting.v1';
    const DEFAULT_PHYSICS_FPS = 65;
    const DEFAULT_ROTATION_PHYSICS_LIMIT = 720;
    const PRESETS = Object.freeze({
        default: Object.freeze({
            ambientColor: '#ffffff',
            ambientIntensity: 1.8,
            keyColor: '#ffffff',
            keyIntensity: 2.3,
            keyDirection: Object.freeze({ longitude: 31, latitude: 46 }),
            fillEnabled: false,
            fillColor: '#ffffff',
            fillIntensity: 1,
            fillDirection: Object.freeze({ longitude: -45, latitude: 25 }),
            rimLights: Object.freeze([
                Object.freeze({ enabled: false, color: '#8acbff', intensity: 1, direction: Object.freeze({ longitude: -130, latitude: 25 }) }),
                Object.freeze({ enabled: false, color: '#ffb6d9', intensity: 1, direction: Object.freeze({ longitude: 130, latitude: 25 }) })
            ]),
            shadowEnabled: true,
            pmxToonEnabled: false,
            pmxAoEnabled: true,
            pmxAoColor: '#931231',
            pmxAoIntensity: 0.6,
            pmxAoRadiusPercent: 6,
            pmxAoResolution: 'half'
        }),
        soft: Object.freeze({
            ambientColor: '#ffffff',
            ambientIntensity: 1.45,
            keyColor: '#fff4df',
            keyIntensity: 1.65,
            keyDirection: Object.freeze({ longitude: 29, latitude: 43 })
        }),
        bright: Object.freeze({
            ambientColor: '#ffffff',
            ambientIntensity: 2.35,
            keyColor: '#ffffff',
            keyIntensity: 3.35,
            keyDirection: Object.freeze({ longitude: 29, latitude: 51 })
        })
    });

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

    function getElements() {
        return {
            toggle: byId('displayMmdLightingToggle'),
            panel: byId('displayMmdLightingPanel'),
            reset: byId('displayMmdLightingReset'),
            preset: byId('displayMmdLightingPreset'),
            shadowEnabled: byId('displayMmdShadowEnabled'),
            pmxToonEnabled: byId('displayMmdPmxToonEnabled'),
            pmxAoEnabled: byId('displayMmdPmxAoEnabled'),
            pmxAoColor: byId('displayMmdPmxAoColor'),
            pmxAoIntensity: byId('displayMmdPmxAoIntensity'),
            pmxAoIntensityValue: byId('displayMmdPmxAoIntensityValue'),
            pmxAoRadiusPercent: byId('displayMmdPmxAoRadiusPercent'),
            pmxAoRadiusPercentValue: byId('displayMmdPmxAoRadiusPercentValue'),
            pmxAoResolution: byId('displayMmdPmxAoResolution'),
            physicsFps: byId('displayMmdPhysicsFps'),
            physicsFpsValue: byId('displayMmdPhysicsFpsValue'),
            rotationPhysicsLimit: byId('displayMmdRotationPhysicsLimit'),
            rotationPhysicsLimitValue: byId('displayMmdRotationPhysicsLimitValue'),
            ambientColor: byId('displayMmdAmbientColor'),
            ambientIntensity: byId('displayMmdAmbientIntensity'),
            ambientIntensityValue: byId('displayMmdAmbientIntensityValue'),
            keyColor: byId('displayMmdKeyColor'),
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
    }

    function updateForm(lighting) {
        const { elements } = state;
        elements.ambientColor.value = lighting.ambientColor;
        elements.ambientIntensity.value = String(lighting.ambientIntensity);
        elements.keyColor.value = lighting.keyColor;
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
        elements.shadowEnabled.checked = lighting.shadowEnabled !== false;
        elements.pmxToonEnabled.checked = lighting.pmxToonEnabled === true;
        elements.pmxAoEnabled.checked = lighting.pmxAoEnabled !== false;
        elements.pmxAoColor.value = lighting.pmxAoColor;
        elements.pmxAoIntensity.value = String(lighting.pmxAoIntensity);
        elements.pmxAoRadiusPercent.value = String(lighting.pmxAoRadiusPercent);
        elements.pmxAoResolution.value = lighting.pmxAoResolution;
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
            shadowEnabled: elements.shadowEnabled.checked,
            pmxToonEnabled: elements.pmxToonEnabled.checked,
            pmxAoEnabled: elements.pmxAoEnabled.checked,
            pmxAoColor: elements.pmxAoColor.value,
            pmxAoIntensity: elements.pmxAoIntensity.value,
            pmxAoRadiusPercent: elements.pmxAoRadiusPercent.value,
            pmxAoResolution: elements.pmxAoResolution.value,
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

    function handlePresetChange() {
        const preset = state.elements.preset.value;
        if (preset === 'custom') return;
        applyLighting(PRESETS[preset] || PRESETS.default);
    }

    function markCustomPreset() {
        state.elements.preset.value = 'custom';
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
            elements.preset.value = 'default';
            applyLighting({
                ...PRESETS.default,
                physicsFps: DEFAULT_PHYSICS_FPS,
                rotationPhysicsLimit: DEFAULT_ROTATION_PHYSICS_LIMIT
            });
        });
        elements.preset.addEventListener('change', handlePresetChange);
        [
            elements.ambientColor,
            elements.ambientIntensity,
            elements.keyColor,
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
            elements.shadowEnabled,
            elements.pmxToonEnabled,
            elements.pmxAoEnabled,
            elements.pmxAoColor,
            elements.pmxAoIntensity,
            elements.pmxAoRadiusPercent
        ].forEach((element) => element.addEventListener('input', handleFormInput));
        elements.pmxAoResolution.addEventListener('change', handleFormInput);
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
        state.lighting = root.DisplayMmd.setLighting(saved || PRESETS.default);
        updateForm(state.lighting);
        observeRenderResolution();
        state.elements.preset.value = saved ? 'custom' : 'default';
        bindEvents();
    }

    root.DisplayMmdLighting = Object.freeze({
        close: () => setPanelOpen(false),
        initialize
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
}(window));
