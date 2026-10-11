import { createPresetLibrary, groupNames, normalizeSettings, maxFileBytes } from './web-lighting-preset-library.mjs';
import defaultPreset from './web-lighting-default-preset.mjs';
import builtinPresets from './web-lighting-builtin-presets.mjs';
import { applyLightingDefaults } from './web-lighting-defaults.mjs';
// 与材质运行时使用相同内容指纹，确保UI读写的是同一个高光模块实例。
import './web-specular.mjs';

export function initLightingPresets() {
    const panel = document.getElementById('mmdArLightingPresets');
    if (!panel || panel.dataset.initialized) return;
    panel.dataset.initialized = 'true';
    const groups = window.MmdArLightingPresetGroups;
    const select = document.getElementById('displayMmdLightingPreset');
    const name = panel.querySelector('[data-preset-name]');
    const message = panel.querySelector('[data-preset-status]');
    const input = panel.querySelector('input[type="file"]');
    const actions = Object.fromEntries([...panel.querySelectorAll('[data-preset-action]')].map(node => [node.dataset.presetAction, node]));
    let library, dirty = false;
    const report = (text, error = false) => { message.textContent = text; message.dataset.error = String(error); };
    try {
        if (groupNames.some(key => !groups?.[key])) throw new Error('灯光设置尚未就绪，请刷新后重试');
        applyLightingDefaults(defaultPreset, groups, { onlyUnsaved: true });
        library = createPresetLibrary({ storage: localStorage, groups });
        library.load();
        library.installBundle('mmd-ar.evening.v1', JSON.stringify(builtinPresets));
    } catch (error) {
        report(error.message, true);
        if (!library) { for (const button of Object.values(actions)) button.disabled = true; return; }
    }
    const capture = () => normalizeSettings(Object.fromEntries(groupNames.map(key => [key, groups[key].read()])), groups);
    const refresh = () => {
        const state = library.state();
        const options = [new Option('当前设置（未保存）', 'custom'), ...state.presets.map(record =>
            new Option(record.name + (record.id === state.selectedId && dirty ? '（已修改）' : ''), record.id))];
        select.replaceChildren(...options);
        select.value = state.selectedId || 'custom';
        actions.overwrite.disabled = actions.delete.disabled = actions.export.disabled = !state.selectedId;
        actions.exportAll.disabled = !state.presets.length;
    };
    const selected = () => library.state().selectedId;
    const run = async (operation) => {
        try { await operation(); } catch (error) { report(error.message, true); refresh(); }
    };
    const download = (text, filename) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = filename; panel.append(link);
        // 下载的程序点击也沿用面板事件边界，避免被页面当作外部点击而关闭面板。
        link.addEventListener('click', event => event.stopPropagation());
        try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    };
    const handlers = {
        save: () => { library.save(name.value, capture()); dirty = false; refresh(); report('灯光预设已保存'); },
        overwrite: () => { library.overwrite(selected(), name.value, capture()); dirty = false; refresh(); report('所选预设已覆盖'); },
        delete: () => { library.remove(selected()); dirty = false; name.value = ''; refresh(); report('预设已删除，当前灯光保持'); },
        import: () => input.click(),
        export: () => { download(library.exportText(selected()), 'mmd-ar-lighting-preset.json'); report('所选预设已导出'); },
        exportAll: () => { download(library.exportText(), 'mmd-ar-lighting-presets.json'); report('全部灯光预设已导出'); }
    };
    for (const [action, button] of Object.entries(actions)) button.addEventListener('click', () => run(handlers[action]));
    select.addEventListener('change', () => run(() => {
        const id = select.value === 'custom' ? '' : select.value;
        const record = library.state().presets.find(item => item.id === id);
        if (!record) { library.select(''); dirty = false; refresh(); return; }
        // 先完成全组纯校验，再使用既有入口应用，避免半套灯光状态。
        const settings = normalizeSettings(record.settings, groups);
        library.select(id);
        for (const key of groupNames) groups[key].apply(settings[key]);
        name.value = record.name; dirty = false; refresh(); report('完整灯光预设已应用');
    }));
    input.addEventListener('change', () => run(async () => {
        try {
            const file = input.files[0];
            if (!file) return;
            if (file.size > maxFileBytes) throw new Error('预设文件不能超过256 KiB');
            const count = library.importText(await file.text());
            refresh(); report(`已导入${count}个预设，选择后应用`);
        } finally { input.value = ''; }
    }));
    const changed = event => {
        if (panel.contains(event.target) || !event.target.matches('input,select')) return;
        dirty = true; refresh(); report('当前灯光已修改，可保存为新预设或覆盖所选');
    };
    const lightingPanel = document.getElementById('displayMmdLightingPanel');
    lightingPanel.addEventListener('input', changed);
    lightingPanel.addEventListener('change', changed);
    document.getElementById('displayMmdLightingReset').addEventListener('click', () => run(() => {
        applyLightingDefaults(defaultPreset, groups);
        library.select(''); dirty = false; refresh(); report(`已恢复${defaultPreset.name}默认灯光，用户预设保留`);
    }));
    const state = library.state();
    const record = state.presets.find(item => item.id === state.selectedId);
    if (record) { name.value = record.name; dirty = JSON.stringify(record.settings) !== JSON.stringify(capture()); }
    refresh();
    if (!message.textContent) report('保存当前完整灯光，或导入JSON预设文件');
}

if (typeof document !== 'undefined') {
    if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', initLightingPresets, { once: true });
    else initLightingPresets();
}
