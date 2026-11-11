'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');

test('register 透传地区、能力与代理默认值', () => {
    const registry = new TaskMediaProviderRegistry();
    registry.register('owner', {
        id: 'youtube', name: 'YouTube', region: 'overseas',
        features: ['home', 'search', 'stream', 'unknown'], proxyDefault: true,
        defaultConfig: { a: 1 }, create: () => ({})
    });
    assert.deepEqual(registry.list(), [{
        id: 'youtube', name: 'YouTube', region: 'overseas',
        features: ['home', 'search', 'stream'], proxyDefault: true
    }]);
});

test('register preserves private region without changing domestic fallback', () => {
    const registry = new TaskMediaProviderRegistry();
    registry.register('owner', { id: 'private-test', name: '测试', region: 'private', create: () => ({}) });
    registry.register('other', { id: 'fallback-test', name: '回退', region: 'invalid', create: () => ({}) });
    assert.equal(registry.get('private-test').region, 'private');
    assert.equal(registry.get('fallback-test').region, 'domestic');
});

test('register 默认国内且拒绝重复 ID', () => {
    const registry = new TaskMediaProviderRegistry();
    const unregister = registry.register('owner', { id: 'hongguo', name: '红果短剧', create: () => ({}) });
    assert.equal(registry.get('hongguo').region, 'domestic');
    assert.throws(() => registry.register('owner2', { id: 'hongguo', name: '重复', create: () => ({}) }), /已注册/);
    unregister();
    assert.equal(registry.get('hongguo'), undefined);
});
