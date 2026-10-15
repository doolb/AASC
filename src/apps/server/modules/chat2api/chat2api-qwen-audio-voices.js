'use strict';
const catalog = require('./qwen-audio-31-voices.json');
const QWEN_AUDIO_31_MODEL = 'qwen-audio-3.1-tts-flash';

// 对应.src/framework/tts-provider-configuration.md：仅保存官方3.1段公开目录，ID大小写不可改写。
const voices = catalog.voices;
if (catalog.model !== QWEN_AUDIO_31_MODEL || voices.length !== 68
    || new Set(voices.map(voice => voice.id)).size !== voices.length
    || voices.some(voice => !voice.id.endsWith('_v3.1') || !voice.name
        || !['female', 'male'].includes(voice.gender) || !Array.isArray(voice.tags) || !Array.isArray(voice.languages))) {
    throw new Error('Qwen Audio 3.1音色目录格式无效或重复');
}

function listQwenAudio31Voices() {
    // 查询方可自由筛选或修改返回值，不能污染下一次目录与其他控制端。
    return voices.map(voice => ({ ...voice, tags: [...voice.tags], languages: [...voice.languages], available: true }));
}

module.exports = { QWEN_AUDIO_31_MODEL, listQwenAudio31Voices };
