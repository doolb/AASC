'use strict';

// 控制端和显示端共用背景光晕参数应用逻辑；只有控制端创建的控件会提交配置。
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

        init() {
            this.colorInput = documentObject.getElementById('displayBackgroundGlowColor');
            this.colorOutput = documentObject.getElementById('displayBackgroundGlowColorValue');
            this.centerRangeInput = documentObject.getElementById('displayBackgroundGlowCenterRange');
            this.centerRangeOutput = documentObject.getElementById('displayBackgroundGlowCenterRangeValue');
            this.spreadInput = documentObject.getElementById('displayBackgroundGlowSpread');
            this.spreadOutput = documentObject.getElementById('displayBackgroundGlowSpreadValue');
            this.render(this.currentConfig);

            if (this.colorInput && this.centerRangeInput && this.spreadInput) {
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
            this.render(this.authoritativeConfig);
        },

        handleConfigError(data) {
            this.authoritativeConfig = normalizeConfig(data?.config, this.authoritativeConfig);
            this.render(this.authoritativeConfig);
            if (windowObject.showToast) {
                windowObject.showToast(data?.message || '显示端背景设置失败', 'error');
            }
        },

        sendUpdate() {
            const socket = windowObject.WebSocketManager?.ws;
            if (!socket || socket.readyState !== 1) {
                this.render(this.authoritativeConfig);
                if (windowObject.showToast) windowObject.showToast('背景设置失败：控制端未连接', 'error');
                return false;
            }
            try {
                socket.send(JSON.stringify({
                    type: 'setDisplayBackgroundGlowConfig',
                    config: this.currentConfig
                }));
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
