'use strict';

const AUDIO_MODELS = new Set(['qwen-audio-3.1-tts-flash', 'qwen-audio-3.0-tts-flash', 'qwen-audio-3.0-tts-plus']);
const AUDIO_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const QWEN_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

function isQwenAudioModel(model) {
    return AUDIO_MODELS.has(model);
}

// 官方两种模型系列使用不同路径；只规范化已知官方标准地址，明确自定义代理地址保持。
function resolveQwenEndpoint(endpoint, model) {
    const url = new URL(endpoint);
    const official = url.hostname === 'dashscope.aliyuncs.com'
        || /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/u.test(url.hostname);
    if (official && !url.port && [AUDIO_PATH, QWEN_PATH].includes(url.pathname)) {
        url.pathname = isQwenAudioModel(model) ? AUDIO_PATH : QWEN_PATH;
        return url.href;
    }
    return endpoint;
}

function createQwenInput(request, model) {
    const input = { text: request.text, voice: request.voice };
    return isQwenAudioModel(model)
        ? { ...input, format: 'wav', sample_rate: 24000, rate: request.speed }
        : { ...input, language_type: 'Auto' };
}

module.exports = { isQwenAudioModel, resolveQwenEndpoint, createQwenInput };
