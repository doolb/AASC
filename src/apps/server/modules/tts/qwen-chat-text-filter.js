'use strict';

// 对应.src/framework/tts-provider-configuration.md：按字素簇移除整组表情，
// 避免肤色、家庭连接符、国旗和键帽拆开后留下不能朗读的字符。
const graphemeSegmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const emojiPattern = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]|[#*0-9]\uFE0F?\u20E3/u;
const readablePattern = /[\p{L}\p{N}]/u;

function filterQwenChatSpeechText(text) {
    const filtered = Array.from(graphemeSegmenter.segment(text), ({ segment }) =>
        emojiPattern.test(segment) ? '' : segment).join('').trim();
    // 空白、标点及装饰符号没有正文时跳过，不向千问请求空音频。
    return readablePattern.test(filtered) ? filtered : '';
}

module.exports = { filterQwenChatSpeechText };
