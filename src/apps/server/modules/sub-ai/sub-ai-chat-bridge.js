'use strict';
const { createMarkdownSentenceStream } = require('../../../../core/utils/markdown-speech');
const { SUB_AI_PROMPT, parseSubAiReply } = require('./sub-ai-protocol');

/** 包装单次模型请求，游戏续轮仍沿用原桥；注册任务只处理本次真实模型响应。 */
function createSubAiChatBridge(chat, { dispatch, references = [], signal }) {
    const executed = new Set();
    return {
        ...chat,
        async chatStream(content, options, callbacks = {}) {
            const requestSignal = options.signal || signal;
            const clean = (value, complete) => parseSubAiReply(value, complete).text;
            let published = '';
            const voice = createMarkdownSentenceStream();
            const thoughtVoice = createMarkdownSentenceStream();
            let publishedReasoning = '';
            const speakThought = segments => {
                for (const segment of segments) callbacks.onSentence?.(segment.text, published, publishedReasoning, publishedReasoning, 'think', segment.subtitle);
            };
            const speak = segments => {
                for (const segment of segments) callbacks.onSentence?.(segment.text, published, '', published, 'answer', segment.subtitle);
            };
            const response = await chat.chatStream(content, { ...options,
                systemPrompt: [SUB_AI_PROMPT, references.length ? `可用参考图ID：${references.map(i => i.id).join(',')}` : '',
                    options.systemPrompt].filter(Boolean).join('\n\n') }, {
                ...callbacks,
                onChunk(chunk, full, reasoning) {
                    const thought = clean(reasoning, false);
                    if (thought.startsWith(publishedReasoning)) speakThought(thoughtVoice.push(thought.slice(publishedReasoning.length)));
                    publishedReasoning = thought;
                    const next = clean(full, false);
                    const delta = next.startsWith(published) ? next.slice(published.length) : '';
                    published = next;
                    callbacks.onChunk?.(delta, next, clean(reasoning, false));
                    if (delta) speak(voice.push(delta));
                },
                // 原始分句可能把调用行拆开，统一从过滤后的正文重新分句。
                onSentence() {},
                // 完整输出清理完再通知，防止调用行被最终展示或朗读。
                onComplete() {}
            });
            if (!response?.success) return response;
            if (requestSignal?.aborted) return { success: false, cancelled: true, error: '聊天已取消' };
            const parsed = parseSubAiReply(response.message);
            for (const call of parsed.calls) {
                if (requestSignal?.aborted || executed.has(call.raw)) continue;
                executed.add(call.raw);
                await dispatch(call, { references, signal: requestSignal });
            }
            const message = parsed.text.trim() || (parsed.calls.length ? '图片任务已提交。' : response.message);
            const reasoning = clean(response.reasoning, true);
            const speech = clean(response.speech, true).trim() || message;
            if (reasoning.startsWith(publishedReasoning)) speakThought(thoughtVoice.push(reasoning.slice(publishedReasoning.length)));
            speakThought(thoughtVoice.finish());
            if (message.startsWith(published)) speak(voice.push(message.slice(published.length)));
            speak(voice.finish());
            callbacks.onComplete?.(message, response.history, reasoning, speech);
            return { ...response, message, reasoning, speech };
        }
    };
}
module.exports = { createSubAiChatBridge };
