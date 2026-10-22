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

test('真实渲染：四方向裁剪横纵移动与缩放、连续拖动及填充复位', { timeout: 60000 }, async t => {
    const display = await virtualDisplay(t);
    const errors = [];
    const player = new MpvPlayer({ enabled: true, linux: { display, command: 'mpv', args: [
        '--vo=x11', '--ao=null', '--osc=no', '--osd-level=0', '--geometry=800x600', '--cursor-autohide=always'
    ] } }, { onError: error => errors.push(error.message) });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    // 红色随原图横轴、绿色随纵轴递增，可独立检查旋转后两个移动方向，避免同色块误判。
    const pixels = Buffer.alloc(160 * 90 * 3);
    for (let y = 0; y < 90; y += 1) {
        for (let x = 0; x < 160; x += 1) {
            const offset = (y * 160 + x) * 3;
            pixels[offset] = Math.round((x + 0.5) / 160 * 255);
            pixels[offset + 1] = Math.round((y + 0.5) / 90 * 255);
            pixels[offset + 2] = 40;
        }
    }
    const ppm = Buffer.concat([Buffer.from('P6\n160 90\n255\n'), pixels]);
    await player.load({ type: 'base64', mediaType: 'image', data: ppm.toString('base64') });
    const pid = player.process.pid;
    const samples = [];
    for (const rotation of [0, 90, 180, 270]) {
        await player.control('rotate', rotation);
        const turned = rotation % 180 !== 0;
        const visualWidth = turned ? 90 : 160;
        const visualHeight = turned ? 160 : 90;
        const width = 25;
        const height = (visualWidth * width / (4 / 3)) / visualHeight;
        for (const [x, y] of [[0, 0], [75, 0], [0, 100 - height], [75, 100 - height]]) {
            // 同一批连续输入最终停在目标角，验证实际画面而非只检查IPC属性。
            const updates = [];
            for (let step = 0; step <= 20; step += 1) {
                updates.push(player.control('crop', { x: x * step / 20, y: y * step / 20, width, height }));
            }
            await Promise.all(updates);
            await delay(150);
            const actual = pixel(await capture(display), 400, 300);
            const vx = (x + width / 2) / 100 * visualWidth;
            const vy = (y + height / 2) / 100 * visualHeight;
            // 仅从图案坐标和旋转的逆变换推导期望，不使用生产几何函数作为验收判据。
            const original = { 0: [vx, vy], 90: [vy, 90 - vx], 180: [160 - vx, 90 - vy], 270: [160 - vy, vx] }[rotation];
            const expected = [Math.round(original[0] / 160 * 255), Math.round(original[1] / 90 * 255), 40];
            assert.ok(actual.every((value, channel) => Math.abs(value - expected[channel]) < 8),
                `${rotation}度，裁剪(${x},${y})中心像素${actual}，预期${expected}`);
            assert.equal(player.process.pid, pid);
            samples.push({ rotation, x, y, actual, expected });
        }
        const zoom = await player.command(['get_property', 'video-zoom']);
        await player.control('crop', { x: 0, y: 0, width: 50, height: height * 2 });
        assert.ok(Math.abs(await player.command(['get_property', 'video-zoom']) - zoom + 1) < 1e-8);
        await player.control('fit', 'contain');
        await delay(100);
        const centered = pixel(await capture(display), 400, 300);
        assert.ok(Math.abs(centered[0] - 128) < 8 && Math.abs(centered[1] - 128) < 8);
        assert.equal(await player.command(['get_property', 'video-zoom']), 0);
        assert.equal(await player.command(['get_property', 'video-pan-x']), 0);
        assert.equal(await player.command(['get_property', 'video-pan-y']), 0);
    }
    // 同一图案编码为真实视频，确认解码播放路径中的裁剪移动也生效，未另起播放器。
    const imageFile = path.join(player.session.directory, 'gradient.ppm');
    const videoFile = path.join(player.session.directory, 'gradient.mp4');
    await fs.writeFile(imageFile, ppm);
    await run('ffmpeg', ['-loglevel', 'error', '-loop', '1', '-i', imageFile, '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', videoFile], { timeout: 10000 });
    await player.control('rotate', 0);
    await player.load({ type: 'base64', mediaType: 'video', data: (await fs.readFile(videoFile)).toString('base64') });
    for (const [x, expected] of [[0, [32, 43, 40]], [75, [223, 43, 40]]]) {
        await player.control('crop', { x, y: 0, width: 25, height: 100 / 3 });
        await delay(150);
        const actual = pixel(await capture(display), 400, 300);
        assert.ok(actual.every((value, channel) => Math.abs(value - expected[channel]) < 10),
            `视频裁剪x=${x}中心像素${actual}，预期${expected}`);
        assert.equal(player.process.pid, pid);
        samples.push({ video: true, x, actual, expected });
    }
    await player.close();
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ display, samples }));
});
