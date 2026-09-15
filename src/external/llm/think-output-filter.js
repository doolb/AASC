'use strict';

const THINK_TAG_PATTERN = /<\/?think(?:ing)?(?:\s[^>]*)?>/giu;
const STRUCTURED_PREFIX_PATTERN = /^\s*</u;

function stripThinkBlocks(value) {
    const text = String(value || '');
    let cursor = 0;
    let output = '';
    let insideThink = false;
    THINK_TAG_PATTERN.lastIndex = 0;

    for (const match of text.matchAll(THINK_TAG_PATTERN)) {
        const tag = match[0];
        const index = match.index || 0;
        const isOpening = !tag.startsWith('</');

        if (isOpening) {
            if (!insideThink) output += text.slice(cursor, index);
            insideThink = true;
        } else if (insideThink) {
            insideThink = false;
        } else {
            // 某些 MNN/量化模型会省略 <think>，但仍输出 </think>。
            // 这种情况下结束标记前的内容属于模型内部前缀，不能泄漏到聊天界面。
            output = '';
        }
        cursor = index + tag.length;
    }

    if (!insideThink) output += text.slice(cursor);
    return output.trim();
}

function createThinkOutputFilter() {
    let rawText = '';
    let visibleMessage = '';
    let state = 'undecided';

    const hasThinkTag = (value) => {
        const matched = THINK_TAG_PATTERN.test(value);
        THINK_TAG_PATTERN.lastIndex = 0;
        return matched;
    };

    const consume = (result) => {
        const nextMessage = stripThinkBlocks(result);
        const delta = nextMessage.startsWith(visibleMessage)
            ? nextMessage.slice(visibleMessage.length)
            : '';
        visibleMessage = nextMessage;
        return { delta, message: visibleMessage };
    };

    const updateState = () => {
        if (hasThinkTag(rawText)) {
            state = 'thinking';
            return;
        }
        if (state !== 'undecided') return;

        // 以 XML/角色配置开头的响应先暂存，给孤立 </think> 留出检测窗口。
        // 没有结构化前缀的普通回答立即保持原有流式体验。
        if (!STRUCTURED_PREFIX_PATTERN.test(rawText)) {
            state = 'visible';
        }
    };

    return {
        push(chunk) {
            if (!chunk) return { delta: '', message: visibleMessage };
            rawText += String(chunk);
            updateState();
            if (state === 'undecided') return { delta: '', message: visibleMessage };
            return consume(rawText);
        },

        finish(finalText = null) {
            if (typeof finalText === 'string') rawText = finalText;
            state = 'finished';
            return consume(rawText);
        }
    };
}

module.exports = {
    createThinkOutputFilter,
    stripThinkBlocks
};
