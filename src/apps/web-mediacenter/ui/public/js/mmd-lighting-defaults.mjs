import { format, version, groupNames, maxFileBytes, normalizeSettings } from './mmd-lighting-preset-library.mjs';

// 各组沿用既有存储键；只判断当前设置，不把命名预设库作为首次默认的覆盖来源。
export const settingStorageKeys = Object.freeze({
    lighting: 'aasc.display.mmdLighting.v1', specular: 'aasc.display.mmdSpecular.v1',
    keyShadowBias: 'aasc.display.mmd.keyShadowBias.v1', shadowMap: 'aasc.display.mmd.shadowMap.v1',
    fillFacing: 'aasc.display.mmd.fillFacingRange.v1', aoConcavity: 'aasc.display.mmd.aoConcavityAngle.v1',
    aoPreview: 'aasc.display.mmd.aoNormalPreview.v1', aoEdgeCorrection: 'aasc.display.mmdAoEdgeCorrection.v1',
    screenLighting: 'aasc.display.mmd.screenLighting.v1', render: 'aasc.display.mmd.render.v1'
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseDefaultPresetFile(text) {
    if (new TextEncoder().encode(text).byteLength > maxFileBytes) throw new Error('默认灯光文件超过256 KiB');
    const file = JSON.parse(text);
    if (file?.format !== format || file.version !== version || !Array.isArray(file.presets) || file.presets.length !== 1) {
        throw new Error('默认灯光文件需要有效格式、版本及唯一预设');
    }
    const record = file.presets[0];
    if (!record?.name?.trim() || !object(record.settings) || groupNames.some(key => !object(record.settings[key]))) {
        throw new Error('默认灯光文件缺少名称或完整十组设置');
    }
    return record;
}

export function hasSavedSettings(key, groups, storage) {
    try {
        const raw = storage().getItem(settingStorageKeys[key]);
        if (raw === null || raw === undefined || raw.trim() === '') return false;
        const saved = JSON.parse(raw);
        // 这两组历史存储使用标量，其余组均保存对象。
        const scalarChecks = {
            aoConcavity: value => typeof value === 'number' && Number.isFinite(value),
            aoEdgeCorrection: value => typeof value === 'boolean'
        };
        if (scalarChecks[key]) return scalarChecks[key](saved);
        if (!object(saved)) return false;
        const fields = Object.keys(groups[key].normalize({}));
        if (!fields.some(field => Object.hasOwn(saved, field))) {
            // 兼容旧灯光位置形式，转换由原灯光初始化完成。
            return key === 'lighting' && object(saved.keyPosition)
                && ['x', 'y', 'z'].every(axis => Number.isFinite(saved.keyPosition[axis]));
        }
        normalizeSettings({ [key]: saved }, groups);
        return true;
    } catch (error) { return false; }
}

export function applyLightingDefaults(record, groups, { onlyUnsaved = false, storage = () => localStorage } = {}) {
    // 全部设置先纯校验，再应用；已保存的分组保持既有初始化结果。
    const settings = normalizeSettings(record.settings, groups);
    const applyKeys = groupNames.filter(key => !onlyUnsaved || !hasSavedSettings(key, groups, storage));
    for (const key of applyKeys) groups[key].apply(settings[key]);
    return applyKeys;
}
