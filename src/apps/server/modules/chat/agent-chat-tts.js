'use strict';

const path = require('node:path');
const { createOrderedTaskScheduler } = require('../media/ordered-task-scheduler');
const { isPunctuationOnly } = require('../../../../core/utils/sentence-splitter');
const { generateChatTtsActions } = require('./chat-tts-actions');
const { createMarkdownSentenceStream, splitSpeechSegments, toSpeechText } = require('../../../../core/utils/markdown-speech');

/**
 * 为工作 AI 角色的完整回复生成 TTS，并沿用普通 LLM 的播放目标优先级。
 * TTS 是回复完成后的附加能力，单句失败不能阻断文字回复或后续句子。
 */
async function playAgentTts({
    message,
    subtitle = null,
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
    const segments = splitSpeechSegments(message, { strip: text => toSpeechText(text, { preserveActions: true }), split: splitIntoSentences })
        .filter(segment => !isPunctuationOnly(segment.text));
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

    const tasks = segments.map(({ text: sentence, subtitle: caption }) => scheduler.enqueue(async () => {
            if (!isTtsCurrent(chatTtsPhase) || (isTtsSuppressed() && !allowRepairModeTts)) return null;
            return generateChatTtsActions({ sentence, subtitle: subtitle || caption, phase: chatTtsPhase, conversationId: chatTtsConversationId,
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
                ...(result.subtitle ? { subtitle: result.subtitle, speech: result.speech } : {}),
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
    const stream = createMarkdownSentenceStream();
    let sawChunks = false;
    let finished = false;
    const ttsScheduler = options.ttsScheduler || createOrderedTaskScheduler({ concurrency: options.ttsConcurrency || 1 });
    const enqueue = segments => {
        for (const segment of segments) {
            if (!segment.text.trim()) continue;
            void playAgentTts({ ...options, message: segment.text, subtitle: segment.subtitle, ttsScheduler })
                .catch(error => onError?.(error, segment.text));
        }
    };
    return {
        onChunk(chunk) {
            if (finished || !chunk) return;
            sawChunks = true;
            enqueue(stream.push(chunk));
        },
        async onComplete(message) {
            if (finished) return;
            finished = true;
            if (!sawChunks && typeof message === 'string') enqueue(stream.push(message));
            enqueue(stream.finish());
            await ttsScheduler.waitForIdle();
        }
    };
}

module.exports = { createAgentTtsStream, playAgentTts };
