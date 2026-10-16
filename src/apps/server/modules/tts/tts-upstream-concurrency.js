'use strict';

// 对应.src/framework/tts-provider-configuration.md：上游并发独立于语速、播放顺序和本地CPU槽位。
const DEFAULT_DOUBAO_CONCURRENCY = 3;
const MAX_DOUBAO_CONCURRENCY = 8;

function normalizeUpstreamConcurrency(patch = {}, previous = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some(key => key !== 'doubao-chat')) throw new Error('上游并发配置无效');
    const raw = patch['doubao-chat'] === undefined ? previous['doubao-chat'] ?? DEFAULT_DOUBAO_CONCURRENCY : patch['doubao-chat'];
    const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > MAX_DOUBAO_CONCURRENCY) {
        throw new Error('豆包上游并发必须是1至8之间的整数');
    }
    return { 'doubao-chat': value };
}

module.exports = { DEFAULT_DOUBAO_CONCURRENCY, MAX_DOUBAO_CONCURRENCY, normalizeUpstreamConcurrency };
