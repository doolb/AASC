'use strict';
const crypto = require('node:crypto');
const {
    normalizeProxyUrl, normalizeWebProxyList, migrateLegacyProxyConfig,
    MAX_PROXIES
} = require('./web-proxy');

const SOURCE_ID_PATTERN = /^(bilibili|[a-z][a-z0-9._-]{1,63})$/;
const NAME_MAX_LENGTH = 30;

// 两个配置分区没有事务接口，先记录可重放日志，再写选择，最后提交代理表。
// 日志保留在 network 分区；普通 set 失败或成功写入之间中断后，下次启动继续提交。
// 底层配置文件采用覆盖写入，写入中途终止造成的文件截断不在此恢复保证内。
function finishPendingUpdate({ get, set }) {
    const network = get('network', {}) || {};
    const pending = network.pendingWebProxyUpdate;
    if (!pending) return false;
    try {
        if (!set('media.providerProxy', pending.selections)) throw new Error();
        const next = { ...get('network', {}), webProxies: pending.proxies };
        delete next.pendingWebProxyUpdate;
        if (pending.migration) next.globalWebProxy = '';
        if (!set('network', next)) throw new Error();
    } catch {
        // 不透传底层异常，避免文件路径或代理凭据进入控制端错误消息。
        throw new Error('代理配置保存失败，请重试');
    }
    return true;
}

function saveProxyUpdate(access, proxies, selections, migration = false) {
    const network = access.get('network', {}) || {};
    try {
        if (!access.set('network', {
            ...network, pendingWebProxyUpdate: { proxies, selections, migration }
        })) throw new Error();
    } catch { throw new Error('代理配置保存失败，请重试'); }
    finishPendingUpdate(access);
}

// 旧配置的迁移标志在两个分区成功落盘之后才生效，重放不会重复创建代理。
function ensureWebProxyMigration(access) {
    const { get } = access;
    if (finishPendingUpdate(access)) return true;
    if (Array.isArray(get('network.webProxies', undefined))) return false;
    const migrated = migrateLegacyProxyConfig({
        globalProxy: get('network.globalWebProxy', ''),
        switches: get('media.providerProxy', {}) || {}
    });
    saveProxyUpdate(access, migrated.proxies, migrated.selections, true);
    return true;
}

function createWebProxySettings({ get, set, listSources = () => [], generateId }) {
    const makeId = generateId || (() => `proxy-${crypto.randomBytes(4).toString('hex')}`);
    const readProxies = () => normalizeWebProxyList(get('network.webProxies', []));
    const readSelections = () => {
        const value = get('media.providerProxy', {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };
    // 控制端需要的权威快照：代理表、来源选择，以及服务端解析后的 proxyId。
    function snapshot() {
        const webProxies = readProxies();
        const providerProxy = readSelections();
        const sources = listSources().map(source => ({
            id: source.id,
            name: source.name || source.id,
            region: source.region === 'overseas' ? 'overseas' : 'domestic',
            proxyId: typeof providerProxy[source.id] === 'string' ? providerProxy[source.id] : ''
        }));
        return { type: 'webProxyConfig', webProxies, providerProxy, sources };
    }

    // 客户端 id 只用于匹配旧项；新增项一律由服务端生成，重复 id 也重新生成。
    function setList(payload = {}) {
        finishPendingUpdate({ get, set });
        const input = Array.isArray(payload.webProxies) ? payload.webProxies : null;
        if (!input || input.length > MAX_PROXIES) throw new Error('代理数量超出限制（最多 20 个）');
        const currentIds = new Set(readProxies().map(proxy => proxy.id));
        const usedIds = new Set();
        const next = input.map(item => {
            const name = typeof item?.name === 'string' ? item.name.trim() : '';
            if (!name || name.length > NAME_MAX_LENGTH) throw new Error('代理名称不能为空且不能超过 30 个字符');
            let url = '';
            try { url = normalizeProxyUrl(item?.url); } catch { url = ''; }
            if (!url) throw new Error('代理地址格式不正确，仅支持 http/https/socks/socks5/socks5h');
            let id = typeof item?.id === 'string' && currentIds.has(item.id) && !usedIds.has(item.id)
                ? item.id
                : makeId();
            let attempts = 0;
            while (usedIds.has(id) || (currentIds.has(id) && id !== item?.id)) {
                if (++attempts > 100) throw new Error('代理标识生成失败，请重试');
                id = makeId();
            }
            if (typeof id !== 'string' || !id.trim()) throw new Error('代理标识生成失败，请重试');
            usedIds.add(id);
            return { id, name, url };
        });
        const validIds = new Set(next.map(proxy => proxy.id));
        const selections = {};
        for (const [sourceId, proxyId] of Object.entries(readSelections())) {
            selections[sourceId] = typeof proxyId === 'string' && validIds.has(proxyId) ? proxyId : '';
        }
        saveProxyUpdate({ get, set }, next, selections);
        return snapshot();
    }

    function setProvider(payload = {}) {
        finishPendingUpdate({ get, set });
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        if (!SOURCE_ID_PATTERN.test(sourceId)) throw new Error('媒体源标识不合法');
        const proxyId = typeof payload.proxyId === 'string' ? payload.proxyId : '';
        if (proxyId && !readProxies().some(proxy => proxy.id === proxyId)) {
            throw new Error('所选代理不存在，请先保存代理列表');
        }
        const selections = { ...readSelections(), [sourceId]: proxyId };
        try {
            if (!set('media.providerProxy', selections)) throw new Error();
        } catch { throw new Error('媒体源代理设置保存失败'); }
        return snapshot();
    }

    return { snapshot, setList, setProvider };
}

module.exports = { ensureWebProxyMigration, createWebProxySettings };
