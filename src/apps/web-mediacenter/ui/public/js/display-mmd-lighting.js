/*
 * 显示端 MMD/VRM 灯光面板。
 *
 * 面板只修改当前浏览器显示端的 AmbientLight、DirectionalLight 和阴影状态，
 * 设置保存到 localStorage，避免把灯光调试参数混入 WebSocket 或 Offline APK 配置。
 */
(function exposeDisplayMmdLighting(root) {
    const STORAGE_KEY = 'aasc.display.mmdLighting.v1';
    const PRESETS = Object.freeze({
        default: Object.freeze({
            ambientColor: '#ffffff',
            ambientIntensity: 1.8,
            keyColor: '#ffffff',
            keyIntensity: 2.3,
            keyPosition: Object.freeze({ x: 1.5, y: 3, z: 2.5 }),
            shadowEnabled: true
        }),
        soft: Object.freeze({
            ambientColor: '#ffffff',
            ambientIntensity: 1.45,
            keyColor: '#fff4df',
            keyIntensity: 1.65,
            keyPosition: Object.freeze({ x: 1.2, y: 2.6, z: 2.2 })
        }),
        bright: Object.freeze({
            ambientColor: '#ffffff',
            ambientIntensity: 2.35,
            keyColor: '#ffffff',
            keyIntensity: 3.35,
            keyPosition: Object.freeze({ x: 1.8, y: 4.2, z: 3.2 })
        })
    });

    const state = {
        initialized: false,
        elements: null,
        lighting: null
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function getElements() {
        return {
            toggle: byId('displayMmdLightingToggle'),
            panel: byId('displayMmdLightingPanel'),
            reset: byId('displayMmdLightingReset'),
            preset: byId('displayMmdLightingPreset'),
            shadowEnabled: byId('displayMmdShadowEnabled'),
            ambientColor: byId('displayMmdAmbientColor'),
            ambientIntensity: byId('displayMmdAmbientIntensity'),
            ambientIntensityValue: byId('displayMmdAmbientIntensityValue'),
            keyColor: byId('displayMmdKeyColor'),
            keyIntensity: byId('displayMmdKeyIntensity'),
            keyIntensityValue: byId('displayMmdKeyIntensityValue'),
            keyPositionX: byId('displayMmdKeyPositionX'),
            keyPositionXValue: byId('displayMmdKeyPositionXValue'),
            keyPositionY: byId('displayMmdKeyPositionY'),
            keyPositionYValue: byId('displayMmdKeyPositionYValue'),
            keyPositionZ: byId('displayMmdKeyPositionZ'),
            keyPositionZValue: byId('displayMmdKeyPositionZValue')
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
        elements.keyPositionXValue.textContent = formatNumber(elements.keyPositionX.value, 1);
        elements.keyPositionYValue.textContent = formatNumber(elements.keyPositionY.value, 1);
        elements.keyPositionZValue.textContent = formatNumber(elements.keyPositionZ.value, 1);
    }

    function updateForm(lighting) {
        const { elements } = state;
        elements.ambientColor.value = lighting.ambientColor;
        elements.ambientIntensity.value = String(lighting.ambientIntensity);
        elements.keyColor.value = lighting.keyColor;
        elements.keyIntensity.value = String(lighting.keyIntensity);
        elements.keyPositionX.value = String(lighting.keyPosition.x);
        elements.keyPositionY.value = String(lighting.keyPosition.y);
        elements.keyPositionZ.value = String(lighting.keyPosition.z);
        elements.shadowEnabled.checked = lighting.shadowEnabled !== false;
        updateOutputs();
    }

    function readForm() {
        const { elements } = state;
        return {
            ambientColor: elements.ambientColor.value,
            ambientIntensity: elements.ambientIntensity.value,
            keyColor: elements.keyColor.value,
            keyIntensity: elements.keyIntensity.value,
            keyPosition: {
                x: elements.keyPositionX.value,
                y: elements.keyPositionY.value,
                z: elements.keyPositionZ.value
            },
            shadowEnabled: elements.shadowEnabled.checked
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
            return raw ? JSON.parse(raw) : null;
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
            setPanelOpen(elements.panel.hidden);
        });
        elements.panel.addEventListener('click', (event) => event.stopPropagation());
        elements.reset.addEventListener('click', () => {
            elements.preset.value = 'default';
            applyLighting(PRESETS.default);
        });
        elements.preset.addEventListener('change', handlePresetChange);
        [
            elements.ambientColor,
            elements.ambientIntensity,
            elements.keyColor,
            elements.keyIntensity,
            elements.keyPositionX,
            elements.keyPositionY,
            elements.keyPositionZ,
            elements.shadowEnabled
        ].forEach((element) => element.addEventListener('input', handleFormInput));
        document.addEventListener('click', () => setPanelOpen(false));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setPanelOpen(false);
        });
    }

    function initialize() {
        if (state.initialized || !root.DisplayMmd?.setLighting) return;
        state.elements = getElements();
        if (Object.values(state.elements).some((element) => !element)) return;
        state.initialized = true;
        const saved = readSavedLighting();
        state.lighting = root.DisplayMmd.setLighting(saved || PRESETS.default);
        updateForm(state.lighting);
        state.elements.preset.value = saved ? 'custom' : 'default';
        bindEvents();
    }

    root.DisplayMmdLighting = Object.freeze({ initialize });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
}(window));
