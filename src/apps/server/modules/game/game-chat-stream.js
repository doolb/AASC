'use strict';

const { createMarkdownSentenceStream } = require('../../../../core/utils/markdown-speech');

/** 每请求拥有输出游标；半截协议和操作结果暂存，普通文本不再等待模型结束。 */
function createGameChatStream({ callbacks, filterText, isUnsafe, currentGame, signal }) {
    let message = '';
    let reasoning = '';
    let voiceSource = '';
    let voicePhase = 'answer';
    let voice = createMarkdownSentenceStream();
    let ended = false;
    const spoken = [];
    const current = () => !ended && !signal?.aborted;
    const emitSentences = segments => {
        for (const segment of segments) {
            if (!current()) return;
            spoken.push({ text: segment.text, phase: voicePhase });
            callbacks.onSentence?.(segment.text, message, reasoning, voiceSource, voicePhase, segment.subtitle);
        }
    };
    const appendVoice = (text, phase) => {
        if (!text || !current()) return;
        if (voicePhase !== phase) {
            emitSentences(voice.finish());
            voice = createMarkdownSentenceStream();
            voicePhase = phase;
            voiceSource = '';
        }
        voiceSource += text;
        emitSentences(voice.push(text));
    };
    const publish = (next, nextReasoning = reasoning, speak = true) => {
        if (!current()) return;
        const delta = next.startsWith(message) ? next.slice(message.length) : '';
        const replace = !next.startsWith(message);
        const changed = next !== message || nextReasoning !== reasoning;
        message = next; reasoning = nextReasoning;
        if (changed) callbacks.onChunk?.(delta, message, reasoning, { replace });
        if (delta && speak) appendVoice(delta, 'answer');
    };

    function beginTurn({ blocked = false } = {}) {
        let raw = '';
        let published = '';
        let hold = blocked;
        let reasoningPrefix = '';
        const base = message;
        const game = currentGame();
        const protocol = game
            ? /(?:^|\n)\s*(?:Game:|GameUser:|GameAI:)|<Game:/u
            : /(?:^|\n)\s*Game:|<Game:/u;
        return {
            onStatus(status) {
                if (current()) callbacks.onStatus?.(status);
            },
            onVideos(event) {
                if(current())callbacks.onVideos?.(event);
            },
            onImages(event) {
                if (current()) callbacks.onImages?.(event);
            },
            onChunk(chunk, fullMessage, fullReasoning) {
                if (!current() || hold) return;
                raw = typeof fullMessage === 'string' ? fullMessage : raw + String(chunk || '');
                // 同块已出现调用时，不先漏出该块中的预写叙述。调用依旧由原GM循环统一执行。
                if (protocol.test(raw) || isUnsafe(raw)) { hold = true; return; }
                let safe = filterText(raw, false, game);
                const lineStart = Math.max(safe.lastIndexOf('\n'), safe.lastIndexOf('。'),
                    safe.lastIndexOf('！'), safe.lastIndexOf('？')) + 1;
                const tail = safe.slice(lineStart);
                // 对“我下…”等可能尚未收齐的声明保留局部前瞻；完整普通句立即放行。
                const possibleClaim = tail.search(/我|你|用户|玩家|AI|黑棋|白棋|已|落子|棋步|棋盘|棋局|五连|下|落/u);
                if (possibleClaim >= 0) safe = safe.slice(0, lineStart + possibleClaim);
                if (!safe.startsWith(published)) return;
                published = safe;
                const safeReasoning = filterText(fullReasoning || '', false, game);
                if (!raw && safeReasoning.startsWith(reasoningPrefix) && !isUnsafe(safeReasoning)) {
                    appendVoice(safeReasoning.slice(reasoningPrefix.length), 'think');
                    reasoningPrefix = safeReasoning;
                }
                publish(base + safe, safeReasoning);
            },
        };
    }

    function finish(text, nextReasoning, speech, history, gameTrace) {
        if (!current()) return { success: false, error: '聊天已取消' };
        publish(text, nextReasoning, false);
        // 按阶段用最终正文补尚未投递的句子；已排队的思考和答案不重播，未发布尾段允许被纠正。
        const target = speech || text;
        const finalAnswer = nextReasoning && target.startsWith(nextReasoning) ? target.slice(nextReasoning.length) : target;
        const flushPhase = (phase, value) => {
            if (!value) return;
            const finalVoice = createMarkdownSentenceStream();
            const segments = [...finalVoice.push(value), ...finalVoice.finish()];
            const issued = spoken.filter(item => item.phase === phase).map(item => item.text);
            let consumed = 0;
            voicePhase = phase; voiceSource = value;
            for (const segment of segments) {
                if (consumed < issued.length && segment.text === issued[consumed]) { consumed += 1; continue; }
                emitSentences([segment]);
            }
        };
        flushPhase('think', nextReasoning);
        flushPhase('answer', finalAnswer);
        ended = true;
        callbacks.onComplete?.(text, history, nextReasoning, target, gameTrace);
        return { success: true, message: text, reasoning: nextReasoning, speech: target, history };
    }

    return { beginTurn, finish, confirm: (text, nextReasoning) => publish(text, filterText(nextReasoning || '', true, currentGame())) };
}

module.exports = { createGameChatStream };
