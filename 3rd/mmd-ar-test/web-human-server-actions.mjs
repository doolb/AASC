// 服务器动作是只读资源目录；名称不写入模板分支，VMD由Human按需加载。
export function validateServerActions(value, base) {
    if (value?.schema !== 1 || !Array.isArray(value.actions) || value.actions.length > 64) throw new Error('服务器动作目录格式无效');
    const ids = new Set(), names = new Set(), root = new URL('./mmd/', base);
    return value.actions.map(item => {
        if (!item || !/^[a-zA-Z0-9_-]{1,64}$/u.test(item.id) || ids.has(item.id)
            || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
            || /[\u0000-\u001f\u007f]/u.test(item.name) || Object.hasOwn(Object.prototype, item.name.trim())
            || names.has(item.name.trim()) || item.type !== 'vmd' || typeof item.url !== 'string') throw new Error('服务器动作名称/id重复或无效');
        const url = new URL(item.url, base);
        if (url.username || url.password || url.origin !== root.origin || !url.pathname.startsWith(root.pathname)
            || !url.pathname.toLowerCase().endsWith('.vmd') || url.search || url.hash
            || /%2f|%5c|%2e/iu.test(url.pathname)) throw new Error('服务器动作必须使用同源mmd目录VMD');
        const mplUrl = item.mplUrl == null ? null : new URL(item.mplUrl, base);
        if (mplUrl && (typeof item.mplUrl !== 'string' || mplUrl.username || mplUrl.password
            || mplUrl.origin !== root.origin || !mplUrl.pathname.startsWith(root.pathname)
            || !mplUrl.pathname.toLowerCase().endsWith('.mpl') || mplUrl.search || mplUrl.hash
            || /%2f|%5c|%2e/iu.test(mplUrl.pathname))) throw new Error('动作源码必须使用同源mmd目录MPL');
        const strength = item.strength ?? 1, count = item.count ?? 1;
        if (!Number.isFinite(strength) || strength < 0 || strength > 1 || !Number.isInteger(count) || count < 1 || count > 8
            || (item.duration != null && (!Number.isFinite(item.duration) || item.duration < 1 / 30 || item.duration > 3600))
            || (item.mask != null && (!Array.isArray(item.mask) || item.mask.length > 64
                || item.mask.some(part => typeof part !== 'string' || part.length > 120)))) throw new Error('服务器动作参数超出范围');
        ids.add(item.id); names.add(item.name.trim());
        return { id: item.id, name: item.name.trim(), type: 'vmd', url: url.href,
            mplUrl: mplUrl?.href || null, strength, count, duration: item.duration ?? null, mask: item.mask ?? [] };
    });
}
export function createServerActionCatalog({ url, fetcher = fetch }) {
    let actions = [], warning = '', pending = null;
    // 目录和源码均逐块限长，不依赖可缺失或不可信的Content-Length。
    async function readText(target) {
        const response = await fetcher(target, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                size += value.byteLength;
                if (size > 65536) throw new Error('目录或源码最多64KiB');
                chunks.push(value);
            }
        } catch (error) { await reader.cancel(); throw error; }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    async function load() {
        if (pending) return pending;
        pending = (async () => {
            try {
                actions = validateServerActions(JSON.parse(await readText(url)), url);
                warning = '';
            } catch (error) { warning = '服务器动作目录不可用：' + error.message; actions = []; }
            return actions.map(item => ({ ...item, mask: [...item.mask] }));
        })();
        return pending;
    }
    async function source(name) {
        await load();
        const entry = actions.find(item => item.name === name);
        if (!entry?.mplUrl) throw new Error(name + '只有VMD，暂无MPL源码');
        const text = await readText(entry.mplUrl);
        if (!text.trim()) throw new Error('动作MPL源码为空');
        return text;
    }
    return { load, source, list: () => actions.map(item => ({ ...item, mask: [...item.mask] })),
        getState: () => ({ warning, loaded: pending !== null }) };
}
export const serverActions = createServerActionCatalog({ url: new URL('../mmd-actions.json', import.meta.url).href });
