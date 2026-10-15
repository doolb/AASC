'use strict';
const { DOUBAO_SPEECH_VOICE } = require('../chat2api/chat2api-doubao-speech-protocol');
const { listDoubaoVoices, validateDoubaoVoice } = require('../chat2api/chat2api-doubao-voices');
const { filterSpeechText } = require('./tts-speech-text-filter');

// 业务薄层不选择/保存账号；上游使用固定网页语速和音量，返回后只应用全局音量。
function createDoubaoChatProvider({ speechService } = {}) {
    return {
        async generate(request, settings) {
            if (!settings.enabled) throw new Error('豆包网页朗读尚未启用，请先保存配置');
            // 对应.src/framework/tts-provider-configuration.md：纯表情分句不请求上游，避免重播中途失败。
            const text = filterSpeechText(request.text);
            if (!text) return null;
            const voice = validateDoubaoVoice(request.voice ?? settings.defaultVoice ?? DOUBAO_SPEECH_VOICE);
            if (!speechService) throw new Error('Chat2API语音服务不可用');
            const result = await speechService.generate({ input: text, model: 'doubao-chat',
                voice, speed: 1, volume: 100, response_format: 'wav' },
                { timeoutMs: request.timeoutMs, ...(request.signal ? { signal: request.signal } : {}) });
            return result.audio;
        },
        // 静态目录不调用上游；列入目录不等于每一项已完成真实合成验收。
        async voices() { return listDoubaoVoices(); }
    };
}
module.exports = { createDoubaoChatProvider };
