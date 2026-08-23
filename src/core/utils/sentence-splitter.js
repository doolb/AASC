(function exposeSentenceSplitter(root, factory) {
    const sentenceSplitter = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = sentenceSplitter;
    }

    if (root && root.window === root) {
        root.AASCSentenceSplitter = sentenceSplitter;
    }
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
    // 判断已累积文本的最后一个字符是否是句末标点。
    function isSentenceEnd(text) {
        if (!text || text.length === 0) return false;
        const lastChar = text[text.length - 1];
        if (lastChar === '\n') return true;
        const endChars = ['.', '!', '?', '~', '～', '\u3002', '\uFF01', '\uFF1F', '\uFF1B', ';', '\u2026'];
        return endChars.includes(lastChar);
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
                if (ch === '.' && i + 1 < text.length && text[i + 1] !== ' ' && text[i + 1] !== '\n') {
                    continue;
                }
                const trimmed = current.trim();
                if (trimmed.length > 0) {
                    sentences.push(trimmed);
                }
                current = '';
                commaCount = 0;
            } else if (commaCount > 4) {
                const trimmed = current.trim();
                if (trimmed.length > 0) {
                    sentences.push(trimmed);
                }
                current = '';
                commaCount = 0;
            }
        }

        if (current.trim().length > 0) {
            sentences.push(current.trim());
        }

        return sentences;
    }

    return { isSentenceEnd, splitIntoSentences };
}));
