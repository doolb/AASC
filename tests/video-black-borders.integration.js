'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('隔离真实mpv Lua截图经IPC到JS检测，原生填充/旋转/暂停与清空', { timeout: 20000 }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-real-black-borders-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'border.mp4');
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=180x120:d=12:r=10',
        '-vf', 'pad=256:160:36:20:black', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file], { timeout: 10000 });
    const bytes = await fs.readFile(file);
    const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Length': bytes.length }); response.end(bytes); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const errors = [];
    const player = new MpvPlayer({ enabled: true, serverUrl: `http://127.0.0.1:${server.address().port}`,
        linux: { command: 'mpv', args: ['--vo=null', '--ao=null'] } },
    { resolveEnvironment: async options => options.env, onError: error => errors.push(error.message) });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    await player.load({ type: 'url', url: '/border.mp4', mediaType: 'video' });
    const deadline = Date.now() + 8000;
    while (!player.blackBorders.cropped && Date.now() < deadline) await delay(100);
    assert.ok(player.blackBorders.cropped, `应收到真实Lua取样: ${errors.join(',')}`);
    const rect = { ...player.blackBorders.rect };
    assert.ok(Math.abs(rect.x - 36 / 256) < 0.025 && Math.abs(rect.y - 20 / 160) < 0.025);
    await player.control('rotate', 90);
    const stamp = player.blackBorders.tracker.stamp;
    await delay(1300);
    assert.notEqual(player.blackBorders.tracker.stamp, stamp);
    assert.ok(Math.abs(player.blackBorders.rect.x - rect.x) < 0.02);
    await player.control('play', false);
    await delay(100);
    const pausedStamp = player.blackBorders.tracker.stamp;
    await delay(1100); assert.equal(player.blackBorders.tracker.stamp, pausedStamp);
    await player.clear(); assert.equal(player.blackBorders.active, false);
    assert.deepEqual(errors, []);
});
