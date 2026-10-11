// 统一灯光预设数据层：只处理显式分组，不读取或导出浏览器其他配置。
export const format = 'aasc.mmd-ar.lighting-presets';
export const version = 1;
export const storageKey = 'aasc.mmdArTest.lightingPresets.v1';
export const maxFileBytes = 256 * 1024;
export const maxPresets = 100;
export const groupNames = Object.freeze(['lighting', 'specular', 'keyShadowBias', 'shadowMap',
    'fillFacing', 'aoConcavity', 'aoPreview', 'aoEdgeCorrection', 'screenLighting', 'render']);
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createPresetId(random = globalThis.crypto) {
    // 局域网HTTP没有randomUUID，但仍可使用getRandomValues；不依赖HTTPS才能保存。
    if (typeof random?.randomUUID === 'function') return random.randomUUID();
    const bytes = random?.getRandomValues?.(new Uint8Array(16));
    if (bytes) return 'light-' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `light-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeName(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) throw new Error('预设名称需为1至64个字符');
    return value.trim();
}

// 按各组默认值结构检查已知字段；未知字段不参与应用，缺少字段交给原规范化入口补默认。
function checkTypes(input, defaults, path) {
    if (input === undefined) return;
    if (Array.isArray(defaults)) {
        if (!Array.isArray(input) || input.length > defaults.length) throw new Error(`${path}数组格式无效`);
        input.forEach((value, index) => checkTypes(value, defaults[index], `${path}[${index}]`));
        return;
    }
    if (object(defaults)) {
        if (!object(input)) throw new Error(`${path}设置格式无效`);
        for (const key of Object.keys(defaults)) checkTypes(input[key], defaults[key], `${path}.${key}`);
        return;
    }
    if (typeof input !== typeof defaults || (typeof input === 'number' && !Number.isFinite(input))) {
        throw new Error(`${path}字段类型无效`);
    }
}

export function normalizeSettings(input, groups) {
    if (!object(input)) throw new Error('灯光设置格式无效');
    return Object.fromEntries(groupNames.map(name => {
        const adapter = groups[name];
        if (!adapter) throw new Error(`灯光分组尚未就绪：${name}`);
        const defaults = adapter.normalize({});
        checkTypes(input[name], defaults, name);
        return [name, clone(adapter.normalize(input[name] || {}))];
    }));
}

export function parsePresetFile(text, groups) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > maxFileBytes) throw new Error('预设文件不能超过256 KiB');
    let value;
    try { value = JSON.parse(text); } catch (error) { throw new Error('预设文件不是有效JSON'); }
    if (!object(value) || value.format !== format || value.version !== version) throw new Error('预设文件格式或版本不支持');
    if (!Array.isArray(value.presets) || value.presets.length > maxPresets) throw new Error('预设列表无效或超过100项');
    // 整个文件先完成纯校验，避免后一条失败时已有记录被写入或应用。
    return value.presets.map(record => {
        if (!object(record)) throw new Error('预设记录格式无效');
        return { id: typeof record.id === 'string' && record.id.length <= 128 ? record.id : '',
            name: normalizeName(record.name), settings: normalizeSettings(record.settings, groups) };
    });
}

export function createPresetLibrary({ storage, groups, createId = createPresetId }) {
    let presets = [];
    let selectedId = '';
    const state = () => ({ presets: clone(presets), selectedId });
    const commit = (next, selected = selectedId) => {
        if (next.length > maxPresets) throw new Error('最多保存100个灯光预设');
        const record = { format, version, presets: next, selectedId: selected };
        const text = JSON.stringify(record);
        if (new TextEncoder().encode(text).byteLength > maxFileBytes) throw new Error('预设库不能超过256 KiB');
        // 先持久化，再替换内存；配额或权限错误时保留原库和选中记录。
        try { storage.setItem(storageKey, text); } catch (error) { throw new Error('保存失败：浏览器本地存储不可用或空间不足'); }
        presets = clone(next); selectedId = selected;
        return state();
    };
    const uniqueId = (used) => {
        const id = createId();
        if (!id || id === 'custom' || used.has(id)) throw new Error('无法生成唯一预设ID');
        return id;
    };
    const load = () => {
        const text = storage.getItem(storageKey);
        if (!text) return state();
        const loaded = parsePresetFile(text, groups);
        const ids = new Set(), names = new Set();
        for (const record of loaded) {
            if (!record.id || record.id === 'custom' || ids.has(record.id) || names.has(record.name)) throw new Error('本地预设库含无效或重复记录');
            ids.add(record.id); names.add(record.name);
        }
        const savedSelection = JSON.parse(text).selectedId;
        presets = loaded; selectedId = ids.has(savedSelection) ? savedSelection : '';
        return state();
    };
    return Object.freeze({ state, load,
        save(name, settings) {
            const title = normalizeName(name);
            if (presets.some(record => record.name === title)) throw new Error('名称已存在，请改名或使用“覆盖所选”');
            const id = uniqueId(new Set(presets.map(record => record.id)));
            return commit([...presets, { id, name: title, settings: normalizeSettings(settings, groups) }], id);
        },
        overwrite(id, name, settings) {
            if (!presets.some(record => record.id === id)) throw new Error('请先选择要覆盖的预设');
            const title = normalizeName(name);
            if (presets.some(record => record.id !== id && record.name === title)) throw new Error('名称已存在');
            const replacement = { id, name: title, settings: normalizeSettings(settings, groups) };
            return commit(presets.map(record => record.id === id ? replacement : record), id);
        },
        select(id) {
            if (id && !presets.some(record => record.id === id)) throw new Error('预设不存在');
            return commit(presets, id);
        },
        remove(id) {
            if (!presets.some(record => record.id === id)) throw new Error('请先选择要删除的预设');
            return commit(presets.filter(record => record.id !== id), selectedId === id ? '' : selectedId);
        },
        importText(text) {
            const incoming = parsePresetFile(text, groups);
            if (!incoming.length) throw new Error('文件中没有灯光预设');
            const next = clone(presets), ids = new Set(next.map(record => record.id)), names = new Set(next.map(record => record.name));
            for (const record of incoming) {
                const base = record.name;
                let suffix = 1, name = base;
                while (names.has(name)) {
                    const ending = `（导入${suffix++}）`;
                    name = base.slice(0, 64 - ending.length) + ending;
                }
                const id = record.id && record.id !== 'custom' && !ids.has(record.id) ? record.id : uniqueId(ids);
                next.push({ ...record, id, name }); ids.add(id); names.add(name);
            }
            commit(next);
            return incoming.length;
        },
        exportText(id = '') {
            const records = id ? presets.filter(record => record.id === id) : presets;
            if (!records.length) throw new Error('请先保存或选择灯光预设');
            const file = { format, version, presets: records };
            const pretty = JSON.stringify(file, null, 2);
            // 导出也遵守导入上限；存储的紧凑库已校验大小，去掉selectedId不会增大。
            return new TextEncoder().encode(pretty).byteLength <= maxFileBytes ? pretty : JSON.stringify(file);
        }
    });
}
