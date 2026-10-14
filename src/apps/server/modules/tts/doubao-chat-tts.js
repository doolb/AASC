'use strict';
const { DOUBAO_SPEECH_VOICE } = require('../chat2api/chat2api-doubao-speech-protocol');

// 业务薄层不选择/保存账号；上游使用固定网页语速和音量，返回后只应用全局音量。
function createDoubaoChatProvider({ speechService } = {}) {
    return {
        async generate(request, settings) {
            if (!settings.enabled) throw new Error('豆包网页朗读尚未启用，请先保存配置');
            if (request.voice !== undefined && request.voice !== null && request.voice !== DOUBAO_SPEECH_VOICE) throw new Error('豆包网页朗读仅支持网页默认音色');
            if (!speechService) throw new Error('Chat2API语音服务不可用');
            const result = await speechService.generate({ input: request.text, model: 'doubao-chat',
                voice: DOUBAO_SPEECH_VOICE, speed: 1, volume: 100, response_format: 'wav' },
                { timeoutMs: request.timeoutMs, ...(request.signal ? { signal: request.signal } : {}) });
            return result.audio;
        },
        // 静态网页默认值，查询不发送上游请求；available=false明确表示未做新的真实账号合成验收。
        async voices() { return [{ id: DOUBAO_SPEECH_VOICE, name: '网页默认女声（实验，待真实验收）', available: false }]; }
    };
}
module.exports = { createDoubaoChatProvider };
