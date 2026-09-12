'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const publicRoot = path.join(__dirname, '../src/apps/web-mediacenter/ui/public');
const display = fs.readFileSync(path.join(publicRoot, 'display.html'), 'utf8');
const upload = fs.readFileSync(path.join(publicRoot, 'upload.html'), 'utf8');

function getVersionWatcherSource() {
    const start = display.indexOf('function scheduleDisplayVersionWatch()');
    const end = display.indexOf('        initVoiceRecognition();', start);
    assert.ok(start >= 0, '显示端必须存在文件版本监听器');
    assert.ok(end > start, '显示端文件版本监听器必须位于初始化语音识别之前');
    return display.slice(start, end);
}

test('显示端文件版本检查使用可远端配置的检测间隔', () => {
    const watcher = getVersionWatcherSource();

    assert.match(watcher, /fetch\('\/api\/display-version'/u);
    assert.match(watcher, /displayVersionIntervalMs/u);
    assert.match(watcher, /setTimeout\(watchDisplayVersion, displayVersionIntervalMs\)/u);
    assert.match(display, /DEFAULT_DISPLAY_VERSION_INTERVAL_MS\s*=\s*30000/u, '必须保留 30 秒默认值');
    assert.doesNotMatch(watcher, /setTimeout\(watchDisplayVersion, 8000\)/u);
});

test('显示端检测到文件版本变化仍然刷新，控制端不增加独立文件轮询', () => {
    const watcher = getVersionWatcherSource();

    assert.match(watcher, /d\.version !== lastDisplayVersion[\s\S]*location\.reload\(\)/u);
    assert.doesNotMatch(upload, /display-version|watchDisplayVersion/u);
});
