'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const { NodeMediaController } = require('../src/apps/voice-display-node/media-controller');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const media = { type: 'url', url: 'http://localhost/video.mp4', mediaType: 'video' };

async function playerFor(t) {
    const player = new MpvPlayer({ enabled: true, serverUrl: 'http://localhost', linux: { command: 'mpv' } }, {
        platform: 'linux', env: process.env, executeFile: async () => ({}), resolveEnvironment: async options => options.env,
        spawn: (_command, args, options) => spawn(process.execPath, [path.join(__dirname, 'fixtures/fake-mpv.js'), ...args], options),
        connect: address => net.createConnection(address)
    });
    t.after(() => player.close()); await player.checkAvailable();
    return player;
}

async function sample(player, stamp, token = String(player.blackBorders.epoch), { top = 18, bottom = 90 } = {}) {
    const pixels = Buffer.alloc(192 * 108);
    for (let y = top; y < bottom; y += 1) pixels.fill(180, y * 192, (y + 1) * 192);
    await player.command(['test-client-message', ['aasc-black-borders-frame', token, '192', '108', String(stamp), '0', pixels.toString('hex')]]);
    const deadline = Date.now() + 3000;
    while (player.blackBorders.pipeline.busy && Date.now() < deadline) await delay(1);
    assert.equal(player.blackBorders.pipeline.busy, null, '计算线程应完成当前帧，不积压后续截图');
}

test('真实IPC取样改变当前填充几何，开关/切源/清空隔离旧样本', async t => {
    const player = await playerFor(t);
    await player.load(media);
    const token = String(player.blackBorders.epoch);
    for (let stamp = 0; stamp < 2; stamp += 1) await sample(player, stamp);
    assert.equal(player.blackBorders.cropped, false, '第二帧结果完成也不能在同帧直接应用');
    await sample(player, 2); await player.tail;
    assert.ok(player.blackBorders.cropped);
    await player.control('fit', 'cover');
    assert.ok(await player.command(['get_property', 'video-zoom']) > 0.5);
    assert.equal(await player.command(['get_property', 'panscan']), 0);
    await player.control('autoBlackBorders', false);
    assert.equal(await player.command(['get_property', 'panscan']), 1);
    assert.equal(await player.command(['get_property', 'video-zoom']), 0);
    await player.control('autoBlackBorders', true);
    await player.load(media);
    for (let stamp = 4; stamp < 8; stamp += 1) await sample(player, stamp, token);
    assert.equal(player.blackBorders.cropped, false);
    for (let stamp = 8; stamp < 12; stamp += 1) await sample(player, stamp);
    await delay(90); await player.tail;
    assert.ok(player.blackBorders.cropped);
    await player.clear(); assert.equal(player.blackBorders.active, false); assert.equal(player.blackBorders.cropped, false);
    await player.load({ ...media, mediaType: 'image' }); assert.equal(player.blackBorders.active, false);
});

test('黑边过渡默认开启，从当前几何平滑到目标，独立关闭立即完成并清理计时器', async t => {
    const player = await playerFor(t); await player.load(media); await player.control('fit', 'cover');
    assert.equal(player.blackBorderTransition, true);
    for (let stamp = 0; stamp < 3; stamp += 1) await sample(player, stamp);
    await player.tail;
    const target = Math.log2(player.geometry('cover').scaleX);
    assert.ok(player.blackBorderAnimation.current);
    await delay(70);
    const middle = await player.command(['get_property', 'video-zoom']);
    assert.ok(middle > 0.415 && middle < target, `${middle}/${target}`);
    await delay(180); assert.equal(player.blackBorderAnimation.current, null);
    assert.ok(Math.abs(await player.command(['get_property', 'video-zoom']) - target) < 0.001);
    for (let stamp = 3; stamp < 6; stamp += 1) await sample(player, stamp, undefined, { top: 8, bottom: 100 });
    await player.tail; assert.ok(player.blackBorderAnimation.current);
    await player.control('blackBorderTransition', false);
    assert.equal(player.blackBorders.enabled, true); assert.equal(player.blackBorderAnimation.current, null);
    assert.equal(player.blackBorderAnimation.timer, null);
    assert.ok(Math.abs(await player.command(['get_property', 'video-zoom']) - Math.log2(player.geometry().scaleX)) < 0.001);
});

test('原生过渡插值与过期回调隔离，不同步等待200ms且取消后不再写入', async () => {
    const { MpvGeometryTransition } = require('../src/apps/voice-display-node/mpv-geometry-transition');
    let now = 0, completed = 0; const jobs = [], writes = [];
    const animation = new MpvGeometryTransition({ now: () => now, schedule: callback => { const job = { callback }; jobs.push(job); return job; },
        cancel: job => { if (job) job.cancelled = true; }, write: async geometry => writes.push(geometry), complete: () => completed++, onError: error => { throw error; } });
    animation.start({ scaleX: 1, panX: 0, panY: 0 }, { scaleX: 2, panX: 0.2, panY: -0.2 }, () => true);
    now = 100; await jobs.shift().callback(); assert.equal(writes[0].scaleX, 1.5); assert.equal(completed, 0);
    const stale = jobs.shift(); animation.cancel(); now = 200; await stale.callback(); assert.equal(writes.length, 1);
    animation.start({ scaleX: 1.5, panX: 0.1, panY: -0.1 }, { scaleX: 2, panX: 0.2, panY: -0.2 }, () => true);
    now = 400; await jobs.shift().callback(); assert.equal(writes.at(-1).scaleX, 2); assert.equal(completed, 1); assert.equal(animation.timer, null);
});

test('有效画面动态模式插值缩放，控制协议可在能力之前记忆开关', async t => {
    const player = await playerFor(t), controller = new NodeMediaController({ serverUrl: 'http://localhost' }, { player });
    t.after(() => controller.close());
    assert.equal(await controller.handleControl({ action: 'autoBlackBorders', value: false }), true);
    assert.equal(player.process, null); assert.equal(player.blackBorders.enabled, false);
    await player.control('autoBlackBorders', true); await player.load(media);
    for (let stamp = 0; stamp < 4; stamp += 1) await sample(player, stamp);
    await delay(90); await player.tail;
    await player.control('dynamicFitConfig', { holdSeconds: 0.1, transitionSeconds: 0.2 });
    await player.control('fit', 'dynamic');
    const a = Math.log2(player.geometry('contain').scaleX), b = Math.log2(player.geometry('cover').scaleX);
    await delay(280);
    const commands = await player.command(['get_property', 'test-command-log']);
    assert.ok(commands.some(command => command[1] === 'video-zoom' && command[2] > a && command[2] < b));
    assert.equal(await player.command(['get_property', 'panscan']), 0);
    await player.close(); assert.equal(player.blackBorders.active, false); assert.equal(player.blackBorders.pipeline.worker, null);
});
