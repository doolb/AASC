'use strict';

const { filterQwenChatSpeechText } = require('./qwen-chat-text-filter');
const { QWEN_WEB_TTS_MODEL } = require('../chat2api/chat2api-qwen-tts-models');

// qwen-chat过滤emoji后转交合成参数；账号、签名和上游连接均由Chat2API管理。
function createQwenChatProvider({ speechService } = {}) {
    return {
        async generate(request, settings) {
            const text = filterQwenChatSpeechText(request.text);
            if (!text) return null;
            if (!speechService) throw new Error('Chat2API 语音服务不可用');
            const explicit=request.parameterOverrides||{...(request.voice?{voice:request.voice}:{}),speed:Math.pow(2,request.speed/10),volume:request.volume};
            const result = await speechService.generate({ input: text, ...explicit, model: QWEN_WEB_TTS_MODEL }, { timeoutMs: request.timeoutMs,signal:request.signal,parameterDefaults:request.parameterDefaults,expectedProviderId:'qwen' });
            return result.audio;
        },
        async voices() { return [{ id: 'zh_female_quarkF531S0_ptts', name: '千问默认女声', available: true }]; }
    };
}

module.exports = { createQwenChatProvider };
