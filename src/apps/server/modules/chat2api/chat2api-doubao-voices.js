'use strict';
const catalog = require('./doubao-chat-voices.json');

// 目录来自官网当前界面快照，只包含公开音色字段；查询不依赖账号、不访问上游。
const voices = Object.entries(catalog).flatMap(([gender, entries]) => entries.map(entry => ({
    id: entry.style_id, style_id: entry.style_id, name: entry.name, gender, tags: entry.tags
})));
const ids = new Set(voices.map(voice => voice.id));
if (ids.size !== voices.length || voices.some(voice => !voice.id || !voice.name || !Array.isArray(voice.tags))) {
    throw new Error('豆包音色目录格式无效或存在重复音色');
}

function listDoubaoVoices() {
    return voices.map(voice => ({ ...voice, tags: [...voice.tags] }));
}

function validateDoubaoVoice(voice) {
    if (typeof voice !== 'string' || !ids.has(voice)) {
        throw Object.assign(new Error('豆包网页音色不在支持目录中'), { statusCode: 400, code: 'invalid_speech_request' });
    }
    return voice;
}

module.exports = { listDoubaoVoices, validateDoubaoVoice };
