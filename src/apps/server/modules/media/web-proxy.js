'use strict';
const { URL } = require('node:url');

const PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:']);
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

function resolveSourceProxyUrl({ globalProxy = '', switches = {}, sourceId, proxyDefault = false } = {}) {
    const normalized = normalizeProxyUrl(globalProxy);
    if (!normalized || !sourceId) return '';
    const selected = Object.prototype.hasOwnProperty.call(switches, sourceId)
        ? switches[sourceId] === true
        : proxyDefault === true;
    return selected ? normalized : '';
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
    return agents ? { proxy: false, ...agents } : {};
}

module.exports = { normalizeProxyUrl, resolveSourceProxyUrl, getProxyAgents, axiosProxyOptions };
