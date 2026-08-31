'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const server = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);
const configService = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/server/modules/config/config-app-service.js'),
    'utf8'
);

test('服务端提供脱敏的修复模式配置接口并持久化更新', () => {
    assert.match(server, /app\.get\(['"]\/api\/repair-mode\/config['"]/);
    assert.match(server, /app\.post\(['"]\/api\/repair-mode\/config['"]/);
    assert.match(server, /createPublicRepairModeConfig/);
    assert.match(server, /updateRepairModeConfig/);
    assert.match(server, /config\.saveConfig\(\)/);
    assert.match(server, /passwordConfigured/);
    assert.match(server, /aiRoles\.list\(\)/);
});

test('服务端默认包含修复模式配置字段', () => {
    assert.match(configService, /repairMode:\s*\{/);
    assert.match(configService, /password:\s*['"]/);
    assert.match(configService, /role:\s*['"]mainfront['"]/);
});
