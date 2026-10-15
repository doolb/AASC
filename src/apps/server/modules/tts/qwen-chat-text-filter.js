'use strict';

// 保留千问已有导出，统一实现见.src/framework/tts-provider-configuration.md的网页TTS表情过滤。
const { filterSpeechText } = require('./tts-speech-text-filter');

module.exports = { filterQwenChatSpeechText: filterSpeechText };
