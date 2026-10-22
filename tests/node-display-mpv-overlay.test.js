'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { MpvOverlay, assDocument, overlayLayout, escapeAss } = require('../src/apps/voice-display-node/mpv-overlay');

function clock() {
    let elapsed = 0;
    const tasks = new Map();
    return { tasks, now: () => new Date(2026, 9, 22, 12, 34, 56 + elapsed / 1000),
        setTimer: (callback, milliseconds) => { const timer = { at: elapsed + milliseconds, callback }; tasks.set(timer, timer); return timer; },
        clearTimer: timer => tasks.delete(timer),
        advance(milliseconds) {
            const end = elapsed + milliseconds;
            let next;
            while ((next = [...tasks.values()].sort((a, b) => a.at - b.at)[0])?.at <= end) {
                elapsed = next.at; tasks.delete(next); next.callback();
            }
            elapsed = end;
        }
    };
}

test('信息层1Hz刷新、最新ASR30秒、旧隐藏回调不清除新文本，关闭释放全部计时器', () => {
    const time = clock();
    let updates = 0;
    const overlay = new MpvOverlay(() => { updates += 1; }, time);
    overlay.setActive(true);
    overlay.update({ connection: '已连接', asrText: '[小爱] 第一段' });
    const oldHide = [...time.tasks.values()].find(task => task.at === 30000).callback;
    time.advance(20000);
    overlay.update({ asrText: '[小爱] 新一段' });
    oldHide();
    assert.equal(overlay.state.asr, '[小爱] 新一段');
    time.advance(29999);
    assert.equal(overlay.state.asr, '[小爱] 新一段');
    time.advance(1);
    assert.equal(overlay.state.asr, '');
    assert.ok(updates < 60, '时钟不得高频重绘');
    overlay.update({ asrText: '退出前' });
    overlay.close();
    assert.equal(time.tasks.size, 0);
    overlay.update({ asrText: '退出后旧结果' });
    assert.equal(overlay.state.asr, '');
});

test('TTS按当前条目显示，后续条目和旧完成/停止不串词，结束保留30秒', () => {
    const time = clock();
    const overlay = new MpvOverlay(() => {}, time);
    overlay.update({ ttsEvent: { phase: 'start', id: 1, text: '第一句' } });
    overlay.update({ ttsEvent: { phase: 'end', id: 1, queueIdle: false } });
    overlay.update({ ttsEvent: { phase: 'start', id: 2, text: '第二句' } });
    overlay.update({ ttsEvent: { phase: 'end', id: 1, failed: true } });
    assert.equal(overlay.state.tts, '第二句');
    overlay.update({ ttsEvent: { phase: 'end', id: 2, queueIdle: true } });
    time.advance(29999);
    assert.equal(overlay.state.tts, '第二句');
    time.advance(1);
    assert.equal(overlay.state.tts, '');
    overlay.update({ ttsEvent: { phase: 'start', id: 3, text: '第三句' } });
    overlay.update({ ttsEvent: { phase: 'stop' } });
    overlay.update({ ttsEvent: { phase: 'end', id: 3, queueIdle: true } });
    assert.equal(overlay.state.tts, '');
    assert.equal(time.tasks.size, 0);
    overlay.close();
});

test('ASS转义保留中文/字面指令，长文本有界，状态栏隐藏不隐藏时钟与正文', () => {
    const value = '中文{\\pos(0,0)}\\N字面\n新行';
    assert.equal(escapeAss(value), '中文\\{\\\u2060pos(0,0)}\\\u2060N字面\\N新行');
    const state = { connection: '已连接', showStatusBar: false, tts: value.repeat(1000), asr: '识别文本' };
    for (const rotation of [0, 90, 180, 270]) {
        const document = assDocument(state, { width: 800, height: 600 }, rotation, new Date(2026, 9, 22, 12, 34, 56));
        assert.equal(document.format, 'ass-events');
        assert.match(document.data, /12:34:56/);
        assert.doesNotMatch(document.data, /已连接/);
        assert.match(document.data, /识别文本/);
        assert.ok(document.data.length < 20000);
        const layout = overlayLayout({ width: 800, height: 600, rotation, tts: 'TTS', asr: 'ASR' });
        assert.equal(layout.tts.y, rotation % 180 ? 24 : rotation === 180 ? 160 - layout.tts.height : 160);
        assert.equal(layout.asr.y + layout.asr.height, layout.layoutHeight - 172);
    }
});

test('系统音频逐条通知在子进程启动后发出，保持原队列/AEC/完成回调，停止作废旧通知', async () => {
    const children = [];
    let download;
    const sandbox = { module: { exports: {} }, Buffer, AbortController, console: { log() {}, error() {} },
        require(name) {
            if (name === 'node-fetch') return () => new Promise(resolve => { download = resolve; });
            if (name === 'child_process') return { spawn() {
                const child = new EventEmitter();
                child.stdin = new PassThrough(); child.stderr = new PassThrough();
                child.kill = () => queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
                children.push(child);
                queueMicrotask(() => child.emit('spawn'));
                return child;
            } };
            return require(name);
        }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/apps/voice-display-node/audio-player'), 'utf8'), sandbox);
    const player = new sandbox.module.exports();
    const events = [];
    let starts = 0;
    let ends = 0;
    let completed = 0;
    let pcmCalls = 0;
    const wav = Buffer.alloc(52);
    wav.write('RIFF'); wav.writeUInt32LE(44, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(8, 40);
    player.onPlayData = (samples, rate) => { assert.equal(samples.length, 4); assert.equal(rate, 16000); pcmCalls += 1; };
    player.onItemPlayback = event => events.push(event);
    player.onPlayStart = () => { starts += 1; };
    player.onPlayEnd = () => { ends += 1; };
    player.queueBuffer(wav, { text: '第一句', onComplete: () => { completed += 1; } });
    player.queueURL('http://fixture/tts.wav', { text: '第二句', onComplete: () => { completed += 1; } });
    assert.equal(events.length, 0, '加入队列不应提前显示后续文字');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.map(event => event.text).filter(Boolean), ['第一句']);
    children[0].emit('close', 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(children.length, 1);
    assert.deepEqual(events.map(event => event.text).filter(Boolean), ['第一句'], '下载中的条目不提前显示');
    download({ ok: true, headers: { get: () => String(wav.length) }, arrayBuffer: async () => wav });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.map(event => event.text).filter(Boolean), ['第一句', '第二句']);
    assert.equal(starts, 1);
    assert.equal(completed, 1);
    assert.equal(pcmCalls, 2, '每条音频仍向AEC回调一次PCM');
    player.stop(); player.clearQueue();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ends, 1);
    assert.equal(events.at(-1).phase, 'stop');
    assert.equal(completed, 1, '停止后旧异步完成不通知新播放');
});
