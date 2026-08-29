(function exposeSentenceSplitter(root, factory) {
    const sentenceSplitter = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = sentenceSplitter;
    }

    if (root && root.window === root) {
        root.AASCSentenceSplitter = sentenceSplitter;
    }
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
    // 只把 Unicode 标点和兼容的波浪号视为标点，避免把表情或普通符号误当成标点分句。
    const punctuationOnlyPattern = /^[\p{P}~]+$/u;

    // 判断已累积文本的最后一个字符是否是句末标点。
    function isSentenceEnd(text) {
        if (!text || text.length === 0) return false;
        const lastChar = text[text.length - 1];
        if (lastChar === '\n') return true;
        const endChars = ['.', '!', '?', '~', '～', '\u3002', '\uFF01', '\uFF1F', '\uFF1B', ';', '\u2026'];
        return endChars.includes(lastChar);
    }

    // 连续句点/省略号的最后一个字符作为边界，避免“你好......世界”被合并成一句。
    function isEllipsisRunEnd(text, index) {
        const current = text[index];
        if (current !== '.' && current !== '\u2026') return false;
        if (index === 0 || text[index - 1] !== current) return false;
        return index + 1 >= text.length || text[index + 1] !== current;
    }

    // 判断一个已经切出的分句是否完全由标点构成。
    function isPunctuationOnly(text) {
        const trimmed = typeof text === 'string' ? text.trim() : '';
        return trimmed.length > 0 && punctuationOnlyPattern.test(trimmed);
    }

    // 连续的仅标点分句只保留第一个，避免多个无文字音频依次进入 TTS 队列。
    function appendSentence(sentences, text) {
        const trimmed = text.trim();
        if (trimmed.length === 0) return;

        const previous = sentences[sentences.length - 1];
        if (isPunctuationOnly(previous) && isPunctuationOnly(trimmed)) {
            return;
        }
        sentences.push(trimmed);
    }

    // 按句末标点分句；英文句点仅在后接空白、换行或文本结尾时分割，避免切开小数和缩写。
    // 已累积四个中英文逗号后，在下一个逗号处强制输出当前片段，防止流式文本长期不播放。
    function splitIntoSentences(text) {
        if (!text || typeof text !== 'string') {
            return [];
        }

        const sentences = [];
        let current = '';
        let commaCount = 0;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            current += ch;

            if (ch === '，' || ch === ',') {
                commaCount++;
            }

            if (isSentenceEnd(current)) {
                const isEllipsisEnd = isEllipsisRunEnd(text, i);
                if ((ch === '.' || ch === '\u2026')
                    && i + 1 < text.length
                    && text[i + 1] !== ' '
                    && text[i + 1] !== '\n'
                    && !isEllipsisEnd) {
                    continue;
                }
                appendSentence(sentences, current);
                current = '';
                commaCount = 0;
            } else if (commaCount > 4) {
                appendSentence(sentences, current);
                current = '';
                commaCount = 0;
            }
        }

        appendSentence(sentences, current);

        return sentences;
    }

    return { isPunctuationOnly, isSentenceEnd, splitIntoSentences };
}));
