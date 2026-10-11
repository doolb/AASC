'use strict';

// qwen-chat仅转交合成参数；账号、签名和上游连接均由Chat2API管理。
function createQwenChatProvider({ speechService } = {}) {
    return {
        async generate(request, settings) {
            if (!settings.enabled) throw new Error('TTS Provider 未启用，请先保存配置');
            if (!speechService) throw new Error('Chat2API 语音服务不可用');
            const result = await speechService.generate({ input: request.text, model: settings.model,
                voice: request.voice, speed: Math.pow(2, request.speed / 10), volume: request.volume }, { timeoutMs: request.timeoutMs });
            return result.audio;
        },
        async voices() { return [{ id: 'zh_female_quarkF531S0_ptts', name: '千问默认女声', available: true }]; }
    };
}

module.exports = { createQwenChatProvider };
