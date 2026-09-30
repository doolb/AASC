'use strict';

// 控制端和显示端共用背景光晕参数应用逻辑；只有控制端创建的滑块会提交配置。
(function createDisplayBackgroundGlow(windowObject, documentObject) {
    const DEFAULT_CONFIG = Object.freeze({ brightness: 100, spread: 58 });

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
            brightness: normalizeValue(source.brightness, safeFallback.brightness, 0, 100),
            spread: normalizeValue(source.spread, safeFallback.spread, 25, 90)
        };
    };

    const DisplayBackgroundGlow = {
        currentConfig: { ...DEFAULT_CONFIG },
        authoritativeConfig: { ...DEFAULT_CONFIG },
        brightnessInput: null,
        brightnessOutput: null,
        spreadInput: null,
        spreadOutput: null,

        init() {
            this.brightnessInput = documentObject.getElementById('displayBackgroundGlowBrightness');
            this.brightnessOutput = documentObject.getElementById('displayBackgroundGlowBrightnessValue');
            this.spreadInput = documentObject.getElementById('displayBackgroundGlowSpread');
            this.spreadOutput = documentObject.getElementById('displayBackgroundGlowSpreadValue');
            this.render(this.currentConfig);

            if (this.brightnessInput && this.spreadInput) {
                [this.brightnessInput, this.spreadInput].forEach((input) => {
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
                root.style.setProperty(
                    '--display-background-glow-brightness',
                    String(this.currentConfig.brightness / 100)
                );
                root.style.setProperty(
                    '--display-background-glow-spread',
                    `${this.currentConfig.spread}%`
                );
            }
            if (this.brightnessInput) this.brightnessInput.value = String(this.currentConfig.brightness);
            if (this.brightnessOutput) this.brightnessOutput.textContent = `${this.currentConfig.brightness}%`;
            if (this.spreadInput) this.spreadInput.value = String(this.currentConfig.spread);
            if (this.spreadOutput) this.spreadOutput.textContent = `${this.currentConfig.spread}%`;
        },

        previewFromInputs() {
            if (!this.brightnessInput || !this.spreadInput) return;
            this.render({
                brightness: Number(this.brightnessInput.value),
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
