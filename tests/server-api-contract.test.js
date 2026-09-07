'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('主服务器提供 /server 版本清单和代码包接口', () => {
    const sourcePath = path.join(__dirname, '..', 'src/apps/server/boot/server-app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /app\.get\(['"]\/server['"]/);
    assert.match(source, /app\.get\(['"]\/server\/manifest['"]/);
    assert.match(source, /app\.get\(['"]\/server\/package['"]/);
    assert.match(source, /serverReleaseService\.getManifest/);
    assert.match(source, /serverReleaseService\.streamPackage/);
    assert.match(source, /aascServerRegistry\.heartbeat\(AASC_MAIN_NODE_ID,\s*\{\s*runtime:\s*getAascRuntime\(\)\s*\}\)/);
});

test('主服务器将 /control 作为控制端页面入口并兼容重定向 /upload', () => {
    const sourcePath = path.join(__dirname, '..', 'src/apps/server/boot/server-app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /app\.get\(['"]\/control['"]/);
    assert.match(source, /app\.get\(['"]\/upload['"][\s\S]*?res\.redirect\(['"]\/control['"]\)/);
    assert.match(source, /app\.get\(['"]\/['"][\s\S]*?res\.redirect\(['"]\/control['"]\)/);
});

test('主服务器提供 AASC 媒体索引本地和聚合接口', () => {
    const sourcePath = path.join(__dirname, '..', 'src/apps/server/boot/server-app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /AascMediaIndexService/);
    assert.match(source, /app\.get\(['"]\/api\/aasc\/media-index['"]/);
    assert.match(source, /buildLocalIndex/);
    assert.match(source, /buildNetworkIndex/);
});

test('主服务器同时保留 HTTP /server 并提供 WebSocket /server 节点入口', () => {
    const sourcePath = path.join(__dirname, '..', 'src/apps/server/boot/server-app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /app\.get\(['"]\/server['"]/);
    assert.match(source, /url === ['"]\/server['"]/);
    assert.match(source, /node\.register/);
    assert.match(source, /node\.heartbeat/);
    assert.match(source, /AascNodeSession/);
});

test('服务器按 aasc.role 启动子服务器主动连接，并通过节点会话请求媒体索引', () => {
    const appSource = fs.readFileSync(
        path.join(__dirname, '..', 'src/apps/server/boot/server-app.js'),
        'utf8'
    );
    const configSource = fs.readFileSync(
        path.join(__dirname, '..', 'src/apps/server/modules/config/config-app-service.js'),
        'utf8'
    );

    assert.match(configSource, /aasc:\s*\{/);
    assert.match(configSource, /mainServerUrl:\s*['"]https:\/\/192\.168\.1\.39:8081['"]/);
    assert.match(appSource, /AascNodeConnector/);
    assert.match(appSource, /AASC_ROLE !== ['"]subserver['"]/);
    assert.match(appSource, /aascServerRegistry\.request/);
    assert.match(appSource, /media\.index\.local/);
    assert.match(appSource, /app\.post\(['"]\/api\/aasc\/servers\/:nodeId\/request['"]/);
});

test('主服务器提供批量重载在线子服务器代码接口', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(source, /app\.post\(['"]\/api\/aasc\/servers\/update-all['"]/);
    assert.match(source, /server\.nodeId !== AASC_MAIN_NODE_ID/);
    assert.match(source, /server\.status === ['"]online['"]/);
    assert.match(source, /server\.connected === true/);
    assert.match(source, /aascServerRegistry\.getConnection\(server\.nodeId\)/);
    assert.match(source, /aascServerRegistry\.request\(\s*server\.nodeId[\s\S]*?['"]server\.update['"]/);
    assert.match(source, /Promise\.all/);
});

test('主服务器提供强制让在线子服务器获取最新代码接口', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(source, /app\.post\(['"]\/api\/aasc\/servers\/force-update-all['"]/);
    assert.match(source, /updateAllAascSubservers\(\{ force: true \}\)/);
    assert.match(source, /const updatePayload = force \? \{ force: true \} : \{\}/);
    assert.match(source, /aascServerRegistry\.request\(\s*server\.nodeId[\s\S]*?['"]server\.update['"]\s*,\s*updatePayload/);
});

test('主服务器规范化远程播放列表的子服务器直连地址并保留代理回退', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(source, /normalizeRemoteMediaUrl/);
    assert.match(source, /buildRemoteMediaProxyPath/);
    assert.match(source, /remoteResult\?\.playlist[\s\S]*?\.map\(/);
    assert.match(source, /fallbackUrl/);
});
