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

async function sample(player, stamp, token = String(player.blackBorders.epoch)) {
    const pixels = Buffer.alloc(192 * 108);
    for (let y = 18; y < 90; y += 1) pixels.fill(180, y * 192, (y + 1) * 192);
    await player.command(['test-client-message', ['aasc-black-borders-frame', token, '192', '108', String(stamp), '0', pixels.toString('hex')]]);
}

test('真实IPC取样改变当前填充几何，开关/切源/清空隔离旧样本', async t => {
    const player = await playerFor(t);
    await player.load(media);
    const token = String(player.blackBorders.epoch);
    for (let stamp = 0; stamp < 4; stamp += 1) await sample(player, stamp);
    await delay(90); await player.tail;
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
    await player.close(); assert.equal(player.blackBorders.active, false);
});
