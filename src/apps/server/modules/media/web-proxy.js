'use strict';
const { URL } = require('node:url');

const PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:']);
const MAX_PROXIES = 20;
const LEGACY_PROXY_ID = 'proxy-legacy';
const agentCache = new Map();

function normalizeProxyUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('代理地址格式无效'); }
    if (!PROTOCOLS.has(parsed.protocol)) throw new Error('代理仅支持 HTTP/HTTPS/SOCKS5');
    if (!parsed.hostname) throw new Error('代理地址缺少主机名');
    if (parsed.search || parsed.hash) throw new Error('代理地址不能包含查询参数或片段');
    return parsed.toString().replace(/\/$/, '');
}

// 读取持久化代理表时做防御性规范化：无效项直接丢弃，不影响其他代理。
function normalizeWebProxyList(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_PROXIES).map(proxy => {
        if (!proxy || typeof proxy !== 'object') return null;
        const id = typeof proxy.id === 'string' ? proxy.id.trim() : '';
        const name = typeof proxy.name === 'string' ? proxy.name.trim().slice(0, 30) : '';
        if (!id || !name) return null;
        let url = '';
        try { url = normalizeProxyUrl(proxy.url); } catch { url = ''; }
        return url ? { id, name, url } : null;
    }).filter(Boolean);
}

// 将旧的单全局代理与布尔开关迁移为命名代理及来源选择。
function migrateLegacyProxyConfig({ globalProxy = '', switches = {} } = {}) {
    let legacyUrl = '';
    try { legacyUrl = normalizeProxyUrl(globalProxy); } catch { legacyUrl = ''; }
    const proxies = legacyUrl
        ? [{ id: LEGACY_PROXY_ID, name: '默认代理', url: legacyUrl }]
        : [];
    const selections = {};
    for (const [sourceId, enabled] of Object.entries(switches || {})) {
        selections[sourceId] = enabled === true && legacyUrl ? LEGACY_PROXY_ID : '';
    }
    return { proxies, selections, legacyUrl };
}

// 按来源解析命名代理；损坏的持久化数据降级为不使用代理。
function resolveSourceProxyUrl({ proxies = [], selections = {}, sourceId } = {}) {
    const options = arguments[0] || {};
    const hasNewModelFields = Object.prototype.hasOwnProperty.call(options, 'proxies')
        || Object.prototype.hasOwnProperty.call(options, 'selections');
    // 仅纯旧模型调用走兼容逻辑；新模型字段始终具有优先级。
    if (!hasNewModelFields && Object.prototype.hasOwnProperty.call(options, 'globalProxy')) {
        const { globalProxy = '', switches = {}, proxyDefault = false } = options;
        const normalized = normalizeProxyUrl(globalProxy);
        if (!normalized || !sourceId) return '';
        const selected = Object.prototype.hasOwnProperty.call(switches, sourceId)
            ? switches[sourceId] === true
            : proxyDefault === true;
        return selected ? normalized : '';
    }
    if (!sourceId) return '';
    const selection = Object.prototype.hasOwnProperty.call(selections || {}, sourceId)
        ? selections[sourceId]
        : '';
    const proxyId = typeof selection === 'string' ? selection : '';
    if (!proxyId) return '';
    const proxy = Array.isArray(proxies)
        ? proxies.find(item => item && item.id === proxyId)
        : null;
    if (!proxy) return '';
    try { return normalizeProxyUrl(proxy.url); } catch { return ''; }
}

function getProxyAgents(proxyUrl) {
    const normalized = normalizeProxyUrl(proxyUrl);
    if (!normalized) return null;
    if (agentCache.has(normalized)) return agentCache.get(normalized);
    const protocol = new URL(normalized).protocol;
    let Agent;
    try {
        Agent = protocol.startsWith('socks')
            ? require('socks-proxy-agent').SocksProxyAgent
            : require('https-proxy-agent').HttpsProxyAgent;
    } catch {
        throw new Error('代理组件未安装，请安装 https-proxy-agent 与 socks-proxy-agent');
    }
    const agent = new Agent(normalized);
    const value = { httpAgent: agent, httpsAgent: agent };
    agentCache.set(normalized, value);
    return value;
}

function axiosProxyOptions(proxyUrl) {
    const agents = getProxyAgents(proxyUrl);
    return agents ? { proxy: false, ...agents } : { proxy: false };
}

// 绑定来源而非固定代理：每次请求读取权威配置，避免影响其他来源或在途连接。
function createSourceHttpClient(client, getProxyUrl = () => '') {
    const options = value => ({ ...value, ...axiosProxyOptions(getProxyUrl()) });
    return {
        get: (url, config) => client.get(url, options(config)),
        post: (url, body, config) => client.post(url, body, options(config)),
        request: config => client.request(options(config))
    };
}

module.exports = {
    normalizeProxyUrl, normalizeWebProxyList, migrateLegacyProxyConfig,
    resolveSourceProxyUrl, getProxyAgents, axiosProxyOptions, createSourceHttpClient,
    MAX_PROXIES, LEGACY_PROXY_ID
};
