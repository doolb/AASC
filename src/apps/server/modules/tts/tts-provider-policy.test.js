'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    BUSINESS_TYPES,
    normalizeVoiceConfig,
    resolveProviderConfig,
    validateBusinessProvider
} = require('./tts-provider-policy');

test('AI 回复切换Provider后使用新Provider音色，不跨服务继承', () => {
    assert.deepEqual(resolveProviderConfig({
        businessType: BUSINESS_TYPES.AI_REPLY,
        templateTts: { provider: 'qwen-chat' },
        aiReplyDefault: { provider: 'qwen-api', voice: 'longxiaochun' },
        providers: { 'qwen-chat': { defaultVoice: 'web-voice' } }
    }), { provider: 'qwen-chat', voice: 'web-voice' });
});

test('AI 回复默认继承系统 AI 配置', () => {
    assert.deepEqual(resolveProviderConfig({
        businessType: BUSINESS_TYPES.AI_REPLY,
        aiReplyDefault: { provider: 'doubao-api', voice: 'voice-a' }
    }), { provider: 'doubao-api', voice: 'voice-a' });
});

test('系统播报允许qwen-chat且仍拒绝豆包网页', () => {
    assert.deepEqual(resolveProviderConfig({
        businessType: BUSINESS_TYPES.SYSTEM_BROADCAST,
        systemBroadcast: { provider: 'qwen-api', voice: 'voice-a' }
    }), { provider: 'qwen-api', voice: 'voice-a' });
    for (const business of Object.values(BUSINESS_TYPES)) {
        assert.equal(validateBusinessProvider('qwen-chat', business), 'qwen-chat');
    }
    assert.throws(() => validateBusinessProvider('doubao-chat', BUSINESS_TYPES.SYSTEM_BROADCAST), /仅允许/u);
    assert.throws(() => validateBusinessProvider('qwen-chat', 'unknown'), /不支持/u);
    assert.deepEqual(resolveProviderConfig({ businessType: BUSINESS_TYPES.TEXT_MEDIA,
        textMedia: { provider: 'qwen-chat', voice: 'reading-voice' },
        systemBroadcast: { provider: 'qwen-api', voice: 'other-voice' }
    }), { provider: 'qwen-chat', voice: 'reading-voice' });
});

test('无效 Provider 拒绝且空 voice 归一为 null', () => {
    assert.throws(() => normalizeVoiceConfig({ provider: 'unknown' }), /不支持/u);
    assert.deepEqual(normalizeVoiceConfig({ provider: 'system', voice: '  ' }), { provider: 'system', voice: null });
});
