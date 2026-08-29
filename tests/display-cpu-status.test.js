'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    normalizeDisplayCpuStatus,
    getDisplayTtsConcurrency
} = require('../src/apps/server/modules/media/display-cpu-status');

const SERVER_APP = path.join(__dirname, '../src/apps/server/boot/server-app.js');
const DISPLAY_HTML = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');

test('规范化显示端 CPU 状态并将 TTS 并发上限限制为两路', () => {
    const status = normalizeDisplayCpuStatus({
        topology: { bigCpus: [6, 7], littleCpus: [0, 1, 2, 3] },
        asr: { totalCoreCount: 1, effectiveBigCoreCount: 1, effectiveLittleCoreCount: 0 },
        tts: { totalCoreCount: 4, effectiveBigCoreCount: 2, effectiveLittleCoreCount: 2 }
    });

    assert.deepEqual(status.topology.bigCpus, [6, 7]);
    assert.deepEqual(status.topology.littleCpus, [0, 1, 2, 3]);
    assert.equal(status.tts.totalCoreCount, 4);
    assert.equal(getDisplayTtsConcurrency(status), 2);
});

test('缺少或非法显示端 CPU 状态时回退为单路 TTS', () => {
    assert.equal(normalizeDisplayCpuStatus(null), null);
    assert.equal(getDisplayTtsConcurrency(null), 1);
    assert.equal(getDisplayTtsConcurrency({ tts: { totalCoreCount: 0 } }), 1);
});

test('显示端和服务端包含 CPU 状态回报协议', () => {
    const server = fs.readFileSync(SERVER_APP, 'utf8');
    const display = fs.readFileSync(DISPLAY_HTML, 'utf8');

    assert.match(server, /data\.type === 'cpuStatus'/u);
    assert.match(server, /cpuStatusUpdated/u);
    assert.match(display, /function reportNativeCpuStatus\(/u);
    assert.match(display, /type: 'cpuStatus'/u);
    assert.match(display, /cpuStatus\(\)/u);
});
