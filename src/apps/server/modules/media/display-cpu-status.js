'use strict';

const MAX_SUPPORTED_CPU_ID = 62;
const MAX_TTS_CONCURRENCY = 2;

function normalizeCpuIds(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= MAX_SUPPORTED_CPU_ID))]
        .sort((left, right) => left - right);
}

function normalizePolicy(policy) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
    const selectedCpus = normalizeCpuIds(policy.selectedCpus);
    const totalCoreCount = Number.isInteger(policy.totalCoreCount)
        ? Math.max(0, policy.totalCoreCount)
        : selectedCpus.length;
    return {
        bigCpus: normalizeCpuIds(policy.bigCpus),
        littleCpus: normalizeCpuIds(policy.littleCpus),
        selectedCpus,
        effectiveBigCoreCount: Number.isInteger(policy.effectiveBigCoreCount)
            ? Math.max(0, policy.effectiveBigCoreCount)
            : 0,
        effectiveLittleCoreCount: Number.isInteger(policy.effectiveLittleCoreCount)
            ? Math.max(0, policy.effectiveLittleCoreCount)
            : 0,
        totalCoreCount,
        fallback: policy.fallback === true,
        fallbackReason: typeof policy.fallbackReason === 'string' ? policy.fallbackReason : null
    };
}

function normalizeDisplayCpuStatus(status) {
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null;
    const asr = normalizePolicy(status.asr);
    const tts = normalizePolicy(status.tts);
    if (!asr || !tts) return null;

    const rawTopology = status.topology && typeof status.topology === 'object'
        ? status.topology
        : {};
    return {
        topology: {
            bigCpus: normalizeCpuIds(rawTopology.bigCpus),
            littleCpus: normalizeCpuIds(rawTopology.littleCpus),
            fallback: rawTopology.fallback === true,
            fallbackReason: typeof rawTopology.fallbackReason === 'string'
                ? rawTopology.fallbackReason
                : null
        },
        asr,
        tts,
        reportedAt: Date.now()
    };
}

function getDisplayTtsConcurrency(status) {
    const totalCoreCount = status?.tts?.totalCoreCount;
    if (!Number.isInteger(totalCoreCount) || totalCoreCount <= 0) return 1;
    return Math.max(1, Math.min(MAX_TTS_CONCURRENCY, totalCoreCount));
}

module.exports = {
    MAX_TTS_CONCURRENCY,
    normalizeDisplayCpuStatus,
    getDisplayTtsConcurrency
};
