'use strict';

/**
 * 规范化在线语音播放显示端 ID 列表。
 *
 * 目标选择依赖服务器维护的稳定顺序，因此这里只去除无效值和重复值，
 * 不对有效显示端重新排序。
 *
 * @param {unknown} displayIds 原始显示端 ID 列表
 * @returns {string[]} 可参与语音播放路由的显示端 ID
 */
function normalizeVoicePlaybackDisplayIds(displayIds) {
    if (!Array.isArray(displayIds)) return [];

    const seen = new Set();
    const normalized = [];
    for (const displayId of displayIds) {
        if (typeof displayId !== 'string' || !displayId || seen.has(displayId)) continue;
        seen.add(displayId);
        normalized.push(displayId);
    }
    return normalized;
}

/**
 * 按“首选显示端优先、在线语音播放设备兜底”的规则选择单个目标。
 *
 * @param {string|null} preferredDisplayId 首选显示端 ID
 * @param {unknown} availableDisplayIds 当前在线且具备 voicePlayback 的 ID 列表
 * @returns {string|null} 实际播放目标；没有可用目标时返回 null
 */
function resolveVoicePlaybackTarget(preferredDisplayId, availableDisplayIds) {
    const normalizedDisplayIds = normalizeVoicePlaybackDisplayIds(availableDisplayIds);
    if (typeof preferredDisplayId === 'string'
        && normalizedDisplayIds.includes(preferredDisplayId)) {
        return preferredDisplayId;
    }
    return normalizedDisplayIds[0] || null;
}

module.exports = {
    normalizeVoicePlaybackDisplayIds,
    resolveVoicePlaybackTarget
};
