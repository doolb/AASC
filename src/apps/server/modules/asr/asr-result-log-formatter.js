'use strict';

/**
 * 将日志中的可选数字统一转换为有限数值或 null。
 * 声纹分数、阈值和时间字段可能由不同版本 APK 以字符串或缺省值回传，
 * 日志格式统一后便于人工检索，也避免 NaN/Infinity 污染 JSON 文本。
 */
function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}

/**
 * 规范化一个声纹分段，只输出诊断所需字段，不把音频或其他大对象写入日志。
 */
function normalizeSegment(segment = {}) {
    return {
        text: String(segment.text || ''),
        start: normalizeNumber(segment.start),
        end: normalizeNumber(segment.end),
        clusterId: segment.clusterId ?? null,
        speaker: segment.speaker ? String(segment.speaker) : null,
        similarityScore: normalizeNumber(segment.similarityScore),
        threshold: normalizeNumber(segment.threshold),
        error: segment.error ? String(segment.error) : null
    };
}

/**
 * 格式化显示端回传的 ASR/声纹结果日志。
 * 详细模式打印每个分段的文字和声纹诊断；简要模式仍保留总文字、顶层声纹
 * 结果及错误摘要，方便在大量录音场景下降低日志体积。
 */
function formatAsrResultLog(data = {}, detailed = true) {
    const segments = Array.isArray(data.segments)
        ? data.segments.map(normalizeSegment)
        : [];
    const segmentText = segments.map(segment => segment.text).join('');
    const payload = {
        requestId: data.requestId ? String(data.requestId) : null,
        text: String(data.text || segmentText),
        speaker: data.speaker ? String(data.speaker) : null,
        similarityScore: normalizeNumber(data.similarityScore),
        threshold: normalizeNumber(data.threshold),
        error: data.error ? String(data.error) : null
    };

    if (Array.isArray(data.similarityScores)) {
        payload.similarityScores = data.similarityScores.map(normalizeNumber);
    }
    if (detailed) payload.segments = segments;

    return `<< asrResult ${JSON.stringify(payload)}`;
}

module.exports = { formatAsrResultLog };
