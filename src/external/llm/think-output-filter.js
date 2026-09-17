'use strict';

const THINK_TAG_PATTERN = /<\/?think(?:ing)?(?:\s[^>]*)?>/giu;
const STRUCTURED_PREFIX_PATTERN = /^\s*</u;
const THINK_TAGS = ['<think>', '<thinking>', '</think>', '</thinking>'];

function stripPartialThinkTag(value) {
    const text = String(value || '');
    const start = text.lastIndexOf('<');
    if (start < 0) return text;

    const suffix = text.slice(start).toLowerCase();
    if (THINK_TAGS.some((tag) => tag.startsWith(suffix))) return text.slice(0, start);
    if (/^<\/?think(?:ing)?\s[^>]*$/iu.test(suffix)) return text.slice(0, start);
    return text;
}

function parseThinkOutput(value) {
    const text = stripPartialThinkTag(value);
    let cursor = 0;
    let answer = '';
    let reasoning = '';
    let speech = '';
    let insideThink = false;

    THINK_TAG_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(THINK_TAG_PATTERN)) {
        const tag = match[0];
        const index = match.index || 0;
        const segment = text.slice(cursor, index);
        if (insideThink) {
            reasoning += segment;
            speech += segment;
        } else {
            answer += segment;
            speech += segment;
        }

        const isOpening = !tag.startsWith('</');
        if (isOpening) {
            insideThink = true;
        } else if (insideThink) {
            insideThink = false;
        } else {
            // 模型偶尔省略 <think>，但仍输出 </think>；结束标签前可能是角色提示词，全部丢弃。
            answer = '';
            reasoning = '';
            speech = '';
        }
        cursor = index + tag.length;
    }

    const tail = text.slice(cursor);
    if (insideThink) {
        reasoning += tail;
        speech += tail;
    } else {
        answer += tail;
        speech += tail;
    }

    return {
        answer: answer.trim(),
        reasoning: reasoning.trim(),
        speech: speech.trim()
    };
}

function stripThinkBlocks(value) {
    return parseThinkOutput(value).answer;
}

function createThinkOutputFilter() {
    let rawText = '';
    let answer = '';
    let reasoning = '';
    let speech = '';
    let state = 'undecided';

    const hasThinkTag = (value) => {
        THINK_TAG_PATTERN.lastIndex = 0;
        const matched = THINK_TAG_PATTERN.test(value);
        THINK_TAG_PATTERN.lastIndex = 0;
        return matched;
    };

    const getDelta = (nextValue, previousValue) => (
        nextValue.startsWith(previousValue) ? nextValue.slice(previousValue.length) : ''
    );

    const consume = (isFinal = false) => {
        const stableText = isFinal ? rawText : stripPartialThinkTag(rawText);
        const next = parseThinkOutput(stableText);
        const result = {
            delta: getDelta(next.answer, answer),
            message: next.answer,
            reasoningDelta: getDelta(next.reasoning, reasoning),
            reasoning: next.reasoning,
            speechDelta: getDelta(next.speech, speech),
            speech: next.speech
        };
        answer = next.answer;
        reasoning = next.reasoning;
        speech = next.speech;
        return result;
    };

    const updateState = () => {
        if (hasThinkTag(rawText)) {
            state = 'thinking';
            return;
        }
        if (state !== 'undecided') return;

        // 结构化提示词前缀先暂存，以识别只有 </think> 的异常响应并防止前缀泄漏。
        if (!STRUCTURED_PREFIX_PATTERN.test(stripPartialThinkTag(rawText))) {
            state = 'visible';
        }
    };

    return {
        push(chunk) {
            if (!chunk) {
                return {
                    delta: '', message: answer,
                    reasoningDelta: '', reasoning,
                    speechDelta: '', speech
                };
            }
            rawText += String(chunk);
            updateState();
            if (state === 'undecided') {
                return {
                    delta: '', message: answer,
                    reasoningDelta: '', reasoning,
                    speechDelta: '', speech
                };
            }
            return consume();
        },

        finish(finalText = null) {
            if (typeof finalText === 'string') rawText = finalText;
            state = 'finished';
            return consume(true);
        }
    };
}

module.exports = {
    createThinkOutputFilter,
    parseThinkOutput,
    stripThinkBlocks
};
