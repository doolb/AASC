'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeTtsPauseText } = require('../media/tts-text-normalizer');
const publicRoot = path.resolve(__dirname, '../../../web-mediacenter/ui/public');
// 复用正式端有限字典；启动时预加载纯解析模块，不执行回复里的MPL代码。
const parser = import('../../../web-mediacenter/ui/public/js/mmd-reply-parser.mjs');
const catalog = fs.readFile(path.join(publicRoot, 'mmd-actions.json'), 'utf8')
    .then(bytes => JSON.parse(bytes).actions?.map(item => item.name) || []).catch(() => []);

async function generateChatTtsActions({ sentence, phase = 'answer', conversationId = '', subtitle = null, stripMarkdown, generate, send }) {
    let ttsAction = null;
    let speech = stripMarkdown(sentence);
    if (phase === 'answer') {
        try {
            const parsed = (await parser).parseReply(sentence, { actions: await catalog });
            const clean = value => normalizeTtsPauseText(stripMarkdown(value));
            speech = clean(parsed.speech);
            const events = parsed.events.filter(event => event.kind !== 'mpl').map(event => ({ ...event,
                offset: Array.from(clean(Array.from(parsed.speech).slice(0, event.offset).join(''))).length }));
            if (events.length) {
                ttsAction = { id: randomUUID(), text: sentence, speech, phase, conversationId, events };
                send({ type: 'tts', action: 'prepareActions', ttsAction });
            }
        } catch { /* 解析失败使用原朗读路径；动作错误不能阻断TTS。 */ }
    }
    try {
        const audioPath = speech.trim() ? await generate(speech) : null;
        if (audioPath === null) {
            if (ttsAction) send({ type: 'tts', action: 'cancelActions', ttsAction });
            return null;
        }
        return { audioPath, sentence, speech, subtitle: { markdown: subtitle?.markdown || sentence, speech, offset: subtitle?.offset || 0 },
            ...(ttsAction ? { ttsAction } : {}) };
    } catch (error) {
        if (ttsAction) send({ type: 'tts', action: 'cancelActions', ttsAction });
        throw error;
    }
}

module.exports = { generateChatTtsActions };
