'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeSpeechRequest, decodeSpeechResponse, createTextTtsSession, DOUBAO_SPEECH_VOICE } = require('./chat2api-doubao-speech-protocol');

test('公开protobuf请求字段按官方tag编码，不增加Cookie/token或错误日志字段', () => {
    assert.deepEqual(encodeSpeechRequest({ event: 'StartTask', appkey: 'demo', namespace: 'VoiceGenie', payload: '{}' }),
        Buffer.from([18,4,100,101,109,111,26,10,...Buffer.from('VoiceGenie'),42,9,...Buffer.from('StartTask'),50,2,123,125]));
});
test('响应按公开schema提取任务/事件/音频，忽略原始错误和payload', () => {
    const frame = Buffer.from([10,1,116,26,10,...Buffer.from('VoiceGenie'),34,11,...Buffer.from('TTSResponse'),40,0,50,7,...Buffer.from('private'),66,4,79,103,103,83,82,1,115]);
    const result = decodeSpeechResponse(frame);
    assert.equal(result.task_id, 't'); assert.equal(result.session_id, 's');
    assert.equal(result.event, 'TTSResponse'); assert.equal(result.data.toString(), 'OggS');
    assert.ok(!JSON.stringify(result).includes('private'));
});
test('响应拒绝截断、重复、wire错、非法UTF-8及超限；固定脱敏错误', () => {
    for (const frame of [Buffer.from([34,2,1]), Buffer.from([34,1,65,34,1,66]), Buffer.from([32,1]),
        Buffer.from([34,2,0xc3,0x28]), Buffer.from([0]), Buffer.alloc(1024*1024+1)]) {
        assert.throws(() => decodeSpeechResponse(frame), e => e.code === 'doubao_speech_protocol');
    }
});
test('独立文字会话固定TEXT_TTS=5与网页默认音色，不关联已有对话', () => {
    const result = createTextTtsSession();
    assert.equal(result.request_type, 5); assert.equal(result.conversation_id, ''); assert.equal(result.chat.message_id, '');
    assert.equal(result.chat.new_conversation, true); assert.equal(result.tts.speaker, DOUBAO_SPEECH_VOICE);
    assert.deepEqual(result.tts.audio_config, { bit_rate: 32000, format: 'ogg_opus', sample_rate: 24000 });
});
