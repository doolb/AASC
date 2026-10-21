'use strict';

// 显式实机自测入口：依赖系统mpv/ffmpeg，以null音视频输出验证真实IPC，不打开桌面或发出声音。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const run = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('真实mpv常驻播放视频/音频/图片，恢复暂停断点、旋转、清空与退出', { timeout: 30000 }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-mpv-real-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:d=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(directory, 'video.mp4')], { timeout: 10000 });
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
        '-t', '3', '-y', path.join(directory, 'audio.wav')], { timeout: 10000 });
    const ppm = Buffer.concat([Buffer.from('P6\n2 2\n255\n'), Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])]);
    await fs.writeFile(path.join(directory, 'image.ppm'), ppm);
    const server = http.createServer(async (request, response) => {
        const names = new Set(['/video.mp4', '/audio.wav', '/image.ppm']);
        if (!names.has(request.url)) { response.writeHead(404); response.end(); return; }
        const bytes = await fs.readFile(path.join(directory, request.url.slice(1)));
        response.writeHead(200, { 'Content-Length': bytes.length, 'Accept-Ranges': 'none' });
        response.end(bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    const progress = [];
    const player = new MpvPlayer({ enabled: true, serverUrl: url,
        linux: { command: 'mpv', args: ['--vo=null', '--ao=null', '--audio-display=no'] },
        windows: { command: 'mpv.exe', args: ['--vo=null', '--ao=null', '--audio-display=no'] }
    }, { resolveEnvironment: async options => options.env, onError: error => errors.push(error.message) });
    t.after(() => player.close());
    player.on('progress', data => progress.push(data));
    assert.equal(await player.checkAvailable(), true, '实机自测需预装mpv');
    assert.equal(await player.load({ type: 'url', url: `${url}/video.mp4`, mediaType: 'video' }, { paused: true, resumeTime: 1 }), true);
    const pid = player.process.pid;
    const runtimeDirectory = player.session.directory;
    assert.equal(await player.command(['get_property', 'pause']), true);
    await player.control('rotate', 90);
    await delay(150);
    assert.equal(await player.command(['get_property', 'video-rotate']), 90);
    assert.equal(await player.command(['get_property', 'volume']), 100);
    assert.equal(await player.load({ type: 'url', url: `${url}/audio.wav`, mediaType: 'audio' }), true);
    await delay(100);
    await player.control('play', false);
    await player.control('volume', 23);
    assert.equal(await player.command(['get_property', 'volume']), 23);
    assert.equal(await player.load({ type: 'base64', data: ppm.toString('base64'), mediaType: 'image' }), true);
    assert.equal(player.process.pid, pid);
    assert.equal(await player.command(['get_property', 'video-rotate']), 90);
    assert.ok(player.properties['video-dec-params'].dw > 0);
    await player.clear();
    assert.equal(player.process.pid, pid);
    assert.equal(await player.command(['get_property', 'idle-active']), true);
    assert.equal(await player.load({ type: 'url', url: `${url}/image.ppm`, mediaType: 'image' }), true);
    assert.equal(player.process.pid, pid);
    assert.ok(progress.some(item => item.mediaType === 'audio'));
    await player.close();
    await assert.rejects(fs.access(runtimeDirectory), /ENOENT/);
    assert.deepEqual(errors, []);
});
