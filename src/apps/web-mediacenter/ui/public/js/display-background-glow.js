'use strict';

// 控制端和显示端共用背景光晕的预览、权威回显及保存流程。
(function createDisplayBackgroundGlow(windowObject, documentObject) {
    const DEFAULT_CONFIG = Object.freeze({ color: '#8FA8D5', centerRange: 10, spread: 58 });
    const MIDDLE_BASE_COLOR = '#20232E';
    const MIDDLE_BASE_RATIO = 0.45;

    const isHexColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    const normalizeColor = (value, fallback) => (
        isHexColor(value) ? value.toUpperCase() : isHexColor(fallback) ? fallback.toUpperCase() : DEFAULT_CONFIG.color
    );
    const normalizeValue = (value, fallback, minimum, maximum) => {
        const number = Number.isFinite(value) ? value : fallback;
        return Math.min(maximum, Math.max(minimum, Math.round(number)));
    };

    const normalizeConfig = (config, fallback = DEFAULT_CONFIG) => {
        const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
        const safeFallback = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
            ? fallback
            : DEFAULT_CONFIG;
        return {
            color: normalizeColor(source.color, safeFallback.color),
            centerRange: normalizeValue(source.centerRange, safeFallback.centerRange, 0, 20),
            spread: normalizeValue(source.spread, safeFallback.spread, 25, 90)
        };
    };

    const mixColors = (foreground, background, backgroundRatio) => {
        const foregroundChannels = foreground.slice(1).match(/.{2}/gu).map(channel => Number.parseInt(channel, 16));
        const backgroundChannels = background.slice(1).match(/.{2}/gu).map(channel => Number.parseInt(channel, 16));
        const channels = foregroundChannels.map((value, index) => (
            Math.round(value * (1 - backgroundRatio) + backgroundChannels[index] * backgroundRatio)
        ));
        return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    };

    const DisplayBackgroundGlow = {
        currentConfig: { ...DEFAULT_CONFIG },
        authoritativeConfig: { ...DEFAULT_CONFIG },
        colorInput: null,
        colorOutput: null,
        centerRangeInput: null,
        centerRangeOutput: null,
        spreadInput: null,
        spreadOutput: null,
        statusOutput: null,
        isDisplayControl: false,
        initialized: false,
        pending: false,

        init() {
            if (this.initialized) return this;
            this.isDisplayControl = Boolean(documentObject.getElementById('displayAppearanceGlowColor'));
            const prefix = this.isDisplayControl ? 'displayAppearanceGlow' : 'displayBackgroundGlow';
            this.colorInput = documentObject.getElementById(`${prefix}Color`);
            this.colorOutput = documentObject.getElementById(`${prefix}ColorValue`);
            this.centerRangeInput = documentObject.getElementById(`${prefix}CenterRange`);
            this.centerRangeOutput = documentObject.getElementById(`${prefix}CenterRangeValue`);
            this.spreadInput = documentObject.getElementById(`${prefix}Spread`);
            this.spreadOutput = documentObject.getElementById(`${prefix}SpreadValue`);
            this.statusOutput = this.isDisplayControl
                ? documentObject.getElementById('displayAppearanceGlowStatus') : null;
            this.render(this.currentConfig);

            if (this.colorInput && this.centerRangeInput && this.spreadInput) {
                this.initialized = true;
                [this.colorInput, this.centerRangeInput, this.spreadInput].forEach((input) => {
                    input.addEventListener('input', () => this.previewFromInputs());
                    input.addEventListener('change', () => {
                        this.previewFromInputs();
                        this.sendUpdate();
                    });
                });
            }
            return this;
        },

        setStatus(message) {
            if (this.statusOutput) this.statusOutput.textContent = message || '';
        },

        render(config) {
            this.currentConfig = normalizeConfig(config, this.authoritativeConfig);
            const root = documentObject.documentElement;
            if (root?.style) {
                root.style.setProperty('--display-background-glow-center-color', this.currentConfig.color);
                root.style.setProperty('--display-background-glow-center-range', `${this.currentConfig.centerRange}%`);
                root.style.setProperty(
                    '--display-background-glow-middle-color',
                    mixColors(this.currentConfig.color, MIDDLE_BASE_COLOR, MIDDLE_BASE_RATIO)
                );
                root.style.setProperty('--display-background-glow-spread', `${this.currentConfig.spread}%`);
            }
            if (this.colorInput) this.colorInput.value = this.currentConfig.color;
            if (this.colorOutput) this.colorOutput.textContent = this.currentConfig.color;
            if (this.centerRangeInput) this.centerRangeInput.value = String(this.currentConfig.centerRange);
            if (this.centerRangeOutput) this.centerRangeOutput.textContent = `${this.currentConfig.centerRange}%`;
            if (this.spreadInput) this.spreadInput.value = String(this.currentConfig.spread);
            if (this.spreadOutput) this.spreadOutput.textContent = `${this.currentConfig.spread}%`;
        },

        previewFromInputs() {
            if (!this.colorInput || !this.centerRangeInput || !this.spreadInput) return;
            this.render({
                color: this.colorInput.value,
                centerRange: Number(this.centerRangeInput.value),
                spread: Number(this.spreadInput.value)
            });
        },

        handleConfig(data) {
            const config = data?.config || data;
            this.authoritativeConfig = normalizeConfig(config, DEFAULT_CONFIG);
            this.pending = false;
            this.setStatus('');
            this.render(this.authoritativeConfig);
        },

        handleConfigError(data) {
            this.authoritativeConfig = normalizeConfig(data?.config, this.authoritativeConfig);
            this.pending = false;
            this.render(this.authoritativeConfig);
            this.setStatus(data?.message || '背景光晕保存失败');
            if (!this.isDisplayControl && windowObject.showToast) {
                windowObject.showToast(data?.message || '显示端背景设置失败', 'error');
            }
        },

        handleDisconnected() {
            const wasPending = this.pending;
            this.pending = false;
            this.render(this.authoritativeConfig);
            if (wasPending) this.setStatus('连接已断开，光晕设置未保存');
        },

        sendUpdate() {
            const message = { type: 'setDisplayBackgroundGlowConfig', config: this.currentConfig };
            if (this.isDisplayControl) {
                if (windowObject.DisplayStage?.send(message) !== true) {
                    this.render(this.authoritativeConfig);
                    this.setStatus('背景光晕保存失败，请检查连接');
                    return false;
                }
                this.pending = true;
                this.setStatus('正在保存光晕…');
                return true;
            }
            const socket = windowObject.WebSocketManager?.ws;
            if (!socket || socket.readyState !== 1) {
                this.render(this.authoritativeConfig);
                if (windowObject.showToast) windowObject.showToast('背景设置失败：控制端未连接', 'error');
                return false;
            }
            try {
                socket.send(JSON.stringify(message));
                return true;
            } catch (error) {
                this.render(this.authoritativeConfig);
                if (windowObject.showToast) {
                    windowObject.showToast(`背景设置发送失败：${error.message}`, 'error');
                }
                return false;
            }
        }
    };

    windowObject.DisplayBackgroundGlow = DisplayBackgroundGlow;
    documentObject.addEventListener('DOMContentLoaded', () => DisplayBackgroundGlow.init());
}(window, document));
