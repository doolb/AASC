'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeProxyUrl, normalizeWebProxyList, migrateLegacyProxyConfig,
    resolveSourceProxyUrl, axiosProxyOptions, MAX_PROXIES, LEGACY_PROXY_ID
} = require('../src/apps/server/modules/media/web-proxy');

test('normalizeProxyUrl 接受 HTTP/HTTPS/SOCKS5 并去掉末尾斜杠', () => {
    assert.equal(normalizeProxyUrl(''), '');
    assert.equal(normalizeProxyUrl('http://127.0.0.1:7890/'), 'http://127.0.0.1:7890');
    assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
    assert.equal(normalizeProxyUrl('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
});

test('normalizeProxyUrl 拒绝非法协议和查询参数', () => {
    assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:21'), /HTTP\/HTTPS\/SOCKS5/);
    assert.throws(() => normalizeProxyUrl('http://127.0.0.1:7890/?a=1'), /查询参数/);
});

test('normalizeWebProxyList 过滤非法项并限制最大数量', () => {
    const list = normalizeWebProxyList([
        { id: 'p1', name: ' 公司代理 ', url: 'http://127.0.0.1:7890/' },
        { id: '', name: '缺少 ID', url: 'http://127.0.0.1:1080' },
        { id: 'p3', name: '非法协议', url: 'ftp://127.0.0.1:21' },
        null
    ]);
    assert.deepEqual(list, [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }]);
    const many = Array.from({ length: MAX_PROXIES + 5 }, (_, index) => (
        { id: `p${index}`, name: `代理${index}`, url: 'http://127.0.0.1:7890' }
    ));
    assert.equal(normalizeWebProxyList(many).length, MAX_PROXIES);
    assert.deepEqual(normalizeWebProxyList(null), []);
});

test('migrateLegacyProxyConfig 把旧布尔开关迁移为命名代理选择', () => {
    const migrated = migrateLegacyProxyConfig({
        globalProxy: 'socks5://127.0.0.1:1080/',
        switches: { bilibili: true, youtube: false, hongguo: true }
    });
    assert.deepEqual(migrated.proxies, [
        { id: LEGACY_PROXY_ID, name: '默认代理', url: 'socks5://127.0.0.1:1080' }
    ]);
    assert.deepEqual(migrated.selections, {
        bilibili: LEGACY_PROXY_ID,
        youtube: '',
        hongguo: LEGACY_PROXY_ID
    });
    assert.equal(migrated.legacyUrl, 'socks5://127.0.0.1:1080');
});

test('migrateLegacyProxyConfig 在全局代理为空或非法时清空所有选择', () => {
    assert.deepEqual(
        migrateLegacyProxyConfig({ globalProxy: 'not-a-url', switches: { bilibili: true } }).selections,
        { bilibili: '' }
    );
    const empty = migrateLegacyProxyConfig({ globalProxy: '', switches: { bilibili: true, quark: false } });
    assert.deepEqual(empty.proxies, []);
    assert.deepEqual(empty.selections, { bilibili: '', quark: '' });
    assert.equal(empty.legacyUrl, '');
});

test('resolveSourceProxyUrl 按来源选择命名代理', () => {
    const proxies = [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890/' }];
    assert.equal(
        resolveSourceProxyUrl({ proxies, selections: { bilibili: 'p1' }, sourceId: 'bilibili' }),
        'http://127.0.0.1:7890'
    );
    assert.equal(resolveSourceProxyUrl({ proxies, selections: {}, sourceId: 'bilibili' }), '');
    assert.equal(resolveSourceProxyUrl({ proxies, selections: { bilibili: '' }, sourceId: 'bilibili' }), '');
    assert.equal(resolveSourceProxyUrl({ proxies, selections: { bilibili: 'missing' }, sourceId: 'bilibili' }), '');
    assert.equal(resolveSourceProxyUrl({ proxies, selections: { bilibili: 'p1' }, sourceId: '' }), '');
    assert.equal(resolveSourceProxyUrl({}), '');
});

test('resolveSourceProxyUrl 暂时兼容现有全局代理调用方', () => {
    const base = { globalProxy: 'http://127.0.0.1:7890', sourceId: 'youtube' };
    assert.equal(resolveSourceProxyUrl({ ...base, switches: {}, proxyDefault: true }), 'http://127.0.0.1:7890');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: { youtube: false }, proxyDefault: true }), '');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: { youtube: true }, proxyDefault: false }), 'http://127.0.0.1:7890');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: {}, proxyDefault: false }), '');
    assert.throws(() => resolveSourceProxyUrl({
        globalProxy: 'not-a-url', switches: { bilibili: true }, sourceId: 'bilibili'
    }), /代理地址格式无效/);
});

test('resolveSourceProxyUrl 混合参数时优先使用命名代理模型', () => {
    assert.equal(resolveSourceProxyUrl({
        globalProxy: 'not-a-url',
        switches: { bilibili: true },
        proxies: [{ id: 'named', name: '命名代理', url: 'https://proxy.example:8443/' }],
        selections: { bilibili: 'named' },
        sourceId: 'bilibili'
    }), 'https://proxy.example:8443');
    assert.equal(resolveSourceProxyUrl({
        globalProxy: 'http://127.0.0.1:7890',
        switches: { bilibili: true },
        proxies: [],
        selections: { bilibili: 'missing' },
        sourceId: 'bilibili'
    }), '');
});

test('resolveSourceProxyUrl 对持久化非法地址降级为空代理', () => {
    assert.equal(resolveSourceProxyUrl({
        proxies: [{ id: 'p1', name: '坏代理', url: 'not-a-url' }],
        selections: { bilibili: 'p1' },
        sourceId: 'bilibili'
    }), '');
});

test('axiosProxyOptions 为代理请求关闭 axios 默认代理并返回 agent', () => {
    const options = axiosProxyOptions('socks5://127.0.0.1:1080');
    assert.equal(options.proxy, false);
    assert.ok(options.httpAgent);
    assert.ok(options.httpsAgent);
    assert.deepEqual(axiosProxyOptions(''), {});
});
