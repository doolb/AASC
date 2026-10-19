'use strict';

// 右侧设置按钮在各模块自己的点击逻辑之前，统一收起已打开的其他顶层面板。
(function coordinateDisplayStagePanels(root, documentObject) {
    const pairs = Object.freeze([
        ['displayAppearanceToggle', 'displayAppearancePanel', () => root.DisplayAppearanceControls?.close?.()],
        ['displayTtsVoiceToggle', 'displayTtsVoicePanel', () => root.DisplayTtsVoices?.close?.()],
        ['displayMmdLightingToggle', 'displayMmdLightingPanel', () => root.DisplayMmdLighting?.close?.()],
        ['displayMmdMotionToggle', 'displayMmdMotionPanel', () => root.DisplayMmdPanelGroups?.closeMotion?.()],
        ['displayArTargetToggle', 'displayArTargetPanel', () => root.DisplayMmdAr?.closePanel?.()]
    ]);

    function initialize() {
        const group = documentObject.querySelector('.display-stage-lighting-control');
        if (!group) return;
        group.addEventListener('click', event => {
            const selected = event.target.closest?.('button[aria-controls]');
            if (!selected || selected.parentElement !== group) return;
            const current = selected.getAttribute('aria-controls');
            if (!pairs.some(([, panelId]) => panelId === current)) return;
            for (const [buttonId, panelId, close] of pairs) {
                if (panelId === current) continue;
                const panel = documentObject.getElementById(panelId);
                if (!panel || panel.hidden) continue;
                // 优先让面板模块清理内部任务；初始化尚未完成时仍保证可见状态收起。
                close();
                panel.hidden = true;
                documentObject.getElementById(buttonId)?.setAttribute('aria-expanded', 'false');
            }
        }, true);
    }

    if (documentObject.readyState === 'loading') documentObject.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})(window, document);
