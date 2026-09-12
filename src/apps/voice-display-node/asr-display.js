'use strict';

/**
 * 将服务器返回的 ASR 结果转换为子显示端本地回显文本。
 *
 * 这里仅负责展示，不参与语音命令处理，也不修改服务器已经收到的原始文本。
 * 网页显示端使用相同的字段语义，Node 子显示端因此只复制展示规则。
 *
 * @param {Object} response - 服务器 ASR 响应
 * @returns {string} 适合 TUI 和日志显示的文本
 */
function formatAsrDisplayText(response = {}) {
    const segments = Array.isArray(response.segments) ? response.segments : [];
    if (segments.length > 0) {
        const displayTexts = segments
            .map(formatVoiceprintDisplaySegment)
            .filter(Boolean);
        const ignoredText = String(response.ignoredText || '').trim();
        if (ignoredText) {
            displayTexts.push(`[未识别有效内容] ${ignoredText}`);
        }
        return displayTexts.join('\n');
    }

    const text = String(response.text || '').trim();
    if (!text) return '';
    if (response.status === 'success' && response.speaker === null) {
        return formatVoiceprintDisplaySegment(response);
    }
    return text;
}

/**
 * 按网页显示端当前规则格式化一个声纹分段。
 *
 * @param {Object} segment - ASR 分段或包含声纹字段的普通结果
 * @returns {string} 格式化后的文本
 */
function formatVoiceprintDisplaySegment(segment = {}) {
    const text = String(segment.text || '').trim();
    if (!text) return '';

    const speaker = String(segment.speaker || '').trim();
    if (speaker) return `[${speaker}] ${text}`;

    const scores = Array.isArray(segment.similarityScores)
        ? segment.similarityScores
        : [segment.similarityScore];
    const scoreText = scores
        .map(score => Number(score))
        .filter(Number.isFinite)
        .map(score => score.toFixed(3))
        .join('/');
    const threshold = Number(segment.threshold);
    const thresholdText = Number.isFinite(threshold) ? threshold.toFixed(3) : '未知';
    return `[未识别声纹｜相似度 ${scoreText || '未知'}｜阈值 ${thresholdText}] ${text}`;
}

module.exports = {
    formatAsrDisplayText,
    formatVoiceprintDisplaySegment
};
