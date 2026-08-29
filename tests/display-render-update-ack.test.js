'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const display = fs.readFileSync(
    path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'),
    'utf8'
);

function getMessageBranch(type, nextType) {
    const startMarker = `data.type === '${type}'`;
    const endMarker = `} else if (data.type === '${nextType}'`;
    const start = display.indexOf(startMarker);
    const end = display.indexOf(endMarker, start);

    return start >= 0 && end > start
        ? display.slice(start, end)
        : '';
}

test('task:renderUpdate 高频刷新不应生成命令确认提示', () => {
    const branch = getMessageBranch('task:renderUpdate', 'hardwareStats');

    assert.match(branch, /_renderTaskUpdates/iu);
    assert.match(branch, /fn\(data\.data/iu);
    assert.doesNotMatch(branch, /sendCommandAck\s*\(/iu);
});

test('hardwareStats 兼容刷新不应生成命令确认提示', () => {
    const branch = getMessageBranch('hardwareStats', 'playlistStart');

    assert.match(branch, /_renderTaskUpdates/iu);
    assert.match(branch, /data\.data/iu);
    assert.doesNotMatch(branch, /sendCommandAck\s*\(/iu);
});

test('显式播放命令仍保留命令确认', () => {
    const branch = getMessageBranch('playlistStart', 'playlistControl');

    assert.match(branch, /sendCommandAck\('playlistStart'/u);
});
