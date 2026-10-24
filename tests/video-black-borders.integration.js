'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const fps of [30, 60]) test(`隔离真实mpv ${fps}fps逐帧元数据/线程检测，旋转/暂停与清空`, { timeout: 20000 }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-real-black-borders-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'border.mp4');
    await run('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=900x540:d=8:r=${fps}`,
        '-vf', 'pad=1280:720:180:90:black', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', file], { timeout: 10000 });
    const bytes = await fs.readFile(file);
    const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Length': bytes.length }); response.end(bytes); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const errors = [];
    const player = new MpvPlayer({ enabled: true, serverUrl: `http://127.0.0.1:${server.address().port}`,
        linux: { command: 'mpv', args: ['--vo=null', '--ao=null', '--vf=@user-test:lavfi=[null]'] } },
    { resolveEnvironment: async options => options.env, onError: error => errors.push(error.message) });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    await player.load({ type: 'url', url: '/border.mp4', mediaType: 'video' });
    const started = Date.now(), deadline = started + 1500;
    while (!player.blackBorders.cropped && Date.now() < deadline) await delay(10);
    assert.ok(player.blackBorders.cropped, `应收到真实Lua取样: ${errors.join(',')}`);
    const rect = { ...player.blackBorders.rect };
    assert.ok(Math.abs(rect.x - 180 / 1280) < 0.025 && Math.abs(rect.y - 90 / 720) < 0.025);
    const firstResultMs = Date.now() - started;
    const before = player.blackBorders.pipeline.stats.submitted;
    const from = await player.command(['get_property', 'time-pos']);
    await delay(1000);
    const samples = player.blackBorders.pipeline.stats.submitted - before;
    const to = await player.command(['get_property', 'time-pos']);
    t.diagnostic(JSON.stringify({ fps, firstResultMs, samples, sourceFrames: Math.round((to - from) * fps) }));
    assert.ok(samples > fps / 4, '真实取样必须达到逐帧级别，不能退化为每秒定时器');
    await player.control('rotate', 90);
    const stamp = player.blackBorders.tracker.stamp;
    await delay(400);
    assert.notEqual(player.blackBorders.tracker.stamp, stamp);
    assert.ok(Math.abs(player.blackBorders.rect.x - rect.x) < 0.02);
    await player.control('play', false);
    await delay(100);
    const pausedStamp = player.blackBorders.tracker.stamp;
    await delay(300); assert.equal(player.blackBorders.tracker.stamp, pausedStamp);
    await player.clear(); assert.equal(player.blackBorders.active, false);
    const removedBy = Date.now() + 1000;
    let filters;
    do { filters = await player.command(['get_property', 'vf']); if (!filters.some(filter => filter.label === 'aasc-black-borders')) break; await delay(10); } while (Date.now() < removedBy);
    assert.ok(filters.some(filter => filter.label === 'user-test'), '关闭仅移除自己的分析滤镜');
    assert.ok(!filters.some(filter => filter.label === 'aasc-black-borders'));
    await player.close(); assert.equal(player.blackBorders.pipeline.worker, null);
    assert.deepEqual(errors, []);
    if (fps === 30) await t.test('原生分析滤镜不可用时自动回退截图，仍可两帧确认并清理', async t => {
        const lua = await fs.readFile(path.resolve(__dirname, '../src/apps/voice-display-node/mpv-black-borders.lua'), 'utf8');
        const unavailable = lua.replace('cropdetect=limit=24:round=2:reset=1,blackframe=amount=0:threshold=40', 'aasc_missing_native_filter');
        assert.notEqual(unavailable, lua);
        const script = path.join(directory, 'fallback.lua'); await fs.writeFile(script, unavailable);
        const fallbackErrors = [];
        const fallback = new MpvPlayer({ enabled: true, serverUrl: `http://127.0.0.1:${server.address().port}`,
            linux: { command: 'mpv', args: ['--vo=null', '--ao=null'] } }, {
            resolveEnvironment: async options => options.env, onError: error => fallbackErrors.push(error.message),
            spawn: (command, args, options) => spawn(command, args.map(arg => arg.startsWith('--script=') ? `--script=${script}` : arg), options)
        });
        t.after(() => fallback.close()); await fallback.checkAvailable();
        await fallback.load({ type: 'url', url: '/border.mp4', mediaType: 'video' });
        const deadline = Date.now() + 2500;
        while (!fallback.blackBorders.cropped && Date.now() < deadline) await delay(10);
        assert.ok(fallback.blackBorders.cropped, fallbackErrors.join(','));
        assert.deepEqual(fallbackErrors, []);
        const filters = await fallback.command(['get_property', 'vf']);
        assert.ok(!filters.some(filter => filter.label === 'aasc-black-borders'), '失败的自身滤镜不能残留');
        await fallback.close(); assert.equal(fallback.blackBorders.pipeline.worker, null);
    });
});
