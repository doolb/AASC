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
    assert.match(source, /aascServerRegistry\.heartbeat\(AASC_MAIN_NODE_ID\)/);
});

test('主服务器提供 AASC 媒体索引本地和聚合接口', () => {
    const sourcePath = path.join(__dirname, '..', 'src/apps/server/boot/server-app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.match(source, /AascMediaIndexService/);
    assert.match(source, /app\.get\(['"]\/api\/aasc\/media-index['"]/);
    assert.match(source, /buildLocalIndex/);
    assert.match(source, /buildNetworkIndex/);
});
