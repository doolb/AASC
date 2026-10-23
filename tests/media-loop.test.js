'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MediaLoop = require('../src/apps/web-mediacenter/ui/public/js/media-loop');
const { createMediaLoopService } = require('../src/apps/server/modules/media/media-loop-control');

test('暂停时寻址到文件末尾不会被区间循环自动唤醒', () => {
    const handlers = new Map();
    const media = { paused: true, ended: false, loop: true, duration: 120, currentTime: 0,
        addEventListener: (type, handler) => handlers.set(type, handler), play: () => assert.fail('暂停不能自动播放') };
    const player = MediaLoop.attach(media);
    player.set({ enabled: true, startPercent: 25, endPercent: 100 });
    media.currentTime = 120;
    media.ended = true;
    handlers.get('timeupdate')();
    handlers.get('ended')({ stopImmediatePropagation() {} });
    assert.equal(media.currentTime, 120);
});

test('百分比规范化防止NaN、交叉、越界和隐式类型转换', () => {
    for (const value of [null, {}, { startPercent: NaN, endPercent: Infinity }, { startPercent: 100, endPercent: -1 },
        { startPercent: 40, endPercent: 40 }, { startPercent: '80', endPercent: null }]) {
        const range = MediaLoop.normalize(value);
        assert.ok(range.startPercent >= 0 && range.endPercent <= 100);
        assert.ok(range.endPercent > range.startPercent);
        assert.equal(range.enabled, false);
    }
    assert.deepEqual(MediaLoop.seconds({ enabled: true, startPercent: 25, endPercent: 75 }, 120), { start: 30, end: 90 });
    for (const duration of [0, Infinity, NaN, -1]) assert.equal(MediaLoop.seconds({ enabled: true }, duration), null);
});

function fixture() {
    const events = [], sent = [], saves = [];
    const display = { displayId: 'one', state: { currentMedia: { mediaType: 'video' }, currentMediaProgress: { duration: 120 } } };
    const service = createMediaLoopService({ persist: (...args) => saves.push(args), broadcast: data => events.push(data),
        send: (...args) => sent.push(args) });
    service.reset(display);
    service.report(display, { type: 'videoProgress', currentTime: 0, duration: 120 });
    const control = value => service.handle(display, { type: 'control', action: 'mediaLoop',
        value: { ...value, mediaLoopToken: display.state.mediaLoopToken } });
    return { service, display, control, events, sent, saves };
}

test('服务端持久化规范化值并广播权威状态，隔离显示端且旧媒体请求不复活', () => {
    const { service, display, control, sent, events, saves } = fixture();
    control({ enabled: true, startPercent: 25.04, endPercent: 200 });
    const expected = { enabled: true, startPercent: 25, endPercent: 100 };
    assert.deepEqual(display.state.mediaLoop, expected);
    assert.deepEqual(sent[0], ['one', { type: 'control', action: 'mediaLoop', value: expected }]);
    assert.deepEqual(events.at(-1).mediaLoop, expected);
    assert.equal(saves.at(-1)[2].requireSave, true);
    const oldToken = display.state.mediaLoopToken;
    service.sent(display, { type: 'url', mediaType: 'video' });
    service.handle(display, { action: 'mediaLoop', value: { enabled: true, mediaLoopToken: oldToken } });
    assert.equal(display.state.mediaLoop.enabled, false);
    assert.match(events.at(-1).error, /已切换/);
    assert.equal(sent.length, 1);
});

test('未知时长、HTML、配置保存失败均不向播放器发送区间；列表切项清除', () => {
    const { service, display, control, sent, events } = fixture();
    service.report(display, { type: 'videoProgress', duration: Infinity });
    control({ enabled: true });
    assert.equal(sent.length, 0);
    assert.match(events.at(-1).error, /时长/);
    display.state.currentMedia.mediaType = 'html';
    service.report(display, { type: 'videoProgress', duration: 120 });
    control({ enabled: true });
    assert.equal(sent.length, 0);
    display.state.currentMedia.mediaType = 'video';
    control({ enabled: true, startPercent: 10, endPercent: 40 });
    display.state.currentPlaylist = { index: 0 };
    service.report(display, { type: 'playlistProgress', index: 1, duration: 30 });
    assert.equal(display.state.mediaLoop.enabled, false);
    const failing = createMediaLoopService({ persist: () => { throw new Error('disk'); }, broadcast: data => events.push(data), send: () => assert.fail('不能下发') });
    failing.handle(display, { action: 'mediaLoop', value: { enabled: true, mediaLoopToken: display.state.mediaLoopToken } });
    assert.match(events.at(-1).error, /保存失败/);
    assert.equal(display.state.mediaLoop.enabled, false);
});
