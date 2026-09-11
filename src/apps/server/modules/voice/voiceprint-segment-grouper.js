/**
 * 将 ASR 返回的声纹分段按相邻同一说话人进行合并。
 *
 * 这里不重新判断声纹归属：声纹引擎给出的 speaker 结果是权威输入，
 * 本模块只负责整理跨端传输的数据，避免把未识别声纹或不同说话人错误拼接。
 */
function mergeVoiceprintSegments(segments) {
    if (!Array.isArray(segments)) return [];

    const result = [];
    for (const rawSegment of segments) {
        const segment = normalizeSegment(rawSegment);
        if (!segment.text) continue;

        const previous = result[result.length - 1];
        if (canMerge(previous, segment)) {
            mergeSegmentInto(previous, segment);
            continue;
        }

        result.push(segment);
    }

    return result;
}

function normalizeSegment(rawSegment) {
    const segment = rawSegment && typeof rawSegment === 'object'
        ? { ...rawSegment }
        : {};
    segment.text = String(segment.text || '').trim();
    segment.similarityScores = collectSimilarityScores(segment);
    segment.clusterIds = collectClusterIds(segment);
    return segment;
}

function collectSimilarityScores(segment) {
    const scores = Array.isArray(segment.similarityScores)
        ? segment.similarityScores.filter(Number.isFinite)
        : [];
    const score = Number(segment.similarityScore);
    if (Number.isFinite(score) && scores.length === 0) scores.push(score);
    return scores;
}

function collectClusterIds(segment) {
    if (Array.isArray(segment.clusterIds)) return [...segment.clusterIds];
    if (segment.clusterId === undefined || segment.clusterId === null) return [];
    return [segment.clusterId];
}

function canMerge(previous, current) {
    if (!previous || !current) return false;
    if (!isKnownSpeaker(previous.speaker) || !isKnownSpeaker(current.speaker)) return false;
    return String(previous.speaker).trim() === String(current.speaker).trim();
}

function isKnownSpeaker(speaker) {
    return speaker !== undefined && speaker !== null && String(speaker).trim().length > 0;
}

function mergeSegmentInto(target, source) {
    target.text += source.text;
    if (source.end !== undefined) target.end = source.end;
    target.similarityScores.push(...source.similarityScores);
    target.clusterIds.push(...source.clusterIds);
    // 多个窗口合并后，单个 similarityScore 不再代表整个分组，使用列表保留完整诊断信息。
    target.similarityScore = target.similarityScores.length === 1
        ? target.similarityScores[0]
        : null;
}

module.exports = {
    mergeVoiceprintSegments
};
