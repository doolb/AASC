'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const htmlPath = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/upload.html');

test('控制端服务端设置提供批量重载子服务器代码按钮', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.match(html, /重载所有子服务端代码/);
    assert.match(html, /Settings\.reloadAllSubservers\(\)/);
    assert.match(html, /reloadAllSubservers\(\)[\s\S]*?\/api\/aasc\/servers\/update-all/);
});

test('控制端服务端设置提供强制获取最新代码按钮', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.match(html, /强制获取最新代码/);
    assert.match(html, /Settings\.forceUpdateAllSubservers\(\)/);
    assert.match(html, /forceUpdateAllSubservers\(\)[\s\S]*?\/api\/aasc\/servers\/force-update-all/);
});
