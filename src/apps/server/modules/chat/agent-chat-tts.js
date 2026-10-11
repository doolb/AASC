'use strict';

const path = require('node:path');
const { createOrderedTaskScheduler } = require('../media/ordered-task-scheduler');
const { isPunctuationOnly } = require('../../../../core/utils/sentence-splitter');
const { generateChatTtsActions } = require('./chat-tts-actions');

/**
 * 为工作 AI 角色的完整回复生成 TTS，并沿用普通 LLM 的播放目标优先级。
 * TTS 是回复完成后的附加能力，单句失败不能阻断文字回复或后续句子。
 */
async function playAgentTts({
    message,
    playOnControl = false,
    displayId,
    displayIds = [],
    splitIntoSentences,
    stripMarkdown,
    generateTTS,
    sendToControl,
    sendToDisplay,
    onError,
    ttsScheduler = null,
    ttsConcurrency = 1,
    isTtsSuppressed = () => false,
    allowRepairModeTts = false,
    getDisplayIds = null,
    resolveDisplayId = null,
    chatTtsConversationId = null,
    chatTtsPhase = 'answer',
    isTtsCurrent = () => true
}) {
    let sentences = splitIntoSentences(message).filter((sentence) => !isPunctuationOnly(sentence));
    if (sentences.length === 0 && message && !isPunctuationOnly(message)) sentences = [message];
    const scheduler = ttsScheduler || createOrderedTaskScheduler({ concurrency: ttsConcurrency });
    // 准备和播放共用既有动态路由；目标改变时最终音频仍携带完整同句元数据。
    const deliver = audioMessage => {
        const resolved = typeof getDisplayIds === 'function' ? getDisplayIds() : displayIds;
        const targets = Array.isArray(resolved) ? resolved : [];
        const single = typeof resolveDisplayId === 'function';
        const target = single ? resolveDisplayId() : null;
        if (playOnControl) {
            const { action, ...message } = audioMessage;
            sendToControl(action === 'playAudio' ? { ...message, type: 'playOnControl' } : audioMessage);
        }
        else if (target) sendToDisplay(target, audioMessage, { allowRepairModeTts });
        else if (!single && targets.length) for (const id of targets) sendToDisplay(id, audioMessage, { allowRepairModeTts });
        else if (!single && displayId) sendToDisplay(displayId, audioMessage, { allowRepairModeTts });
    };

    const tasks = sentences.map((sentence) => scheduler.enqueue(async () => {
            if (!isTtsCurrent(chatTtsPhase) || (isTtsSuppressed() && !allowRepairModeTts)) return null;
            return generateChatTtsActions({ sentence, phase: chatTtsPhase, conversationId: chatTtsConversationId,
                stripMarkdown, generate: generateTTS, send: deliver });
        }).then((result) => {
            if (!result || !isTtsCurrent(chatTtsPhase) || (isTtsSuppressed() && !allowRepairModeTts)) return;
            const { audioPath, sentence } = result;
            const audioUrl = `/uploads/tts/${path.basename(audioPath)}`;
            const audioMessage = {
                type: 'tts',
                action: 'playAudio',
                audioUrl,
                text: sentence,
                ...(result.ttsAction ? { ttsAction: result.ttsAction } : {}),
                ...(chatTtsConversationId ? { chatTtsConversationId, chatTtsPhase } : {})
            };
            deliver(audioMessage);
        }).catch((error) => {
            if (onError) onError(error, sentence);
        }));
    await Promise.all(tasks);
}

/**
 * 创建与普通 LLM chatStream.onSentence 对齐的 Agent 流式 TTS 处理器。
 *
 * Agent bridge 只提供 onChunk/onComplete，因此在这里累积未结束文本，
 * 将已确认的完整句子放入有序 TTS 调度器，并在完成事件中冲刷最后一个片段。
 */
function createAgentTtsStream(options) {
    const { splitIntoSentences, onError } = options;
    let pendingText = '';
    const ttsScheduler = options.ttsScheduler || createOrderedTaskScheduler({ concurrency: options.ttsConcurrency || 1 });

    const enqueueSentence = (sentence) => {
        if (!sentence || !sentence.trim()) return;
        void playAgentTts({
            ...options,
            message: sentence,
            ttsScheduler
        }).catch((error) => {
            if (onError) onError(error, sentence);
        });
    };

    return {
        onChunk(chunk) {
            if (!chunk) return;
            pendingText += chunk;
            const sentences = splitIntoSentences(pendingText);
            if (sentences.length < 2) return;

            for (const sentence of sentences.slice(0, -1)) {
                enqueueSentence(sentence);
            }
            pendingText = sentences[sentences.length - 1];
        },

        async onComplete(message) {
            const tail = pendingText.trim() || (typeof message === 'string' ? message.trim() : '');
            pendingText = '';
            enqueueSentence(tail);
            await ttsScheduler.waitForIdle();
        }
    };
}

module.exports = { createAgentTtsStream, playAgentTts };
