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
const { overlayLayout, physicalPoint, escapeAss } = require('../src/apps/voice-display-node/mpv-overlay');
const { paginate } = require('../src/apps/voice-display-node/mpv-text-renderer');
const { paletteFor } = require('../src/apps/voice-display-node/mpv-appearance');
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

function brightPixels(bytes, rect) {
    let count = 0;
    for (let y = Math.max(0, Math.ceil(rect.top)); y < Math.min(600, rect.bottom); y += 1) {
        for (let x = Math.max(0, Math.ceil(rect.left)); x < Math.min(800, rect.right); x += 1) {
            if (pixel(bytes, x, y).every(value => value > 140)) count += 1;
        }
    }
    return count;
}

function boxRect(layout, box) {
    const corners = [[box.x, box.y], [box.x + box.width, box.y + box.height]].map(([x, y]) => physicalPoint(layout, x, y));
    return { left: Math.min(...corners.map(value => value[0])), right: Math.max(...corners.map(value => value[0])),
        top: Math.min(...corners.map(value => value[1])), bottom: Math.max(...corners.map(value => value[1])) };
}

test('真实ASS文本：黄底深灰正文/页码、四方向重排、信息层共存和清空，同一PID', { timeout: 25000 }, async t => {
    const display = await virtualDisplay(t);
    const errors = [];
    const player = new MpvPlayer({ enabled: true, linux: { display, command: 'mpv', args: [
        '--vo=x11', '--ao=null', '--geometry=800x600', '--cursor-autohide=always'
    ] } }, { onError: error => errors.push(error.message), overlayClock: { now: () => new Date(2026, 9, 22, 12, 34, 56) } });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    player.updateOverlay({ connection: '已连接', asrText: '识别回显', ttsEvent: { phase: 'start', id: 1, text: '当前朗读' } });
    await player.setOverlayEnabled(true);
    const pid = player.process.pid;
    const source = ('正文中文 ABC123 {\\pos(0,0)}。\n' + '长文内容'.repeat(40) + '\n').repeat(15);
    const samples = [];
    for (const rotation of [0, 90, 180, 270]) {
        await player.control('rotate', rotation);
        const layout = paginate(source, { width: 800, height: 600, rotation });
        await player.setTextPage({ layout, pageIndex: 0 });
        await delay(120);
        const frame = await capture(display);
        const background = pixel(frame, 400, 590);
        assert.ok(background[0] > 240 && background[1] > 225 && background[2] > 165 && background[2] < 200, `背景颜色: ${background}`);
        const countDark = (x, y, width, height, threshold = 130) => {
            const rect = boxRect(layout, { x, y, width, height });
            let count = 0;
            for (let py = Math.max(0, Math.ceil(rect.top)); py < Math.min(600, rect.bottom); py++) {
                for (let px = Math.max(0, Math.ceil(rect.left)); px < Math.min(800, rect.right); px++) {
                    if (pixel(frame, px, py).every(value => value < threshold)) count++;
                }
            }
            return count;
        };
        const bodyInk = countDark(layout.margin, layout.margin, 300, layout.lineHeight);
        const footerInk = countDark(layout.logicalWidth / 2 - 60, layout.logicalHeight - layout.margin - 28, 120, 32, 210);
        assert.ok(bodyInk > 200, `正文旋转${rotation}可见: ${bodyInk}`);
        assert.ok(footerInk > 20, `页码旋转${rotation}可见: ${footerInk}`);
        assert.match(player.session.lastOverlay, /12:34:56/);
        assert.match(player.session.lastOverlay, /当前朗读/);
        await player.setTextPage({ layout, pageIndex: 1 });
        assert.ok(player.session.lastTextOverlay.includes(`2 / ${layout.pages.length}`));
        samples.push({ rotation, pages: layout.pages.length, bodyInk, footerInk });
    }
    await player.setTextPage(null);
    await delay(120);
    assert.ok(pixel(await capture(display), 400, 590).every(value => value < 10), '清空移除正文背景');
    assert.equal(player.process.pid, pid); assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify(samples));
});

test('真实主题画面：白字/主题描边与下影/黑软影、ASR背景及TTS渐变透明度，四方向常驻', { timeout: 30000 }, async t => {
    const display = await virtualDisplay(t), errors = [];
    const player = new MpvPlayer({ enabled: true, linux: { display, command: 'mpv', args: [
        '--vo=x11', '--ao=null', '--geometry=800x600', '--cursor-autohide=always'
    ] } }, { onError: error => errors.push(error.message), overlayClock: { now: () => new Date(2026, 9, 22, 12, 34, 56) } });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true); await player.setOverlayEnabled(true);
    await player.load({ type: 'base64', mediaType: 'image', data: Buffer.concat([
        Buffer.from('P6\n16 16\n255\n'), Buffer.alloc(16 * 16 * 3, 180)
    ]).toString('base64') });
    await player.control('fit', 'cover');
    const pid = player.process.pid, samples = [];
    const countPixels = (frame, rect, predicate) => {
        let count = 0;
        for (let y = Math.max(0, Math.ceil(rect.top)); y < Math.min(600, rect.bottom); y++) {
            for (let x = Math.max(0, Math.ceil(rect.left)); x < Math.min(800, rect.right); x++) {
                if (predicate(pixel(frame, x, y))) count++;
            }
        }
        return count;
    };
    for (const theme of ['light', 'new-year-red']) {
        player.updateOverlay({ theme, ttsOpacity: 0.6, connection: '已连接', asrText: 'ASR识别文字',
            ttsEvent: { phase: 'start', id: 4, text: 'MMMM中文字幕' } });
        const background = paletteFor(theme).background.color.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
        for (const rotation of [0, 90, 180, 270]) {
            await player.control('rotate', rotation); await player.queueOverlay(); await delay(100);
            const layout = overlayLayout({ width: 800, height: 600, rotation, ...player.overlay.state });
            const frame = await capture(display);
            const sample = (x, y) => {
                const [px, py] = physicalPoint(layout, x, y);
                return pixel(frame, Math.max(0, Math.min(799, Math.floor(px))), Math.max(0, Math.min(599, Math.floor(py))));
            };
            const asrBackground = sample(layout.asr.x + layout.asr.width / 2, layout.asr.y + 3);
            assert.ok(asrBackground.every((value, index) => Math.abs(value - background[index]) < 5), `${theme}/${rotation} ASR背景: ${asrBackground}`);
            const peak = sample(layout.tts.x + layout.tts.width - 40, layout.tts.y + layout.tts.height / 2);
            const edge = sample(layout.tts.x + layout.tts.width - 40, layout.tts.y + 1);
            assert.ok(peak.every(value => Math.abs(value - 72) < 6), `渐变峰值应为180×0.4: ${peak}`);
            assert.ok(edge[0] > peak[0] + 60, `渐变边缘应更透明: ${edge}/${peak}`);
            const ttsRect = boxRect(layout, layout.tts);
            const tinted = countPixels(frame, ttsRect, channels => Math.max(...channels) - Math.min(...channels) > 25);
            const white = countPixels(frame, ttsRect, channels => channels.every(value => value > 210));
            assert.ok(tinted > 50, `主题细描边和下影可见: ${theme}/${rotation}/${tinted}`);
            assert.ok(white > 50, `白色字面可见: ${theme}/${rotation}/${white}`);
            const clockRect = boxRect(layout, { x: layout.clock.x - 240, y: 20, width: 240, height: 80 });
            const softShadow = countPixels(frame, clockRect, channels => Math.max(...channels) - Math.min(...channels) < 3 && channels[0] < 174 && channels[0] > 100);
            assert.ok(softShadow > 50, `时间黑色软阴影可见: ${softShadow}`);
            assert.equal(player.process.pid, pid); samples.push({ theme, rotation, peak, edge, tinted, white, softShadow });
        }
    }
    player.updateOverlay({ ttsOpacity: 0 }); await player.queueOverlay(); await delay(100);
    const layout = overlayLayout({ width: 800, height: 600, rotation: 270, ...player.overlay.state });
    const [x, y] = physicalPoint(layout, layout.tts.x + layout.tts.width - 40, layout.tts.y + layout.tts.height / 2);
    const cleared = pixel(await capture(display), Math.floor(x), Math.floor(y));
    assert.ok(cleared.every(value => Math.abs(value - 180) < 5), `透明度0清除背景: ${cleared}`);
    assert.deepEqual(errors, []); t.diagnostic(JSON.stringify(samples));
});

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

test('真实ASS：空闲时钟、四方向网页位置、裁剪不移动信息层、暂停/音频/清空继续显示及退出回收', { timeout: 45000 }, async t => {
    const display = await virtualDisplay(t);
    const errors = [];
    let time = new Date(2026, 9, 22, 12, 34, 56);
    const player = new MpvPlayer({ enabled: true, linux: { display, command: 'mpv', args: [
        '--vo=x11', '--ao=null', '--osc=no', '--osd-level=0', '--geometry=800x600', '--cursor-autohide=always'
    ] } }, { overlayClock: { now: () => time }, onError: error => errors.push(error.message) });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    await player.setOverlayEnabled(true);
    const pid = player.process.pid;
    await delay(200);
    const clockRect = { left: 500, top: 10, right: 795, bottom: 110 };
    assert.ok(brightPixels(await capture(display), clockRect) > 50, '没有媒体也应显示时钟');
    const literal = '中文{\\pos(0,0)}\\N字面\n换行';
    assert.equal(await player.command(['escape-ass', literal]), escapeAss(literal), '转义与mpv官方命令一致');
    const ppm = Buffer.concat([Buffer.from('P6\n16 16\n255\n'), Buffer.alloc(16 * 16 * 3)]);
    await player.load({ type: 'base64', mediaType: 'image', data: ppm.toString('base64') });
    player.updateOverlay({ connection: '已连接', ttsEvent: { phase: 'start', id: 1, text: '播放第一句中文' }, asrText: '[小爱]语音识别' });
    const samples = [];
    for (const rotation of [0, 90, 180, 270]) {
        await player.control('rotate', rotation);
        await player.control('crop', { x: 50, y: 50, width: 25, height: 25 });
        await player.queueOverlay();
        await delay(150);
        const image = await capture(display);
        const layout = overlayLayout({ width: 800, height: 600, rotation, ...player.overlay.state });
        const ttsCount = brightPixels(image, boxRect(layout, layout.tts));
        const asrCount = brightPixels(image, boxRect(layout, layout.asr));
        assert.ok(ttsCount > 50, `${rotation}度TTS应在网页同位置绘制中文，实际亮像素${ttsCount}`);
        assert.ok(asrCount > 50, `${rotation}度ASR应在网页同位置绘制中文，实际亮像素${asrCount}`);
        player.updateOverlay({ ttsEvent: { phase: 'stop' }, asrText: '' });
        await player.queueOverlay();
        await delay(100);
        const baseline = await capture(display);
        assert.ok(ttsCount - brightPixels(baseline, boxRect(layout, layout.tts)) > 50, 'TTS区域亮像素必须来自字幕本身');
        assert.ok(asrCount - brightPixels(baseline, boxRect(layout, layout.asr)) > 50, 'ASR区域亮像素必须来自回显本身');
        player.updateOverlay({ ttsEvent: { phase: 'start', id: rotation + 2, text: '播放第一句中文' }, asrText: '[小爱]语音识别' });
        await player.queueOverlay();
        assert.equal(player.process.pid, pid);
        samples.push({ rotation, ttsCount, asrCount });
    }
    await player.control('rotate', 0);
    const imageFile = path.join(player.session.directory, 'overlay.ppm');
    const videoFile = path.join(player.session.directory, 'overlay.mp4');
    await fs.writeFile(imageFile, ppm);
    await run('ffmpeg', ['-loglevel', 'error', '-loop', '1', '-i', imageFile, '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', videoFile], { timeout: 10000 });
    await player.load({ type: 'base64', mediaType: 'video', data: (await fs.readFile(videoFile)).toString('base64') });
    await player.control('play', false);
    await delay(100);
    const previous = await capture(display);
    time = new Date(2026, 9, 22, 12, 34, 57);
    await delay(1100);
    const paused = await capture(display);
    let changes = 0;
    for (let y = 20; y < 100; y += 1) {
        for (let x = 500; x < 790; x += 1) {
            if (pixel(previous, x, y).some((value, index) => value !== pixel(paused, x, y)[index])) changes += 1;
        }
    }
    assert.ok(changes > 20, '媒体暂停时1Hz时钟仍应变化');
    await player.clear();
    await delay(100);
    assert.ok(brightPixels(await capture(display), clockRect) > 50, '清空媒体不得移除信息层');
    const wav = Buffer.alloc(44 + 32000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(32000, 40);
    await player.load({ type: 'base64', mediaType: 'audio', data: wav.toString('base64') });
    await delay(100);
    assert.ok(brightPixels(await capture(display), clockRect) > 50, '纯音频也应显示信息层');
    assert.equal(player.process.pid, pid);
    await player.setOverlayEnabled(false);
    await delay(100);
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ removal: player.session.lastOverlay, active: player.overlay.active }));
    assert.equal(brightPixels(await capture(display), clockRect), 0, '关闭能力后移除信息层');
    await player.close();
    assert.equal(player.overlay.timer, null);
    assert.equal(player.overlay.hideTimers.size, 0);
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ display, samples, pausedClockPixelChanges: changes }));
});
