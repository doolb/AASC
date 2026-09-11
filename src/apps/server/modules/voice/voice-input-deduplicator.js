'use strict';

const DEFAULT_WINDOW_MS = 2000;
const DEFAULT_TIMING_GAP_MS = 500;
const DEFAULT_TEXT_SIMILARITY_THRESHOLD = 0.65;
const DEFAULT_MAX_AGE_MS = 10000;

/**
 * 规范化 ASR 文本，仅用于判断跨显示端是否可能是同一句话。
 * 不做同音字、近义词或模糊语义转换，避免把不同命令错误合并。
 *
 * @param {unknown} value 原始 ASR 文本
 * @returns {string} 去除空白和常见标点后的文本
 */
function normalizeVoiceInputText(value) {
    return String(value || '')
        .trim()
        .replace(/[\s\u3000]+/gu, '')
        .replace(/[。，！？、；：,.!?;:]+/gu, '');
}

function normalizeDuration(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeSimilarityThreshold(value, fallback) {
    return Number.isFinite(value)
        ? Math.min(1, Math.max(0, value))
        : fallback;
}

/**
 * 使用字符级 Levenshtein 距离计算两条 ASR 文本的相似度。
 * 只用于判断同一时段的重复结果，不承担语义理解，避免把不同命令合并。
 *
 * @param {unknown} left 第一条文本
 * @param {unknown} right 第二条文本
 * @returns {number} 0 到 1 之间的相似度
 */
function calculateVoiceInputTextSimilarity(left, right) {
    const leftChars = Array.from(normalizeVoiceInputText(left));
    const rightChars = Array.from(normalizeVoiceInputText(right));
    if (leftChars.length === 0 || rightChars.length === 0) return 0;
    if (leftChars.join('') === rightChars.join('')) return 1;

    let previous = Array.from({ length: rightChars.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
            const replacementCost = leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + replacementCost
            );
        }
        previous = current;
    }

    const maxLength = Math.max(leftChars.length, rightChars.length);
    return Math.max(0, 1 - previous[rightChars.length] / maxLength);
}

function normalizeSpeechInterval(input) {
    const start = Number(input?.speechStartAt);
    const end = Number(input?.speechEndAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return { start, end };
}

function areSpeechIntervalsClose(left, right, timingGapMs) {
    const gap = left.end < right.start
        ? right.start - left.end
        : right.end < left.start
            ? left.start - right.end
            : 0;
    return gap <= timingGapMs;
}

/**
 * 创建同一注册声纹的跨显示端 ASR 去重器。
 *
 * 这里保存的只有短文本和消息元数据，不保存音频；调用方应在服务端
 * 广播控制端、修复模式和语音命令路由之前调用 check()。
 *
 * @param {{windowMs?: number, timingGapMs?: number, textSimilarityThreshold?: number, maxAgeMs?: number}} options 去重窗口配置
 * @returns {{check: Function, clear: Function}}
 */
function createSameSpeakerVoiceInputDeduplicator(options = {}) {
    const windowMs = normalizeDuration(options.windowMs, DEFAULT_WINDOW_MS);
    const timingGapMs = normalizeDuration(options.timingGapMs, DEFAULT_TIMING_GAP_MS);
    const textSimilarityThreshold = normalizeSimilarityThreshold(
        options.textSimilarityThreshold,
        DEFAULT_TEXT_SIMILARITY_THRESHOLD
    );
    const maxAgeMs = Math.max(
        windowMs,
        normalizeDuration(options.maxAgeMs, DEFAULT_MAX_AGE_MS)
    );
    const recentInputs = [];

    function prune(now) {
        let firstActiveIndex = 0;
        while (firstActiveIndex < recentInputs.length
            && now - recentInputs[firstActiveIndex].receivedAt > maxAgeMs) {
            firstActiveIndex += 1;
        }
        if (firstActiveIndex > 0) {
            recentInputs.splice(0, firstActiveIndex);
        }
    }

    function check(input, receivedAt = Date.now()) {
        const now = Number.isFinite(receivedAt) ? receivedAt : Date.now();
        prune(now);

        if (!input || input.isFinal !== true) return { isDuplicate: false };

        const speaker = typeof input.speaker === 'string' ? input.speaker.trim() : '';
        const displayId = typeof input.displayId === 'string' ? input.displayId.trim() : '';
        const normalizedText = normalizeVoiceInputText(input.text);
        if (!speaker || !displayId || !normalizedText) {
            return { isDuplicate: false };
        }

        const inputInterval = normalizeSpeechInterval(input);

        for (let index = recentInputs.length - 1; index >= 0; index -= 1) {
            const candidate = recentInputs[index];
            const timeDelta = Math.abs(now - candidate.receivedAt);
            if (candidate.speaker !== speaker
                || candidate.displayId === displayId) {
                continue;
            }

            const candidateInterval = normalizeSpeechInterval(candidate);
            const textSimilarity = calculateVoiceInputTextSimilarity(
                candidate.normalizedText,
                normalizedText
            );
            const timingAvailable = Boolean(inputInterval && candidateInterval);
            const isSameSpeech = timingAvailable
                ? areSpeechIntervalsClose(inputInterval, candidateInterval, timingGapMs)
                    && textSimilarity >= textSimilarityThreshold
                : candidate.normalizedText === normalizedText && timeDelta <= windowMs;
            if (!isSameSpeech) continue;

            return {
                isDuplicate: true,
                duplicateOfDisplayId: candidate.displayId,
                speaker,
                textSimilarity
            };
        }

        recentInputs.push({
            speaker,
            displayId,
            normalizedText,
            speechStartAt: inputInterval?.start ?? null,
            speechEndAt: inputInterval?.end ?? null,
            receivedAt: now
        });
        return { isDuplicate: false };
    }

    function clear() {
        recentInputs.length = 0;
    }

    return { check, clear };
}

module.exports = {
    DEFAULT_WINDOW_MS,
    DEFAULT_TIMING_GAP_MS,
    DEFAULT_TEXT_SIMILARITY_THRESHOLD,
    DEFAULT_MAX_AGE_MS,
    normalizeVoiceInputText,
    calculateVoiceInputTextSimilarity,
    createSameSpeakerVoiceInputDeduplicator
};
