/* Markdown 原文与朗读正文分离；Node 与网页共用，增量状态不依赖 DOM 或供应商。 */
(function exposeMarkdownSpeech(root, factory) {
    const api = factory(typeof module === 'object' && module.exports
        ? require('./sentence-splitter') : root.AASCSentenceSplitter);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AASCMarkdownSpeech = api;
}(typeof globalThis === 'object' ? globalThis : window, splitter => {
    'use strict';

    /** 成对链接的地址支持括号嵌套；未收齐的链接整体留待下一块，避免把地址读出。 */
    function findClosing(text, start) {
        let depth = 0;
        for (let index = start; index < text.length; index += 1) {
            if (text[index] === '\\') { index += 1; continue; }
            if (text[index] === '(') depth += 1;
            if (text[index] === ')' && --depth === 0) return index;
        }
        return -1;
    }

    function inlineSpeech(text, complete, preserveActions = false) {
        let result = '';
        for (let index = 0; index < text.length;) {
            const rest = text.slice(index);
            if (rest[0] === '\\') {
                if (rest.length === 1 && !complete) break;
                result += rest[1] || ''; index += Math.min(2, rest.length); continue;
            }
            const internal = rest.match(/^\[(?:source_group_web_\d+|\([^)]*\))\]/u);
            if (internal) { index += internal[0].length; continue; }
            if (rest[0] === '`') {
                const marker = rest.match(/^`+/u)[0];
                const end = text.indexOf(marker, index + marker.length);
                if (end < 0 && !complete) break;
                result += end < 0 ? rest.slice(marker.length) : text.slice(index + marker.length, end);
                index = end < 0 ? text.length : end + marker.length;
                continue;
            }
            const image = rest.startsWith('![');
            if (image || rest[0] === '[') {
                const opening = index + (image ? 1 : 0);
                const closing = text.indexOf(']', opening + 1);
                if (closing < 0 && !complete) break;
                if (closing >= 0 && closing === text.length - 1 && !complete) break;
                if (closing >= 0 && text[closing + 1] === '(') {
                    const end = findClosing(text, closing + 1);
                    if (end < 0 && !complete) break;
                    result += inlineSpeech(text.slice(opening + 1, closing), true);
                    index = end < 0 ? text.length : end + 1;
                    continue;
                }
            }
            if (rest.startsWith('**')) { index += rest.match(/^\*+/u)[0].length; continue; }
            if (preserveActions && rest[0] === '*' && !rest.startsWith('**')) {
                const end = rest.indexOf('*', 1);
                const candidate = end < 0 ? rest.slice(1) : rest.slice(1, end);
                // 单星号短动作交给既有有限字典解析；有句末标点的长斜体正文仍立即清洗、流式朗读。
                if (/^[\p{L}\p{N}\s]{0,24}$/u.test(candidate)) {
                    if (end < 0 && !complete) break;
                    if (end > 0) { result += rest.slice(0, end + 1); index += end + 1; continue; }
                }
            }
            if (rest[0] === '*' || rest[0] === '_' || rest.startsWith('~~')) {
                // 单词内部下划线不是格式，避免把标识符朗读成另一个词。
                const insideWord = rest[0] === '_' && /[\p{L}\p{N}]/u.test(text[index - 1] || '')
                    && /[\p{L}\p{N}]/u.test(rest[1] || '');
                const multiply = rest[0] === '*' && /\p{N}/u.test(text[index - 1] || '') && /\p{N}/u.test(rest[1] || '');
                if (insideWord || multiply) result += rest[0];
                index += rest.startsWith('~~') ? 2 : 1;
                continue;
            }
            result += text[index]; index += 1;
        }
        return result;
    }

    function toSpeechText(value, { complete = true, preserveActions = false } = {}) {
        const lines = String(value || '').replace(/\r\n?/gu, '\n').split('\n');
        const output = [];
        let fence = null;
        let lastSpokenComplete = false;
        for (const [index, raw] of lines.entries()) {
            const lineComplete = complete || index < lines.length - 1;
            const match = raw.match(/^\s*(`{3,}|~{3,})/u);
            if (fence) {
                if (match && match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
                continue;
            }
            if (match) { fence = match[1]; continue; }
            // 块首标记未完整时保留很短的前瞻；表格行待行结束后判别分隔符。
            if (!lineComplete && (/^\s*(?:#{1,6}|[-+*>]|\d+[.)]?)\s*$/u.test(raw)
                || raw.trimStart().startsWith('|'))) break;
            if (/^\s*(?:[-*_]\s*){3,}$/u.test(raw) || /^\s*\|?[\s:|-]+\|\s*$/u.test(raw)) continue;
            const line = raw.replace(/^\s{0,3}#{1,6}\s+/u, '').replace(/\s+#+\s*$/u, '')
                .replace(/^\s*(?:>\s*)+/u, '').replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, '');
            const spoken = inlineSpeech(line, lineComplete, preserveActions).replace(/\s*\|\s*/gu, ' ').trim();
            if (spoken) { output.push(spoken); lastSpokenComplete = lineComplete; }
            if (!lineComplete && spoken.length < line.trim().length
                && /[\[`]/u.test(line)) break;
        }
        const body = output.join('\n').trim();
        return body + (!complete && lastSpokenComplete && body ? '\n' : '');
    }

    /** 字幕可暂时补齐尚未到达的强调结束符，原始聊天与历史正文不做改写。 */
    function sealMarkdown(value) {
        const source = String(value || '');
        const stack = [];
        const markers = /\\.|\*\*|__|~~|\*|_/gu;
        for (const match of source.matchAll(markers)) {
            const marker = match[0];
            if (marker.startsWith('\\')) continue;
            const before = source.slice(0, match.index);
            if (marker === '*' && /^\s*$/u.test(before.slice(before.lastIndexOf('\n') + 1))
                && /\s/u.test(source[match.index + 1] || '')) continue;
            if (marker === '_' && /[\p{L}\p{N}]/u.test(source[match.index - 1] || '')
                && /[\p{L}\p{N}]/u.test(source[match.index + 1] || '')) continue;
            if (stack.at(-1) === marker) stack.pop(); else stack.push(marker);
        }
        return source + stack.reverse().join('');
    }

    // 字幕按可朗读正文匹配格式节点，忽略不会发声的空白/括号与格式残留。
    const speechKey = value => String(value || '').replace(/[\s（）()*_~]/gu, '').replace(/\.{2,}|…+/gu, '.');

    /** 只给分句器喂稳定的正文后缀；每段保留当前 Markdown，供字幕按实际 speech 定位。 */
    function createMarkdownSentenceStream() {
        const sentences = splitter.createSentenceStream();
        let source = '';
        let spoken = '';
        let finished = false;
        let cursor = 0;
        const consume = complete => {
            const next = toSpeechText(source, { complete, preserveActions: true });
            // 部分旧格式可能在最后才消歧；已经朗读的前缀不能倒退或重放。
            const delta = next.startsWith(spoken) ? next.slice(spoken.length) : '';
            if (delta) { spoken = next; }
            const text = sentences.push(delta);
            if (complete) text.push(...sentences.finish());
            return text.map(sentence => {
                const start = next.indexOf(sentence, cursor);
                if (start >= 0) cursor = start + sentence.length;
                return { text: sentence, subtitle: { markdown: sealMarkdown(source), speech: sentence,
                    offset: Array.from(speechKey(next.slice(0, Math.max(0, start)))).length } };
            });
        };
        return {
            push(value) {
                if (finished) return [];
                source += String(value || '');
                return consume(false);
            },
            finish() {
                if (finished) return [];
                finished = true;
                return consume(true);
            },
            getPending: () => sentences.getPending(),
        };
    }

    /** 完整文本入口也先处理Markdown再分句，避免把链接地址当括号内正文读出。 */
    function splitSpeechSegments(value, { strip = toSpeechText, split = splitter.splitIntoSentences } = {}) {
        const plain = strip(String(value || ''));
        let cursor = 0;
        return split(plain).filter(text => text.trim()).map(text => {
            const start = plain.indexOf(text, cursor);
            if (start >= 0) cursor = start + text.length;
            return { text, subtitle: { markdown: String(value || ''), speech: text,
                offset: Array.from(speechKey(plain.slice(0, Math.max(0, start)))).length } };
        });
    }

    return { toSpeechText, sealMarkdown, speechKey, createMarkdownSentenceStream, splitSpeechSegments };
}));
