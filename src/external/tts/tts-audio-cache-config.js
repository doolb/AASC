'use strict';

const DEFAULT_MAX_MIB = 128;
const MIN_MAX_MIB = 16;
const MAX_MAX_MIB = 1024;
const BYTES_PER_MIB = 1024 * 1024;

// 配置读取与远端保存共用规则，拒绝布尔值、空串等隐式数字转换。
function normalizeAudioCacheMaxMiB(value) {
    const numeric = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(numeric)) return DEFAULT_MAX_MIB;
    return Math.min(MAX_MAX_MIB, Math.max(MIN_MAX_MIB, Math.trunc(numeric)));
}

module.exports = { DEFAULT_MAX_MIB, MIN_MAX_MIB, MAX_MAX_MIB, BYTES_PER_MIB, normalizeAudioCacheMaxMiB };
