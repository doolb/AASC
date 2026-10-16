'use strict';

// 对应.src/framework/qwen-tts-fixed-models.md：两路底层模型由代码统一定义，配置和映射不能替换。
const QWEN_AUDIO_31_MODEL = 'qwen-audio-3.1-tts-flash';
const QWEN_WEB_TTS_MODEL = 'QUARK_VOICE';
const QWEN_API_DEFAULT_VOICE = 'qiaoxiaojiao_v3.1';
const FIXED_QWEN_TTS_MODELS = Object.freeze({ 'qwen-api': QWEN_AUDIO_31_MODEL, 'qwen-chat': QWEN_WEB_TTS_MODEL });
const LEGACY_API_VOICES = new Set(['Cherry', 'Ethan', 'Chelsie', 'Serena']);
const normalizeQwenApiVoice = voice => LEGACY_API_VOICES.has(voice) ? QWEN_API_DEFAULT_VOICE : voice;

function assertFixedQwenTtsModel(providerId, model) {
    const fixed = ({ qwen: QWEN_WEB_TTS_MODEL, 'qwen-chat': QWEN_WEB_TTS_MODEL, 'qwen-api': QWEN_AUDIO_31_MODEL })[providerId];
    if (fixed && model !== fixed) throw Object.assign(new Error(`千问TTS底层模型固定为 ${fixed}`), {
        statusCode: 400, code: 'unsupported_speech_model'
    });
}

module.exports = { QWEN_AUDIO_31_MODEL, QWEN_WEB_TTS_MODEL, QWEN_API_DEFAULT_VOICE,
    FIXED_QWEN_TTS_MODELS, normalizeQwenApiVoice, assertFixedQwenTtsModel };
