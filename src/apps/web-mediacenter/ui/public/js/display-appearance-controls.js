'use strict';

// 显示端外观面板只发送用户操作；主题和字幕背景的持久化值以服务端回传为准。
(function createDisplayAppearanceControls(root) {
    const state = { theme: 'dark', opacity: 0.2, initialized: false, themePending: false, opacityPending: false };
    const refs = {};

    function setStatus(message) {
        if (refs.status) refs.status.textContent = message || '';
    }

    function syncTheme(theme) {
        const normalized = root.UiTheme?.normalize(theme) || 'dark';
        state.theme = normalized;
        if (refs.theme) refs.theme.value = normalized;
    }

    function syncOpacity(opacity) {
        const value = Number(opacity);
        if (!Number.isFinite(value) || value < 0 || value > 1) return;
        state.opacity = Math.round(value * 100) / 100;
        const percent = Math.round(state.opacity * 100);
        if (refs.opacity) refs.opacity.value = String(percent);
        if (refs.opacityValue) refs.opacityValue.textContent = `${percent}%`;
        root.document.documentElement.style.setProperty('--tts-subtitle-background-opacity', String(state.opacity));
    }

    function send(message) {
        return root.DisplayStage?.send(message) === true;
    }

    function setOpen(open) {
        if (!refs.panel || !refs.toggle) return;
        if (open) {
            const group = refs.toggle.parentElement;
            group?.querySelectorAll(':scope > section:not([hidden])').forEach((panel) => {
                if (panel !== refs.panel) panel.hidden = true;
            });
            group?.querySelectorAll(':scope > button[aria-expanded="true"]').forEach((button) => {
                if (button !== refs.toggle) button.setAttribute('aria-expanded', 'false');
            });
        }
        refs.panel.hidden = !open;
        refs.toggle.setAttribute('aria-expanded', String(open));
    }

    function init() {
        if (state.initialized) return;
        refs.toggle = root.document.getElementById('displayAppearanceToggle');
        refs.panel = root.document.getElementById('displayAppearancePanel');
        refs.theme = root.document.getElementById('displayAppearanceTheme');
        refs.opacity = root.document.getElementById('displayAppearanceTtsOpacity');
        refs.opacityValue = root.document.getElementById('displayAppearanceTtsOpacityValue');
        refs.status = root.document.getElementById('displayAppearanceStatus');
        if (!refs.toggle || !refs.panel || !refs.theme || !refs.opacity) return;
        state.initialized = true;
        syncTheme(root.document.documentElement.dataset.theme || 'dark');
        syncOpacity(0.2);
        // 初次读取主题可能晚于面板建立；读取完成后以页面实际生效的主题回显。
        Promise.resolve(root.UiTheme?.ready).then(() => {
            syncTheme(root.document.documentElement.dataset.theme || 'dark');
        }).catch(() => {});

        refs.toggle.addEventListener('click', () => setOpen(refs.panel.hidden));
        refs.theme.addEventListener('change', () => {
            const theme = refs.theme.value;
            if (!root.UiTheme?.themes.includes(theme) || !send({ type: 'setControlThemeConfig', theme })) {
                syncTheme(state.theme);
                setStatus('主题保存失败，请检查连接');
                return;
            }
            state.themePending = true;
            setStatus('正在保存主题…');
        });
        refs.opacity.addEventListener('input', () => {
            const percent = Number(refs.opacity.value);
            if (!Number.isInteger(percent) || percent < 0 || percent > 100) return;
            refs.opacityValue.textContent = `${percent}%`;
            root.document.documentElement.style.setProperty('--tts-subtitle-background-opacity', String(percent / 100));
        });
        refs.opacity.addEventListener('change', () => {
            const percent = Number(refs.opacity.value);
            if (!Number.isInteger(percent) || percent < 0 || percent > 100
                || !send({ type: 'setDisplayTtsBackgroundOpacityConfig', opacity: percent / 100 })) {
                syncOpacity(state.opacity);
                setStatus('透明度保存失败，请检查连接');
                return;
            }
            state.opacityPending = true;
            setStatus('正在保存透明度…');
        });
        root.document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setOpen(false);
        });
        root.document.addEventListener('pointerdown', (event) => {
            if (!refs.panel.hidden && !refs.panel.contains(event.target)
                && !refs.toggle.contains(event.target)) setOpen(false);
        });
    }

    function handleTheme(theme) {
        syncTheme(theme);
        state.themePending = false;
        setStatus('');
    }

    function handleThemeError(data) {
        syncTheme(data?.theme);
        state.themePending = false;
        setStatus(data?.message || '主题保存失败');
    }

    function handleOpacity(opacity) {
        syncOpacity(opacity);
        state.opacityPending = false;
        setStatus('');
    }

    function handleOpacityError(data) {
        syncOpacity(data?.opacity);
        state.opacityPending = false;
        setStatus(data?.message || '透明度保存失败');
    }

    function handleDisconnected() {
        root.DisplayBackgroundGlow?.handleDisconnected();
        const hadPendingSave = state.themePending || state.opacityPending;
        state.themePending = false;
        state.opacityPending = false;
        syncTheme(state.theme);
        syncOpacity(state.opacity);
        if (hadPendingSave) setStatus('连接已断开，设置未保存');
    }

    root.DisplayAppearanceControls = {
        init, handleTheme, handleThemeError, handleOpacity, handleOpacityError, handleDisconnected
    };
    // 显示页内联脚本先于 defer 模块运行；等全部 DOM 就绪再绑定左下角面板。
    if (root.document.readyState === 'loading' || root.document.readyState === 'interactive') {
        root.document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}(window));
