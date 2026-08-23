'use strict';

// 统一从文件名推断可播放媒体类型，供普通上传和媒体列表共用，避免各入口的文本协议字段不一致。
function detectMediaType(name) {
    const ext = name.toLowerCase().split('.').pop().split('?')[0];
    if (['gif'].includes(ext)) return 'gif';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
    if (['wav', 'ogg', 'mp3'].includes(ext)) return 'audio';
    if (['txt', 'md'].includes(ext)) return 'text';
    return 'image';
}

function detectTextFormat(name) {
    const ext = name.toLowerCase().split('.').pop().split('?')[0];
    if (ext === 'md') return 'markdown';
    if (ext === 'txt') return 'plain';
    return undefined;
}

function getTextMimeType(name) {
    return detectTextFormat(name) === 'markdown' ? 'text/markdown' : 'text/plain';
}

// 普通上传实际下发给显示端的消息在这里构造，非文本媒体不附加文本专属字段。
function createUploadedMediaData({ url, fileName, timestamp }) {
    const mediaType = detectMediaType(fileName);
    return {
        type: 'url',
        url,
        fileName,
        mediaType,
        ...(mediaType === 'text' ? {
            format: detectTextFormat(fileName),
            mimeType: getTextMimeType(fileName)
        } : {}),
        timestamp
    };
}

module.exports = {
    detectMediaType,
    detectTextFormat,
    getTextMimeType,
    createUploadedMediaData
};
