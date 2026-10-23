'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NodeSleepController } = require('../src/apps/voice-display-node/sleep-controller');
const { NodeMediaController } = require('../src/apps/voice-display-node/media-controller');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const { MpvTextPlayer } = require('../src/apps/voice-display-node/mpv-text-player');

test('Node沿网页时段/手动优先级，临时激活取消覆盖且60秒后回落；计时器退出清理', async () => {
    let time = +new Date(2026, 9, 23, 2); let cleared = false; const states = []; const reports = [];
    const sleep = new NodeSleepController({ now: () => time, setTimer: () => 123, clearTimer: id => { cleared = id === 123; },
        apply: async state => states.push(state), send: report => reports.push(report) });
    assert.equal(sleep.state, 'normal');
    await sleep.restore({ enabled: true, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 });
    assert.equal(sleep.state, 'deep');
    await sleep.activate(); assert.equal(sleep.state, 'active');
    await sleep.control({ action: 'sleepOverride', value: 'sleep' }); assert.equal(sleep.state, 'sleep');
    time += 120000; await sleep.check(); assert.equal(sleep.state, 'sleep');
    await sleep.activate(); assert.equal(sleep.manualMode, null);
    time += 60001; await sleep.check(); assert.equal(sleep.state, 'deep');
    time = +new Date(2026, 9, 23, 9); await sleep.control({ action: 'sleepOverride', value: 'normal' });
    assert.equal(sleep.state, 'normal'); assert.equal(reports.at(-1).sleepState, 'normal');
    await sleep.close(); assert.equal(cleared, true); assert.ok(states.includes('active'));
});

test('重连恢复不激活，视频按原播放意图加载；控制端新媒体临时激活，手动暂停保留', async t => {
    const player = Object.assign(new EventEmitter(), { current: null, paused: false,
        checkAvailable: async () => true, clear: async () => {}, close: async () => {},
        setSleepState: async state => { player.sleepState = state; },
        setOverlayEnabled: async () => {},
        load: async (media, options) => { player.current = media; player.paused = options?.paused === true; return true; },
        control: async (action, value) => { if (action === 'play') player.paused = value !== true; } });
    const sent = []; const controller = new NodeMediaController({}, { player, send: value => sent.push(value),
        sleepClock: { now: () => +new Date(2026, 9, 23, 2), setTimer: () => null, clearTimer: () => {} } });
    t.after(() => controller.close()); controller.sleep.report();
    assert.equal(Object.hasOwn(sent.at(-1), 'playbackIntent'), false, '尚未恢复媒体时不能用false覆盖服务端播放意图');
    await controller.initialize(); await controller.setCapabilities({ mediaRendering: true });
    await controller.restore({ sleep: { enabled: true, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 },
        currentMedia: { type: 'url', mediaType: 'video', url: 'http://media.test/video.mp4' }, isPlaying: false, sleepPlaybackIntent: true });
    assert.equal(controller.sleep.state, 'deep'); assert.equal(player.paused, false);
    assert.equal(sent.filter(v => v.type === 'sleepStateReport').at(-1).playbackIntent, true);
    await controller.handleControl({ action: 'play', value: false });
    await controller.handleControl({ action: 'sleepActivate' }); assert.equal(player.paused, true);
    await controller.handleMedia({ type: 'url', mediaType: 'image', url: 'http://media.test/a.png' });
    assert.equal(controller.sleep.state, 'active');
});

test('mpv遮罩黑媒体但保UI，深睡隐藏UI，恢复不自动播放用户暂停的媒体', async () => {
    const commands = []; const player = new MpvPlayer({ enabled: true });
    player.available = true; player.overlay.active = true; player.current = { mediaType: 'video' };
    player.session = { socket: {}, disposed: false }; player.properties['osd-dimensions'] = { w: 800, h: 600 };
    player.command = async command => { commands.push(command); };
    player.paused = true;
    await player.setSleepState('sleep');
    assert.ok(commands.some(v => v.id === 42 && v.data.includes('800 600')));
    assert.ok(commands.some(v => v.id === 40 && v.format === 'ass-events'));
    assert.ok(commands.some(v => v.id === 41 && v.format === 'none'));
    await player.setSleepState('deep'); assert.equal(commands.filter(v => v.id === 40).at(-1).format, 'none');
    await player.setSleepState('normal'); assert.deepEqual(commands.filter(Array.isArray).at(-1), ['set_property', 'pause', true]);
    assert.equal(commands.filter(v => v.id === 42).at(-1).format, 'none');
    player.overlay.close(); player.session = null;
});

test('文本睡眠只停本篇朗读和句子推进，保留播放状态，通用TTS不被停止', async () => {
    const sent = []; const cancelled = []; const text = new MpvTextPlayer({ send: item => sent.push(item), render: async () => {}, dimensions: () => ({}), serverUrl: 'http://localhost' });
    text.active = true; text.state = 'playing'; text.sentences = ['第一句']; text.sentenceIndex = 0;
    text.layout = { pages: [{ text: '第一句' }] }; text.audio = { cancel: id => cancelled.push(id) };
    await text.setSleeping(true); await text.advance();
    assert.equal(text.state, 'playing'); assert.equal(text.sentenceIndex, 0); assert.equal(text.expected, null);
    assert.ok(cancelled.every(id => id.startsWith('text:'))); assert.equal(sent.some(v => v.type === 'tts' && v.action === 'stop'), false);
    await text.setSleeping(false); assert.equal(text.expected.text, '第一句');
    await text.close();
});
