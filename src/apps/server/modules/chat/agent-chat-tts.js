'use strict';

const path = require('node:path');

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
    onError
}) {
    let sentences = splitIntoSentences(message);
    if (sentences.length === 0 && message) sentences = [message];

    for (const sentence of sentences) {
        try {
            const cleanText = stripMarkdown(sentence);
            const audioPath = await generateTTS(cleanText);
            const audioUrl = `/uploads/tts/${path.basename(audioPath)}`;
            const audioMessage = {
                type: 'tts',
                action: 'playAudio',
                audioUrl,
                text: sentence
            };

            if (playOnControl) {
                sendToControl({ type: 'playOnControl', audioUrl, text: sentence });
            } else if (displayIds.length > 0) {
                for (const targetId of displayIds) sendToDisplay(targetId, audioMessage);
            } else if (displayId) {
                sendToDisplay(displayId, audioMessage);
            }
        } catch (error) {
            if (onError) onError(error, sentence);
        }
    }
}

/**
 * 创建与普通 LLM chatStream.onSentence 对齐的 Agent 流式 TTS 处理器。
 *
 * Agent bridge 只提供 onChunk/onComplete，因此在这里累积未结束文本，
 * 将已确认的完整句子放入串行队列，并在完成事件中冲刷最后一个片段。
 */
function createAgentTtsStream(options) {
    const { splitIntoSentences, onError } = options;
    let pendingText = '';
    let ttsQueue = Promise.resolve();

    const enqueueSentence = (sentence) => {
        if (!sentence || !sentence.trim()) return;
        ttsQueue = ttsQueue.then(() => playAgentTts({
            ...options,
            message: sentence
        })).catch((error) => {
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
            await ttsQueue;
        }
    };
}

module.exports = { createAgentTtsStream, playAgentTts };
