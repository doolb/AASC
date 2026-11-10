'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    ensureWebProxyMigration, createWebProxySettings
} = require('../src/apps/server/modules/media/web-proxy-settings');
const { LEGACY_PROXY_ID } = require('../src/apps/server/modules/media/web-proxy');

// 内存配置模拟 config.get/set 的点路径行为，set 立即生效并返回 true。
function memoryConfig(initial = {}) {
    const data = JSON.parse(JSON.stringify(initial));
    const locate = (key, create) => {
        const keys = key.split('.');
        let obj = data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
                if (!create) return null;
                obj[keys[i]] = {};
            }
            obj = obj[keys[i]];
        }
        return { obj, key: keys[keys.length - 1] };
    };
    return {
        data,
        get(key, fallback) {
            const target = locate(key, false);
            if (!target || !(target.key in target.obj)) return fallback;
            return target.obj[target.key];
        },
        set(key, value) {
            const target = locate(key, true);
            target.obj[target.key] = value;
            return true;
        }
    };
}

test('迁移保留旧全局代理与 true 开关，并且只执行一次', () => {
    const config = memoryConfig({
        network: { globalWebProxy: 'http://127.0.0.1:7890/' },
        media: { providerProxy: { bilibili: true, quark: false } }
    });
    assert.equal(ensureWebProxyMigration(config), true);
    assert.deepEqual(config.data.network.webProxies, [
        { id: LEGACY_PROXY_ID, name: '默认代理', url: 'http://127.0.0.1:7890' }
    ]);
    assert.deepEqual(config.data.media.providerProxy, {
        bilibili: LEGACY_PROXY_ID,
        quark: ''
    });
    assert.equal(config.data.network.globalWebProxy, '');
    assert.equal(ensureWebProxyMigration(config), false);
    assert.equal(config.data.network.webProxies.length, 1);
});

test('迁移在旧全局代理无效时清空选择且不创建代理', () => {
    const config = memoryConfig({
        network: { globalWebProxy: 'ftp://127.0.0.1:21' },
        media: { providerProxy: { bilibili: true, hongguo: true } }
    });
    assert.equal(ensureWebProxyMigration(config), true);
    assert.deepEqual(config.data.network.webProxies, []);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: '', hongguo: '' });
});

test('已有 webProxies 数组时迁移幂等跳过', () => {
    const config = memoryConfig({
        network: { globalWebProxy: 'http://127.0.0.1:7890', webProxies: [] },
        media: { providerProxy: { bilibili: true } }
    });
    assert.equal(ensureWebProxyMigration(config), false);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: true });
});

test('快照附带 B 站与任务源的 proxyId', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: { bilibili: 'p1', hongguo: '' } }
    });
    const settings = createWebProxySettings({
        get: config.get, set: config.set,
        listSources: () => [
            { id: 'bilibili', name: 'B 站视频', region: 'domestic' },
            { id: 'hongguo', name: '红果短剧', region: 'overseas' }
        ]
    });
    const snapshot = settings.snapshot();
    assert.equal(snapshot.type, 'webProxyConfig');
    assert.deepEqual(snapshot.webProxies, config.data.network.webProxies);
    assert.deepEqual(snapshot.sources, [
        { id: 'bilibili', name: 'B 站视频', region: 'domestic', proxyId: 'p1' },
        { id: 'hongguo', name: '红果短剧', region: 'overseas', proxyId: '' }
    ]);
});

test('保存代理列表保留已有 id、给新增项生成 id、清理悬空选择', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '旧代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: { bilibili: 'p1', hongguo: 'p-gone' } }
    });
    let sequence = 0;
    const settings = createWebProxySettings({
        get: config.get, set: config.set,
        listSources: () => [],
        generateId: () => `proxy-test${++sequence}`
    });
    settings.setList({
        webProxies: [
            { id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890/' },
            { name: '备用代理', url: 'socks5://127.0.0.1:1080' }
        ]
    });
    assert.deepEqual(config.data.network.webProxies, [
        { id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' },
        { id: 'proxy-test1', name: '备用代理', url: 'socks5://127.0.0.1:1080' }
    ]);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: 'p1', hongguo: '' });
});

test('删除被引用代理时同一保存操作把来源置为空选择', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: { bilibili: 'p1' } }
    });
    const settings = createWebProxySettings({ get: config.get, set: config.set, listSources: () => [] });
    settings.setList({ webProxies: [] });
    assert.deepEqual(config.data.network.webProxies, []);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: '' });
});

test('代理列表校验失败时不写入配置', () => {
    const config = memoryConfig({ network: { webProxies: [] }, media: { providerProxy: {} } });
    const settings = createWebProxySettings({ get: config.get, set: config.set, listSources: () => [] });
    const before = JSON.stringify(config.data);
    const tooMany = Array.from({ length: 21 }, (_, index) => (
        { name: `代理${index}`, url: 'http://127.0.0.1:7890' }
    ));
    assert.throws(() => settings.setList({ webProxies: tooMany }), /代理数量超出限制（最多 20 个）/);
    assert.throws(() => settings.setList({ webProxies: [{ name: '', url: 'http://127.0.0.1:7890' }] }), /代理名称不能为空且不能超过 30 个字符/);
    assert.throws(() => settings.setList({ webProxies: [{ name: 'x'.repeat(31), url: 'http://127.0.0.1:7890' }] }), /代理名称不能为空且不能超过 30 个字符/);
    assert.throws(() => settings.setList({ webProxies: [{ name: '代理', url: 'ftp://127.0.0.1:21' }] }), /代理地址格式不正确，仅支持 http\/https\/socks\/socks5\/socks5h/);
    assert.equal(JSON.stringify(config.data), before);
});

test('保存单个来源代理校验来源与代理存在性', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: {} }
    });
    const settings = createWebProxySettings({ get: config.get, set: config.set, listSources: () => [] });
    assert.throws(() => settings.setProvider({ sourceId: 'Bad ID', proxyId: 'p1' }), /媒体源标识不合法/);
    assert.throws(() => settings.setProvider({ sourceId: 'bilibili', proxyId: 'missing' }), /所选代理不存在，请先保存代理列表/);
    settings.setProvider({ sourceId: 'bilibili', proxyId: 'p1' });
    assert.equal(config.data.media.providerProxy.bilibili, 'p1');
    settings.setProvider({ sourceId: 'bilibili', proxyId: '' });
    assert.equal(config.data.media.providerProxy.bilibili, '');
});

// 每个持久化边界均模拟失败和重启；日志重放必须保留原来的 true 选择。
for (const failAt of [1, 2, 3]) {
    test(`迁移第 ${failAt} 次保存失败后可重启恢复且不泄露凭据`, () => {
        const initial = {
            network: { globalWebProxy: 'http://user:private@127.0.0.1:7890', keep: 42 },
            media: { providerProxy: { bilibili: true, quark: false } }
        };
        const config = memoryConfig(initial);
        let calls = 0;
        assert.throws(() => ensureWebProxyMigration({
            get: config.get,
            set(key, value) {
                if (++calls === failAt) throw new Error('private');
                return config.set(key, value);
            }
        }), error => error.message === '代理配置保存失败，请重试');
        const restarted = memoryConfig(config.data);
        ensureWebProxyMigration(restarted);
        assert.equal(restarted.data.media.providerProxy.bilibili, LEGACY_PROXY_ID);
        assert.equal(restarted.data.media.providerProxy.quark, '');
        assert.equal(restarted.data.network.webProxies.length, 1);
        assert.equal(restarted.data.network.globalWebProxy, '');
        assert.equal(restarted.data.network.keep, 42);
        assert.equal(restarted.data.network.pendingWebProxyUpdate, undefined);
        assert.equal(ensureWebProxyMigration(restarted), false);
    });

    test(`删除代理第 ${failAt} 次保存失败后可恢复一致配置`, () => {
        const config = memoryConfig({
            network: { webProxies: [{ id: 'p1', name: '代理', url: 'http://127.0.0.1:7890' }] },
            media: { providerProxy: { bilibili: 'p1' } }
        });
        let calls = 0;
        const settings = createWebProxySettings({
            get: config.get,
            set(key, value) {
                if (++calls === failAt) return false;
                return config.set(key, value);
            }
        });
        assert.throws(() => settings.setList({ webProxies: [] }), /代理配置保存失败/);
        const restarted = memoryConfig(config.data);
        ensureWebProxyMigration(restarted);
        // 日志尚未写入时没有任何变更；日志落盘后则完成预定操作。
        assert.equal(restarted.data.network.webProxies.length, failAt === 1 ? 1 : 0);
        assert.equal(restarted.data.media.providerProxy.bilibili, failAt === 1 ? 'p1' : '');
        assert.equal(restarted.data.network.pendingWebProxyUpdate, undefined);
    });
}

test('单来源保存失败不返回成功且底层异常不会泄露', () => {
    const config = memoryConfig({ network: { webProxies: [] }, media: { providerProxy: {} } });
    const settings = createWebProxySettings({
        get: config.get, set() { throw new Error('private'); }
    });
    assert.throws(() => settings.setProvider({ sourceId: 'bilibili', proxyId: '' }),
        error => error.message === '媒体源代理设置保存失败');
});
