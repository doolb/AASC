'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { AascServerRegistry } = require('../src/framework/aasc/server-registry');

test('注册服务器节点后返回在线快照并支持重复注册更新', () => {
    let currentTime = 1000;
    const registry = new AascServerRegistry({ now: () => currentTime });

    const first = registry.register({
        nodeId: 'server-a',
        name: '客厅服务器',
        url: 'https://192.168.1.20:8081/',
        version: '1.0.0',
        capabilities: { mediaLibrary: true, puppeteer: false },
        metadata: { role: 'sub-server' }
    });

    assert.equal(first.nodeId, 'server-a');
    assert.equal(first.url, 'https://192.168.1.20:8081');
    assert.equal(first.status, 'online');
    assert.equal(first.healthy, true);
    assert.equal(first.lastHeartbeatAt, new Date(currentTime).toISOString());

    currentTime = 2000;
    const updated = registry.register({
        nodeId: 'server-a',
        name: '更新后的服务器',
        url: 'https://192.168.1.21:8081',
        version: '1.1.0',
        capabilities: { mediaLibrary: true, ocr: true }
    });

    assert.equal(updated.name, '更新后的服务器');
    assert.equal(updated.url, 'https://192.168.1.21:8081');
    assert.equal(updated.version, '1.1.0');
    assert.deepEqual(updated.capabilities, { mediaLibrary: true, ocr: true });
    assert.equal(registry.getAll().length, 1);
});

test('心跳会恢复在线状态，超时节点保留但标记为离线', () => {
    let currentTime = 1000;
    const registry = new AascServerRegistry({
        now: () => currentTime,
        heartbeatTimeoutMs: 9000
    });
    registry.register({ nodeId: 'server-b', url: 'http://192.168.1.22:8081' });

    currentTime = 10000;
    assert.equal(registry.get('server-b').status, 'offline');
    assert.equal(registry.get('server-b').healthy, false);

    currentTime = 11000;
    const heartbeat = registry.heartbeat('server-b', { metadata: { load: 0.2 } });
    assert.equal(heartbeat.status, 'online');
    assert.equal(heartbeat.healthy, true);
    assert.deepEqual(heartbeat.metadata, { load: 0.2 });
});

test('注册校验拒绝缺少 nodeId、非法 URL 和未知节点心跳', () => {
    const registry = new AascServerRegistry();

    assert.throws(() => registry.register({ url: 'https://192.168.1.20:8081' }), /nodeId/);
    assert.throws(() => registry.register({ nodeId: 'server-c', url: 'ftp://192.168.1.20:8081' }), /url/);
    assert.equal(registry.heartbeat('missing-node', {}), null);
});

test('主服务器提供 AASC 节点目录、注册和心跳接口', () => {
    const serverAppPath = path.join(__dirname, '..', 'src/apps/server/boot/server-app.js');
    const source = fs.readFileSync(serverAppPath, 'utf8');

    assert.match(source, /app\.get\(['"]\/api\/aasc\/servers['"]/);
    assert.match(source, /app\.post\(['"]\/api\/aasc\/servers\/register['"]/);
    assert.match(source, /app\.post\(['"]\/api\/aasc\/servers\/:nodeId\/heartbeat['"]/);
    assert.match(source, /aascServerRegistry\.register/);
    assert.match(source, /aascServerRegistry\.heartbeat/);
});
