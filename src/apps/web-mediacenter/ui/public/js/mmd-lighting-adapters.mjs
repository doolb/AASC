import { initSpecularPanel, normalizeSpecular, getSpecular, applySpecular } from './display-pmx-specular.mjs';

// 预设只调用正式灯光状态入口；高光和AO边界仍使用各自的历史存储键，避免两套权威状态。
export function registerLightingAdapters(root = window) {
    const groups = root.DisplayMmdLightingPresetGroups ||= Object.create(null);
    initSpecularPanel();
    groups.specular = { normalize: normalizeSpecular, read: getSpecular, apply: applySpecular };
    groups.aoEdgeCorrection = { normalize: value => ({ enabled: value?.enabled !== false }),
        read: () => ({ enabled: root.DisplayMmdAoEdgeCorrection !== false }),
        apply(value) {
            const input = document.getElementById('displayMmdPmxAoEdgeCorrection');
            if (input) { input.checked = value.enabled !== false; input.dispatchEvent(new Event('change', { bubbles: true })); }
        } };
    // 十组预设保持可互导的格式，正式端没有法线诊断入口，导入时固定关闭。
    groups.aoPreview = { normalize: () => ({ enabled: false }), read: () => ({ enabled: false }), apply() {} };
}
