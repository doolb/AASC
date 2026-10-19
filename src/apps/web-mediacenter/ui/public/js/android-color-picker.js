'use strict';

// Android WebView 使用页面内色板；业务仍监听原来的 input[type=color] 元素。
(function createAndroidColorPicker(root, documentObject) {
    const state = { initialized: false, active: null, original: '', color: '', hue: 0, saturation: 0, value: 1,
        pointerId: null, triggers: new Map(), overlay: null, refs: {} };
    const isAndroid = () => /Android/iu.test(root.navigator?.userAgent || '');
    const clamp = (number, minimum, maximum) => Math.min(maximum, Math.max(minimum, number));
    const normalizeHex = value => {
        const raw = String(value || '').trim().replace(/^#/u, '');
        return /^[0-9a-f]{6}$/iu.test(raw) ? `#${raw.toUpperCase()}` : null;
    };

    function hexToHsv(hex) {
        const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
        const maximum = Math.max(...channels);
        const minimum = Math.min(...channels);
        const difference = maximum - minimum;
        let hue = 0;
        if (difference > 0) {
            const [red, green, blue] = channels;
            if (maximum === red) hue = ((green - blue) / difference) % 6;
            else if (maximum === green) hue = (blue - red) / difference + 2;
            else hue = (red - green) / difference + 4;
            hue = (hue * 60 + 360) % 360;
        }
        return { hue, saturation: maximum === 0 ? 0 : difference / maximum, value: maximum };
    }

    function hsvToHex(hue, saturation, value) {
        const chroma = value * saturation;
        const segment = ((hue % 360) + 360) % 360 / 60;
        const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
        const sectors = [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
            [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]];
        const offset = value - chroma;
        const rgb = sectors[Math.floor(segment)].map(channel => Math.round((channel + offset) * 255));
        return `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }

    function sync(input) {
        const trigger = state.triggers.get(input);
        const color = normalizeHex(input?.value);
        if (trigger && color) trigger.style.setProperty('--android-color-value', color);
    }

    function render() {
        const { square, hue, hex, preview, confirm, error } = state.refs;
        square.style.setProperty('--android-color-hue', String(state.hue));
        square.style.setProperty('--android-color-saturation', `${state.saturation * 100}%`);
        square.style.setProperty('--android-color-value-position', `${(1 - state.value) * 100}%`);
        square.setAttribute('aria-valuenow', String(Math.round(state.saturation * 100)));
        square.setAttribute('aria-valuetext', state.color);
        hue.value = String(Math.round(state.hue));
        hex.value = state.color;
        hex.setAttribute('aria-invalid', 'false');
        preview.style.setProperty('--android-color-value', state.color);
        confirm.disabled = false;
        error.textContent = '';
        sync(state.active);
    }

    function setColor(color, updateHsv = true) {
        if (!state.active) return;
        if (updateHsv) Object.assign(state, hexToHsv(color));
        state.color = color;
        if (normalizeHex(state.active.value) !== color) {
            state.active.value = color;
            state.active.dispatchEvent(new root.Event('input', { bubbles: true }));
        }
        render();
    }

    function close(commit) {
        if (!state.active) return;
        const input = state.active;
        const trigger = state.triggers.get(input);
        if (commit && state.color !== state.original) {
            input.dispatchEvent(new root.Event('change', { bubbles: true }));
        } else if (!commit && normalizeHex(input.value) !== state.original) {
            input.value = state.original;
            input.dispatchEvent(new root.Event('input', { bubbles: true }));
        }
        sync(input);
        state.active = null;
        state.pointerId = null;
        state.overlay.hidden = true;
        trigger?.focus();
    }

    function open(input) {
        if (state.active) close(false);
        const color = normalizeHex(input.value) || '#FFFFFF';
        state.active = input;
        state.original = color;
        state.color = color;
        Object.assign(state, hexToHsv(color));
        render();
        state.overlay.hidden = false;
        state.refs.square.focus();
    }

    function pickSquare(event) {
        if (!state.active) return;
        const rect = state.refs.square.getBoundingClientRect();
        state.saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        state.value = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
        setColor(hsvToHex(state.hue, state.saturation, state.value), false);
    }

    function createOverlay() {
        const overlay = documentObject.createElement('div');
        overlay.className = 'android-color-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `<section class="android-color-dialog" role="dialog" aria-modal="true" aria-labelledby="androidColorTitle">
            <h2 id="androidColorTitle" class="android-color-title">选择颜色</h2>
            <div class="android-color-square" role="slider" tabindex="0" aria-label="颜色饱和度和亮度"
                aria-valuemin="0" aria-valuemax="100"><span class="android-color-cursor"></span></div>
            <input class="android-color-hue" type="range" min="0" max="360" step="1" aria-label="色相">
            <div class="android-color-fields"><span class="android-color-preview" aria-hidden="true"></span>
                <label class="android-color-hex-label"><span>HEX</span><input class="android-color-hex"
                    type="text" inputmode="text" maxlength="7" autocomplete="off" spellcheck="false"></label></div>
            <p class="android-color-error" role="status"></p>
            <div class="android-color-actions"><button class="android-color-cancel" type="button">取消</button>
                <button class="android-color-confirm" type="button">确定</button></div>
        </section>`;
        documentObject.body.appendChild(overlay);
        state.overlay = overlay;
        for (const name of ['square', 'hue', 'hex', 'preview', 'confirm', 'cancel', 'error']) {
            state.refs[name] = overlay.querySelector(`.android-color-${name}`);
        }
        overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
        state.refs.cancel.addEventListener('click', () => close(false));
        state.refs.confirm.addEventListener('click', () => {
            if (!state.refs.confirm.disabled) close(true);
        });
        documentObject.addEventListener('keydown', event => {
            if (state.active && event.key === 'Escape') {
                event.preventDefault();
                close(false);
            }
        });
        state.refs.square.addEventListener('pointerdown', event => {
            event.preventDefault();
            state.pointerId = event.pointerId;
            state.refs.square.setPointerCapture?.(event.pointerId);
            pickSquare(event);
        });
        state.refs.square.addEventListener('pointermove', event => {
            if (state.pointerId === event.pointerId) pickSquare(event);
        });
        for (const type of ['pointerup', 'pointercancel']) {
            state.refs.square.addEventListener(type, event => {
                if (state.pointerId === event.pointerId) state.pointerId = null;
            });
        }
        state.refs.square.addEventListener('keydown', event => {
            const step = event.shiftKey ? 0.1 : 0.01;
            const adjustments = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                ArrowUp: [0, step], ArrowDown: [0, -step] };
            if (!adjustments[event.key]) return;
            event.preventDefault();
            const [saturationDelta, valueDelta] = adjustments[event.key];
            state.saturation = clamp(state.saturation + saturationDelta, 0, 1);
            state.value = clamp(state.value + valueDelta, 0, 1);
            setColor(hsvToHex(state.hue, state.saturation, state.value), false);
        });
        state.refs.hue.addEventListener('input', () => {
            state.hue = Number(state.refs.hue.value);
            setColor(hsvToHex(state.hue, state.saturation, state.value), false);
        });
        state.refs.hex.addEventListener('input', () => {
            const color = normalizeHex(state.refs.hex.value);
            state.refs.hex.setAttribute('aria-invalid', String(!color));
            state.refs.confirm.disabled = !color;
            state.refs.error.textContent = color ? '' : '请输入 6 位 HEX 颜色';
            if (color) setColor(color);
        });
    }

    function init() {
        if (state.initialized || !isAndroid()) return;
        state.initialized = true;
        const inputs = [...documentObject.querySelectorAll('input[type="color"]')];
        if (inputs.length === 0) return;
        createOverlay();
        for (const input of inputs) {
            // 保留原元素及其业务监听器，避免改变光晕/MMD 的预览与保存流程。
            input.type = 'hidden';
            const trigger = documentObject.createElement('button');
            trigger.type = 'button';
            trigger.className = 'android-color-trigger';
            trigger.innerHTML = '<span class="android-color-trigger-swatch"></span>';
            trigger.setAttribute('aria-label', `${input.getAttribute('aria-label') || '颜色'}，打开选色器`);
            input.insertAdjacentElement('afterend', trigger);
            state.triggers.set(input, trigger);
            sync(input);
            // 权威配置会直接写 input.value，监听属性赋值以即时刷新 Android 色块。
            const valueDescriptor = Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'value');
            if (valueDescriptor?.get && valueDescriptor?.set) {
                Object.defineProperty(input, 'value', {
                    configurable: true,
                    get() { return valueDescriptor.get.call(this); },
                    set(value) {
                        valueDescriptor.set.call(this, value);
                        sync(this);
                    }
                });
            }
            trigger.addEventListener('click', () => open(input));
            input.addEventListener('input', () => sync(input));
            input.addEventListener('change', () => sync(input));
            const label = input.closest('label') || [...documentObject.querySelectorAll('label[for]')]
                .find(candidate => candidate.htmlFor === input.id);
            label?.addEventListener('click', event => {
                if (trigger.contains(event.target)) return;
                event.preventDefault();
                open(input);
            });
        }
    }

    root.AndroidColorPicker = { init, sync };
    if (documentObject.readyState === 'loading') documentObject.addEventListener('DOMContentLoaded', init);
    else init();
})(window, document);
