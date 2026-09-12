'use strict';

const DEFAULT_NOISE_TEST_DURATION_MS = 3000;
const MIN_NOISE_TEST_DURATION_MS = 1000;
const MAX_NOISE_TEST_DURATION_MS = 10000;
const MIN_VAD_THRESHOLD = 0.001;
const MAX_VAD_THRESHOLD = 0.2;

/**
 * 规范化底噪检测时长，和网页显示端保持相同边界。
 * @param {number} value - 请求的检测时长
 * @returns {number}
 */
function normalizeNoiseTestDuration(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_NOISE_TEST_DURATION_MS;
    return Math.round(Math.min(MAX_NOISE_TEST_DURATION_MS, Math.max(MIN_NOISE_TEST_DURATION_MS, number)));
}

/**
 * 根据录音帧的 RMS 值计算底噪统计结果。
 * @param {number[]} samples - 每个采集帧的 RMS 值
 * @param {number} durationMs - 实际采集时长
 * @returns {Object}
 */
function calculateNoiseStats(samples, durationMs) {
    const values = Array.isArray(samples)
        ? samples.filter(value => Number.isFinite(value)).map(value => Number(value))
        : [];
    const sortedValues = [...values].sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(sortedValues.length * 0.95) - 1);
    const p95Rms = sortedValues.length ? sortedValues[p95Index] : 0;
    const averageRms = sortedValues.length
        ? values.reduce((total, value) => total + value, 0) / values.length
        : 0;
    const peakRms = sortedValues.length ? sortedValues[sortedValues.length - 1] : 0;
    const recommendedThreshold = Math.round(
        Math.min(MAX_VAD_THRESHOLD, Math.max(MIN_VAD_THRESHOLD, p95Rms * 1.5)) * 1000000
    ) / 1000000;

    return {
        durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : 0,
        sampleCount: values.length,
        averageRms,
        peakRms,
        p95Rms,
        recommendedThreshold
    };
}

module.exports = {
    calculateNoiseStats,
    normalizeNoiseTestDuration
};
