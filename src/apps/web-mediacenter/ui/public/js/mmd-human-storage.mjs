const NAME = 'aasc-display-mmd-human-v1', LIMIT = 64 * 1024 * 1024;
const fresh = () => ({ schema: 2, candidates: [], actions: [], assets: [], presets: {}, rules: [], mappings: {}, physiology: {}, gaze: {} });
export function validateHumanLibrary(record) {
    if (!record || ![1, 2].includes(record.schema) || !Array.isArray(record.actions) || record.actions.length > 64
        || !Array.isArray(record.assets) || record.assets.length > 64 || !Array.isArray(record.rules) || record.rules.length > 32
        || !record.presets || !record.mappings || !record.physiology) throw new Error('动作库格式或数量无效');
    const candidates = record.schema === 1 ? [] : record.candidates;
    if (!Array.isArray(candidates) || candidates.length > 32) throw new Error('候选动作最多32条');
    const candidateIds = new Set();
    for (const item of candidates) {
        if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 80 || candidateIds.has(item.id)
            || typeof item.requestId !== 'string' || item.requestId.length > 80
            || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 500
            || typeof item.source !== 'string' || !item.source.trim() || new TextEncoder().encode(item.source).length > 16384
            || typeof item.providerId !== 'string' || item.providerId.length > 100
            || typeof item.model !== 'string' || item.model.length > 160) throw new Error('候选动作数据无效');
        candidateIds.add(item.id);
    }
    let bytes = 0, versions = candidates.length;
    const ids = new Set();
    for (const asset of record.assets) {
        if (typeof asset.id !== 'string' || ids.has(asset.id) || !(asset.buffer instanceof ArrayBuffer)
            || asset.buffer.byteLength > 16 * 1024 * 1024) throw new Error('动作库VMD资源无效');
        ids.add(asset.id); bytes += asset.buffer.byteLength;
    }
    for (const action of record.actions) {
        if (typeof action.actionId !== 'string' || !Array.isArray(action.versions) || !action.versions.length
            || action.versions.length > 16 || !action.versions.some(v => v.id === action.active)) throw new Error('行为版本无效');
        versions += action.versions.length;
        if (action.versions.some(v => v.assetId && !ids.has(v.assetId))) throw new Error('行为引用的VMD缺失');
    }
    if (versions > 128 || bytes > LIMIT) throw new Error('动作库最多128版本、64MiB VMD');
    const metadata = JSON.stringify({ ...record, assets: record.assets.map(a => ({ id: a.id })) });
    if (new TextEncoder().encode(metadata).length > 1024 * 1024) throw new Error('动作库定义最多1MiB');
    return record.schema === 1 ? { ...record, schema: 2, candidates: [] } : record;
}
async function database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('libraries');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('动作库数据库不可用'));
        request.onblocked = () => reject(new Error('动作库数据库升级被其他页面占用'));
    });
}
export async function loadHumanLibrary(key) {
    const db = await database();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('libraries').objectStore('libraries').get(key);
            request.onsuccess = () => { try { resolve(request.result ? validateHumanLibrary(request.result) : fresh()); } catch (error) { reject(error); } };
            request.onerror = () => reject(request.error);
        });
    } finally { db.close(); }
}
export async function saveHumanLibrary(key, record) {
    record = validateHumanLibrary(record);
    const db = await database();
    try {
        await new Promise((resolve, reject) => {
            const transaction = db.transaction('libraries', 'readwrite');
            transaction.objectStore('libraries').put(record, key);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('动作库保存中断'));
        });
    } finally { db.close(); }
}
export function emptyHumanLibrary() { return fresh(); }
export function exportHumanLibrary(record) {
    record = validateHumanLibrary(record);
    const assets = record.assets.map(asset => {
        const bytes = new Uint8Array(asset.buffer), parts = [];
        for (let start = 0; start < bytes.length; start += 8192) parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
        return { id: asset.id, data: btoa(parts.join('')) };
    });
    return new Blob([JSON.stringify({ ...record, assets })], { type: 'application/json' });
}
export async function importHumanLibrary(file) {
    if (!(file instanceof Blob) || file.size > 96 * 1024 * 1024) throw new Error('动作库文件最多96MiB');
    const record = JSON.parse(await file.text());
    if (!Array.isArray(record.assets) || record.assets.length > 64) throw new Error('动作库资源列表无效');
    record.assets = record.assets.map(asset => {
        if (typeof asset.data !== 'string' || asset.data.length > 24 * 1024 * 1024) throw new Error('动作库资源编码无效');
        const decoded = atob(asset.data), bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        return { id: asset.id, buffer: bytes.buffer };
    });
    return validateHumanLibrary(record);
}
