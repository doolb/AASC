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

test('系统播报限制 Provider 范围并拒绝 qwen-chat', () => {
    assert.deepEqual(resolveProviderConfig({
        businessType: BUSINESS_TYPES.SYSTEM_BROADCAST,
        systemBroadcast: { provider: 'qwen-api', voice: 'voice-a' }
    }), { provider: 'qwen-api', voice: 'voice-a' });
    assert.throws(() => validateBusinessProvider('qwen-chat', BUSINESS_TYPES.SYSTEM_BROADCAST), /仅允许/u);
});

test('无效 Provider 拒绝且空 voice 归一为 null', () => {
    assert.throws(() => normalizeVoiceConfig({ provider: 'unknown' }), /不支持/u);
    assert.deepEqual(normalizeVoiceConfig({ provider: 'system', voice: '  ' }), { provider: 'system', voice: null });
});
