'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const serverApp = fs.readFileSync(path.join(root, 'src/apps/server/boot/server-app.js'), 'utf8');
const taskSocketHandler = fs.readFileSync(
    path.join(root, 'src/apps/server/modules/task-engine/web-socket-handler.js'),
    'utf8'
);

test('widgetRefresh 的控制端收发日志被静默', () => {
    assert.match(
        serverApp,
        /const isWidgetRefreshAction = data\.type === 'task:widget_action'[\s\S]{0,180}data\.payload\?\.action === 'widgetRefresh'/u
    );
    assert.match(serverApp, /if \(shouldLogCrop && !isWidgetRefreshAction\)/u);
    assert.match(
        taskSocketHandler,
        /if \(payload\.action !== 'widgetRefresh'\) \{\s*console\.log\('\[WS\] >> task:widget_action:'/u
    );
});

test('task:widget_update 广播不写普通 WS 日志', () => {
    assert.match(serverApp, /SILENT_BROADCAST_TYPES[\s\S]{0,260}'task:widget_update'/u);
});

console.log('task-widget-log-noise.test.js: 2/2 passed');
