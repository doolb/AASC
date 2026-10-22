'use strict';
const { splitSpeechSegments } = require('../../../../core/utils/markdown-speech');

// 控制端和显示端共享手动重播；显示端目标只取服务器登记身份，生成取消后丢弃迟到结果。
function createManualChatTtsService({ split, strip, resolveOptions, scheduler, generate, toAudioUrl,
    send, capabilities, broadcast, suppressed, onError }) {
    const active = new WeakMap();
    const displayTokens = new Set();
    const notify = (ws, requestId, status, extra = {}) => {
        if (requestId && (!('readyState' in ws) || ws.readyState === 1)) {
            ws.send(JSON.stringify({ type: 'chatTtsPlayback', requestId, status, ...extra }));
        }
    };
    const stop = ws => {
        const token = active.get(ws);
        if (!token) return;
        token.cancelled = true;
        token.controller.abort();
        active.delete(ws);
        displayTokens.delete(token);
        notify(ws, token.requestId, 'cancelled');
    };
    const stopTargets = (targets = null, { conversationId = null, phase = null } = {}) => {
        for (const token of displayTokens) {
            if (targets && !targets.includes(token.sourceDisplayId)) continue;
            if (conversationId && token.conversationId !== conversationId) continue;
            if (phase && phase !== 'answer') continue;
            stop(token.ws);
        }
    };
    async function play(data, { ws, displayId = null, sourceDisplayId = null }) {
        if (sourceDisplayId) stop(ws);
        const requestId = typeof data.requestId === 'string' && data.requestId.length <= 128 ? data.requestId : null;
        const token = { controller: new AbortController(), cancelled: false, requestId, ws, sourceDisplayId,
            conversationId: data.chatTtsConversationId };
        if (sourceDisplayId) { active.set(ws, token); displayTokens.add(token); }
        const current = () => !token.cancelled && !suppressed() && (!('readyState' in ws) || ws.readyState === 1);
        try {
            if (!current()) { notify(ws, requestId, 'cancelled'); return; }
            if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 100000) throw new Error('语音正文无效');
            const segments = splitSpeechSegments(data.text, { strip, split });
            const sentences = segments.map(segment => segment.text);
            const subtitles = segments.map(segment => segment.subtitle);
            const targets = sourceDisplayId ? [sourceDisplayId] : data.displayIds || (displayId ? [displayId] : []);
            const preferred = targets[0] || displayId;
            const options = { ...resolveOptions(data.chatReplyContext), signal: token.controller.signal };
            const queue = scheduler(preferred, options);
            let audioCount = 0;
            notify(ws, requestId, 'generating');
            await Promise.all(sentences.map((sentence, index) => queue.enqueue(async () => {
                if (!current()) return null;
                let reference;
                try { reference = await generate(sentence, preferred, options); }
                catch (error) {
                    // 只附加批内序号供脱敏诊断，正文仍由原播放消息携带，不进入错误日志。
                    if (error && typeof error === 'object' && Object.isExtensible(error)) error.manualTtsSegmentIndex = index;
                    throw error;
                }
                return reference === null ? null : { sentence, reference };
            }).then(result => {
                if (!result || !current()) return;
                audioCount++;
                const message = { type: 'tts', action: 'playAudio', text: result.sentence, audioUrl: toAudioUrl(result.reference),
                    subtitle: subtitles[index], speech: result.sentence,
                    ...(requestId ? { manualTtsRequestId: requestId, manualTtsLast: index === sentences.length - 1 } : {}),
                    ...(data.chatTtsConversationId ? { chatTtsConversationId: data.chatTtsConversationId, chatTtsPhase: 'answer' } : {}) };
                if (!sourceDisplayId && data.playOnControl) {
                    ws.send(JSON.stringify({ ...message, type: 'playOnControl' }));
                    return;
                }
                if (!sourceDisplayId && data.broadcastAll) {
                    broadcast(message);
                    return;
                }
                for (const target of targets) {
                    if (sourceDisplayId || capabilities(target)?.voicePlayback) send(target, message);
                }
            })));
            if (current()) notify(ws, requestId, 'queued', { audioCount });
        } catch (error) {
            if (current()) {
                onError(error);
                notify(ws, requestId, 'error', { message: '语音生成失败，请检查语音服务或账号配置' });
            }
            token.cancelled = true;
            token.controller.abort();
        } finally {
            if (active.get(ws) === token) active.delete(ws);
            displayTokens.delete(token);
        }
    }
    return { play, stop, stopTargets };
}
module.exports = { createManualChatTtsService };
