'use strict';

// 连续省略号交给不同 TTS 引擎时停顿差异很大，统一替换成较短的英文句点。
const ELLIPSIS_PATTERN = /(?:\.{2,}|…+)/gu;

function normalizeTtsPauseText(text) {
    if (typeof text !== 'string') return text;
    return text.replace(ELLIPSIS_PATTERN, '.');
}

module.exports = { normalizeTtsPauseText };
