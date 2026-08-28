'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
    CONTROL_THEMES,
    normalizeControlTheme,
    isControlTheme
} = require('../src/apps/server/modules/config/control-theme-config');

const serverSource = fs.readFileSync(
    path.join(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);
const configSource = fs.readFileSync(
    path.join(__dirname, '../src/apps/server/modules/config/config-app-service.js'),
    'utf8'
);

test('服务端控制端主题白名单应与当前 15 种主题一致', () => {
    assert.deepEqual(CONTROL_THEMES, [
        'dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold',
        'mint', 'ocean', 'forest', 'slate', 'algae-salt', 'girl-pink',
        'rose-gold', 'new-year-red'
    ]);
});

test('服务端主题校验应接受合法主题并拒绝非法值', () => {
    assert.equal(isControlTheme('algae-salt'), true);
    assert.equal(isControlTheme('unknown'), false);
    assert.equal(normalizeControlTheme('rose-gold'), 'rose-gold');
    assert.equal(normalizeControlTheme('unknown'), 'dark');
});

test('服务端应提供主题读写接口并把主题写入 ui.controlTheme', () => {
    assert.match(serverSource, /app\.get\('\/api\/config\/controlTheme'/u);
    assert.match(serverSource, /app\.post\('\/api\/config\/controlTheme'/u);
    assert.match(serverSource, /config\.set\('ui\.controlTheme', theme\)/u);
    assert.match(configSource, /ui:\s*\{\s*controlTheme:\s*'dark'/u);
});
