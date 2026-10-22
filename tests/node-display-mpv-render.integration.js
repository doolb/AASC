'use strict';

// 独立Xvnc屏幕中的真实画面验收：不连接或截取用户现有桌面，不开放VNC/TCP监听。
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const run = promisify(execFile);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function virtualDisplay(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-mpv-render-'));
    const server = spawn('Xvnc', ['-displayfd', '3', '-geometry', '800x600', '-depth', '24',
        '-rfbport', '-1', '-rfbunixpath', path.join(directory, 'vnc.sock'),
        '-localhost', '-SecurityTypes', 'None', '-nolisten', 'tcp', '-ac', '-noreset'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    server.stderr.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-4000); });
    const exited = new Promise(resolve => { server.once('close', resolve); server.once('error', resolve); });
    t.after(async () => {
        if (server.exitCode === null && !server.signalCode) {
            server.kill('SIGTERM');
            await Promise.race([exited, delay(1000)]);
            if (server.exitCode === null && !server.signalCode) server.kill('SIGKILL');
        }
        await fs.rm(directory, { recursive: true, force: true });
    });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`虚拟显示启动超时：${diagnostic}`)), 8000);
        let value = '';
        server.stdio[3].on('data', chunk => {
            value += chunk.toString();
            if (!value.includes('\n')) return;
            clearTimeout(timer);
            resolve(`:${value.trim()}`);
        });
        server.once('error', error => { clearTimeout(timer); reject(error); });
        server.once('close', code => { clearTimeout(timer); reject(new Error(`虚拟显示退出(${code})：${diagnostic}`)); });
    });
}

async function capture(display) {
    const result = await run('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0',
        '-framerate', '30', '-video_size', '800x600', '-i', display,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 3 * 1024 * 1024, timeout: 5000 });
    assert.equal(result.stdout.length, 800 * 600 * 3);
    return result.stdout;
}

function pixel(bytes, x, y) {
    const offset = (y * 800 + x) * 3;
    return [...bytes.subarray(offset, offset + 3)];
}

test('真实渲染：四方向contain有黑边、cover填满并裁切，常驻PID不变', { timeout: 45000 }, async t => {
    const display = await virtualDisplay(t);
    const errors = [];
    const player = new MpvPlayer({ enabled: true, linux: { display, command: 'mpv', args: [
        '--vo=x11', '--ao=null', '--osc=no', '--osd-level=0', '--geometry=800x600', '--cursor-autohide=always'
    ] } }, { onError: error => errors.push(error.message) });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    const pixels = Buffer.alloc(160 * 90 * 3);
    for (let y = 0; y < 90; y += 1) {
        for (let x = 0; x < 160; x += 1) pixels[(y * 160 + x) * 3 + (x < 40 ? 0 : x < 120 ? 1 : 2)] = 255;
    }
    const ppm = Buffer.concat([Buffer.from('P6\n160 90\n255\n'), pixels]);
    await player.load({ type: 'base64', mediaType: 'image', data: ppm.toString('base64') });
    const pid = player.process.pid;
    const results = [];
    for (const rotation of [0, 90, 180, 270]) {
        await player.control('rotate', rotation);
        await player.control('fit', 'contain');
        await delay(200);
        const border = rotation % 180 === 0 ? [400, 10] : [10, 300];
        const contained = pixel(await capture(display), ...border);
        assert.ok(contained.every(value => value < 20), `contain ${rotation}边缘应为黑色，实际${contained}`);
        await player.control('fit', 'cover');
        await delay(200);
        const covered = pixel(await capture(display), ...border);
        assert.ok(covered[1] > 180 && covered[0] < 60 && covered[2] < 60,
            `cover ${rotation}边缘应填满绿色媒体，实际${covered}`);
        assert.equal(player.process.pid, pid);
        assert.equal(await player.command(['get_property', 'panscan']), 1);
        results.push({ rotation, contain: contained, cover: covered });
    }
    await player.close();
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ display, samples: results }));
});
