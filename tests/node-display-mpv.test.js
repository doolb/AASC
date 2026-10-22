'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { MpvPlayer } = require('../src/apps/voice-display-node/mpv-player');
const { NodeMediaController } = require('../src/apps/voice-display-node/media-controller');
const { platformOptions, resolveXauthority, ipcAddress } = require('../src/apps/voice-display-node/mpv-platform');
const { calculateGeometry, normalizeCrop, normalizeRotation } = require('../src/apps/voice-display-node/mpv-geometry');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const root = path.resolve(__dirname, '..');
const media = (url = 'http://localhost/image.png', mediaType = 'image') => ({ type: 'url', url, mediaType });

// 与运行入口使用相同的导入声明，不能注入全局URL掩盖url模块与构造器的区别。
const mainUrlImports = source => source.split('\n').filter(line => /^const .*require\(['"](?:node:)?url['"]\);$/.test(line)).join('\n');

async function createPlayer(t, platform = process.platform, extra = {}) {
    const errors = [];
    const starts = [];
    const connections = [];
    let actualAddress;
    const player = new MpvPlayer({ enabled: true, serverUrl: 'http://localhost:3000',
        linux: { command: '/mock/mpv', args: ['--custom-option=a b'] },
        windows: { command: 'C:\\Program Files\\mpv\\mpv.exe', args: ['--custom-option=a b'] }
    }, {
        platform, env: { PATH: process.env.PATH }, commandTimeoutMs: 150, loadTimeoutMs: 1000,
        executeFile: async () => ({ stdout: 'mpv fake' }),
        resolveEnvironment: async options => options.env,
        spawn: (command, args, options) => {
            starts.push({ command, args, options });
            const address = args.find(value => value.startsWith('--input-ipc-server=')).slice('--input-ipc-server='.length);
            actualAddress = process.platform === 'win32' ? ipcAddress('win32')
                : (platform === 'win32' ? path.join(player.session.directory, 'fixture.sock') : address);
            return spawn(process.execPath, [path.join(__dirname, 'fixtures/fake-mpv.js'),
                ...args.filter(value => !value.startsWith('--input-ipc-server=')),
                ...(extra.fixtureNoScale ? ['--fixture-no-scale'] : []), `--input-ipc-server=${actualAddress}`], options);
        },
        connect: address => { connections.push(address); return net.createConnection(actualAddress); },
        onError: error => errors.push(error), ...extra
    });
    t.after(() => player.close());
    assert.equal(await player.checkAvailable(), true);
    return { player, starts, errors, connections };
}

test('文本媒体通过真实IPC加载正文层、翻页与旋转，切换视频移除正文且不重启mpv', async t => {
    const { player, starts } = await createPlayer(t);
    const sent = [];
    const controller = new NodeMediaController({ serverUrl: 'http://localhost' }, { player, send: data => sent.push(data) });
    t.after(() => controller.close());
    await controller.initialize();
    await controller.setCapabilities({ mediaRendering: true, displayText: true });
    const text = { type: 'base64', mediaType: 'text', data: Buffer.from('文档内容。'.repeat(1000)).toString('base64') };
    await controller.restore({ currentMedia: text, isPlaying: false, currentTextProgress: { pageIndex: 1 } });
    let body = await player.command(['get_property', 'test-text-overlay']);
    assert.equal(body.id, 41); assert.match(body.data, /文档内容/); assert.ok(body.data.includes('2 /'));
    await controller.handleControl({ action: 'textPlayback', value: { action: 'next' } });
    const documentLayout = controller.text.layout;
    const playbackId = controller.text.playbackId;
    const requests = sent.filter(message => message.type === 'textSentenceTts').length;
    for (let index = 0; index < 20; index++) controller.updateOverlay({ theme: index % 2 ? 'gold' : 'light', ttsOpacity: index / 20 });
    await player.queueOverlay();
    assert.equal(controller.text.layout, documentLayout);
    assert.equal(controller.text.playbackId, playbackId);
    assert.equal(controller.text.state, 'playing');
    assert.equal(sent.filter(message => message.type === 'textSentenceTts').length, requests);
    assert.equal(player.overlay.state.appearance.theme, 'gold');
    assert.equal(player.overlay.state.appearance.ttsOpacity, 0.95);
    assert.ok(player.session.lastTextOverlay.includes('396079'), '页码使用gold主题次级文字色');
    await controller.handleControl({ action: 'play', value: false });
    body = await player.command(['get_property', 'test-text-overlay']);
    assert.ok(body.data.includes('3 /'));
    await controller.handleControl({ action: 'rotate', value: 90 });
    assert.equal(controller.text.layout.rotation, 90);
    await controller.handleMedia(media('http://localhost/video.mp4', 'video'));
    body = await player.command(['get_property', 'test-text-overlay']);
    assert.equal(body.format, 'none'); assert.equal(starts.length, 1);
    assert.ok(sent.some(message => message.type === 'textProgress' && message.state === 'paused'));
});

test('Linux与Windows分别选择命令/环境，命名管道隔离且不执行shell', async t => {
    const linux = platformOptions({ linux: { command: '/some path/mpv', display: ':9', xauthority: '/tmp/auth file' } }, 'linux', { WAYLAND_DISPLAY: 'wayland-0' });
    assert.equal(linux.env.DISPLAY, ':9');
    assert.equal(linux.env.XAUTHORITY, '/tmp/auth file');
    assert.equal(linux.env.WAYLAND_DISPLAY, undefined);
    const windows = platformOptions({ windows: { command: 'C:\\Program Files\\mpv.exe' } }, 'win32', {});
    assert.equal(windows.command, 'C:\\Program Files\\mpv.exe');
    assert.equal(windows.env.DISPLAY, undefined);
    assert.throws(() => platformOptions({ linux: { args: 'mpv; touch bad' } }, 'linux'), /字符串数组/);
    assert.throws(() => platformOptions({}, 'darwin'), /仅支持/);
    assert.notEqual(ipcAddress('win32', ''), ipcAddress('win32', ''));
    const { player, starts, connections } = await createPlayer(t, 'win32');
    await player.load(media());
    assert.match(connections[0], /^\\\\\.\\pipe\\aasc-mpv-/);
    assert.equal(starts[0].options.shell, false);
    assert.equal(starts[0].command, 'C:\\Program Files\\mpv\\mpv.exe');
    assert.ok(starts[0].args.includes('--idle=yes'));
    assert.ok(starts[0].args.includes('--audio-exclusive=no'));
    assert.ok(starts[0].args.includes('--custom-option=a b'));
});

test('显式认证失败不偷偷替换，目标DISPLAY与认证传给探测器', async () => {
    const options = platformOptions({ linux: { display: ':3', xauthority: '/tmp/explicit' } }, 'linux', {});
    let received;
    const env = await resolveXauthority(options, async (command, args, settings) => { received = { command, args, settings }; });
    assert.equal(received.command, 'xdpyinfo');
    assert.equal(received.settings.env.DISPLAY, ':3');
    assert.equal(env.XAUTHORITY, '/tmp/explicit');
    await assert.rejects(resolveXauthority(options, async () => { throw new Error('denied'); }), /指定认证无法访问/);
    await assert.rejects(resolveXauthority(options, async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }), /安装xdpyinfo/);
});

test('缺省关闭与缺少mpv时不声明可用，不阻断语音客户端初始化', async () => {
    let calls = 0;
    const disabled = new MpvPlayer({}, { executeFile: async () => { calls += 1; } });
    assert.equal(await disabled.checkAvailable(), false);
    disabled.updateOverlay({ asrText: '不应创建字幕计时器' });
    await disabled.setOverlayEnabled(true);
    assert.equal(disabled.overlay.timer, null);
    assert.equal(disabled.overlay.hideTimers.size, 0);
    assert.equal(calls, 0);
    const errors = [];
    const missing = new MpvPlayer({ enabled: true }, { executeFile: async () => { throw new Error('ENOENT'); }, onError: error => errors.push(error) });
    assert.equal(await missing.checkAvailable(), false);
    assert.equal(errors.length, 1);
    await assert.rejects(missing.ensureStarted(), /不可用/);
});

test('视频→音频→图片→清空→新媒体只启动一个进程，临时文件与退出资源回收', async t => {
    const { player, starts } = await createPlayer(t);
    await player.load(media('http://localhost/video.mp4', 'video'));
    const pid = player.process.pid;
    const directory = player.session.directory;
    await player.control('play', false);
    await player.control('seek', 25);
    await player.control('volume', 37);
    const log = await player.command(['get_property', 'test-command-log']);
    assert.ok(log.some(command => command[0] === 'seek' && command[1] === 25 && command[2] === 'absolute-percent+exact'));
    assert.equal(await player.command(['get_property', 'pause']), true);
    assert.equal(await player.command(['get_property', 'volume']), 37);
    await player.load(media('http://localhost/audio.wav', 'audio'), { paused: true, resumeTime: 12 });
    assert.equal(await player.command(['get_property', 'time-pos']), 12);
    await player.load({ type: 'base64', mediaType: 'image', fileName: '../../bad.png', data: Buffer.from('image data').toString('base64') });
    const temporary = player.current.file;
    assert.equal(path.dirname(temporary), directory);
    assert.equal(await fsp.readFile(temporary, 'utf8'), 'image data');
    await player.clear();
    assert.equal(player.process.pid, pid);
    assert.equal(fs.existsSync(temporary), false);
    await player.load(media());
    assert.equal(player.process.pid, pid);
    assert.equal(starts.length, 1);
    await player.close();
    assert.equal(fs.existsSync(directory), false);
    assert.equal(player.pending.size, 0);
    assert.equal(player.dynamicTimer, null);
    await assert.rejects(player.ensureStarted(), /已关闭/);
});

test('快速请求只加载最后有效媒体，清空取消在途加载且不出现旧画面回调', async t => {
    const { player, starts } = await createPlayer(t);
    const first = player.load(media('http://localhost/first'));
    const last = player.load(media('http://localhost/last'));
    assert.equal(await first, false);
    assert.equal(await last, true);
    assert.equal(await player.command(['get_property', 'test-load-count']), 1);
    const loading = player.load(media('http://localhost/slow'));
    await delay(40);
    await player.clear();
    assert.equal(await loading, false);
    await delay(220);
    assert.equal(player.current, null);
    assert.equal(player.dynamicTimer, null);
    assert.equal(starts.length, 1);
});

test('超时/错误回执/媒体失败与代理回退均有界，IPC崩溃后按需重建', async t => {
    const { player, starts } = await createPlayer(t);
    await player.load(media());
    await assert.rejects(player.command(['ignore']), /超时/);
    await assert.rejects(player.command(['fail']), /命令失败/);
    assert.equal(player.pending.size, 0);
    await assert.rejects(player.load(media('http://localhost/fail')), /加载媒体失败/);
    assert.equal(await player.load({ ...media('http://localhost/fail'), fallbackUrl: 'http://localhost/fallback' }), true);
    const directory = player.session.directory;
    player.process.kill('SIGKILL');
    for (let attempt = 0; player.session && attempt < 100; attempt += 1) await delay(10);
    await player.load(media());
    assert.equal(starts.length, 2);
    for (let attempt = 0; fs.existsSync(directory) && attempt < 100; attempt += 1) await delay(10);
    assert.equal(fs.existsSync(directory), false);
});

test('旋转、六种模式与动态调度均复用进程，清空后无调度资源', async t => {
    const { player, starts } = await createPlayer(t);
    await player.load(media());
    await player.control('rotate', 90);
    for (const fit of ['contain', 'cover', 'height', 'width', 'crop', 'dynamic']) {
        await player.control('fit', fit);
        if (fit === 'dynamic') await player.control('dynamicFitConfig', { transitionSeconds: 0.1, holdSeconds: 0.1 });
        await delay(90);
        assert.equal(await player.command(['get_property', 'video-rotate']), 90);
    }
    assert.ok(player.dynamicTimer);
    await delay(250);
    const log = await player.command(['get_property', 'test-command-log']);
    assert.ok(log.some(command => command[1] === 'panscan' && command[2] > 0 && command[2] < 1));
    assert.ok(log.some(command => command[1] === 'panscan' && command[2] === 1));
    await player.control('fit', 'contain');
    await delay(100);
    assert.equal(player.dynamicTimer, null);
    assert.equal(await player.command(['get_property', 'video-scale-x']), 1);
    assert.equal(await player.command(['get_property', 'panscan']), 0);
    assert.equal(starts.length, 1);
    await player.clear();
    assert.equal(player.dynamicTimer, null);
    assert.equal(player.geometryTimer, null);
});

test('原生panscan不依赖尺寸，旧mpv无scale属性仍可适应/铺满/动态', async t => {
    const { player, errors } = await createPlayer(t, process.platform, { fixtureNoScale: true });
    await player.load(media());
    player.properties = {};
    await player.control('fit', 'cover');
    assert.equal(await player.command(['get_property', 'panscan']), 1);
    await player.control('fit', 'contain');
    assert.equal(await player.command(['get_property', 'panscan']), 0);
    await player.control('dynamicFitConfig', { holdSeconds: 0.1, transitionSeconds: 0.1 });
    await player.control('fit', 'dynamic');
    await delay(350);
    const log = await player.command(['get_property', 'test-command-log']);
    assert.ok(log.some(command => command[1] === 'panscan' && command[2] > 0 && command[2] < 1));
    assert.equal(player.unsupportedResetProperties.size, 2);
    assert.deepEqual(errors, []);
    await player.control('fit', 'contain');
    assert.equal(player.dynamicTimer, null);
});

test('原生panscan模式切换清除裁剪缩放和平移，高度/宽度保留四方向语义', async t => {
    const { player } = await createPlayer(t);
    await player.load(media());
    await player.control('crop', { x: 20, y: 10, width: 50, height: 60 });
    assert.ok(await player.command(['get_property', 'video-zoom']) > 0);
    await player.control('fit', 'cover');
    for (const [name, value] of [['video-scale-x', 1], ['video-scale-y', 1], ['video-pan-x', 0], ['video-pan-y', 0], ['video-zoom', 0], ['panscan', 1]]) {
        assert.equal(await player.command(['get_property', name]), value, name);
    }
    for (const [dw, dh] of [[1280, 720], [720, 1280]]) {
        for (const [w, h] of [[800, 600], [600, 800]]) {
            for (const rotation of [0, 90, 180, 270]) {
                player.properties['video-dec-params'] = { dw, dh, rotate: 0 };
                player.properties['osd-dimensions'] = { w, h };
                await player.control('rotate', rotation);
                for (const fit of ['height', 'width']) {
                    await player.control('fit', fit);
                    const expected = calculateGeometry({ width: dw, height: dh, windowWidth: w, windowHeight: h, rotation, fit });
                    const expectedPanscan = Math.max(expected.scaleX, expected.scaleY) > 1 + 1e-8 ? 1 : 0;
                    assert.equal(await player.command(['get_property', 'panscan']), expectedPanscan);
                }
            }
        }
    }
});

test('Linux/Windows无scale属性时裁剪仍能缩放及横纵移动，四方向保持同一进程', async t => {
    for (const platform of ['linux', 'win32']) {
        const { player, errors } = await createPlayer(t, platform, { fixtureNoScale: true });
        await player.load(media());
        const pid = player.process.pid;
        for (const rotation of [0, 90, 180, 270]) {
            await player.control('rotate', rotation);
            await player.control('crop', { x: 0, y: 0, width: 25, height: 25 });
            const zoom = await player.command(['get_property', 'video-zoom']);
            const startX = await player.command(['get_property', 'video-pan-x']);
            const startY = await player.command(['get_property', 'video-pan-y']);
            assert.ok(zoom >= 2);
            await player.control('crop', { x: 60, y: 50, width: 25, height: 25 });
            assert.ok(Math.abs(await player.command(['get_property', 'video-pan-x']) - startX + 0.6) < 1e-8);
            assert.ok(Math.abs(await player.command(['get_property', 'video-pan-y']) - startY + 0.5) < 1e-8);
            assert.equal(await player.command(['get_property', 'video-zoom']), zoom);
            assert.equal(await player.command(['get_property', 'panscan']), 0);
            assert.equal(player.process.pid, pid);
        }
        assert.deepEqual(errors, []);
    }
});

test('连续拖动合并在途与排队输入，只应用最新值，不先归零zoom/pan', async t => {
    const { player } = await createPlayer(t);
    await player.load(media());
    await delay(80);
    const command = player.command.bind(player);
    const before = (await command(['get_property', 'test-command-log'])).length;
    let release;
    let entered;
    const blocked = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    let gate = true;
    player.command = async request => {
        if (gate && request[0] === 'set_property' && request[1] === 'video-rotate') {
            gate = false;
            entered();
            await blocked;
        }
        return command(request);
    };
    const first = player.control('crop', { x: 1, y: 1, width: 20, height: 20 });
    await started;
    const pending = [];
    for (let index = 0; index < 200; index += 1) {
        const next = player.control('crop', { x: index / 4, y: index / 5, width: 20, height: 20 });
        assert.equal(next, first, '同一代次的连续输入共用完成回执');
        pending.push(next);
    }
    release();
    await Promise.all(pending);
    const log = (await command(['get_property', 'test-command-log'])).slice(before);
    const writes = log.filter(request => request[0] === 'set_property');
    assert.ok(writes.length < 20, `200次移动的IPC写入应合并，实际${writes.length}`);
    const zooms = writes.filter(request => request[1] === 'video-zoom');
    assert.equal(zooms.length, 1);
    assert.ok(zooms[0][2] > 0);
    assert.ok(!writes.some(request => ['video-pan-x', 'video-pan-y'].includes(request[1]) && request[2] === 0));
    const last = { x: 199 / 4, y: 199 / 5, width: 20, height: 20 };
    assert.deepEqual(player.visual.crop, last);
    assert.ok(Math.abs(await command(['get_property', 'video-pan-x']) + 0.0725) < 1e-8);
    assert.ok(Math.abs(await command(['get_property', 'video-pan-y']) - 0.002) < 1e-8);
    assert.equal(player.geometryUpdate, null);
});

test('裁剪等待尺寸后应用，音频阶段记忆，媒体切换/清空取消旧几何', async t => {
    const { player, errors } = await createPlayer(t, process.platform, { fixtureNoScale: true });
    await player.load(media('http://localhost/audio.wav', 'audio'));
    await player.control('crop', { x: 50, y: 50, width: 25, height: 25 });
    await player.load(media());
    const zoom = await player.command(['get_property', 'video-zoom']);
    assert.ok(zoom > 0);
    await delay(80);
    player.properties = {};
    await player.control('crop', { x: 20, y: 10, width: 50, height: 50 });
    assert.equal(await player.command(['get_property', 'video-zoom']), zoom, '无尺寸时保留画面，待就绪后应用');
    player.receiveEvent({ event: 'property-change', name: 'video-dec-params', data: { dw: 1280, dh: 720 } });
    player.receiveEvent({ event: 'property-change', name: 'osd-dimensions', data: { w: 800, h: 600 } });
    await delay(100);
    assert.ok(await player.command(['get_property', 'video-zoom']) < zoom);
    const stale = player.control('crop', { x: 60, y: 60, width: 20, height: 20 });
    const cleared = player.clear();
    assert.equal(await stale, false);
    await cleared;
    assert.equal(player.current, null);
    const old = player.control('crop', { x: 0, y: 0, width: 10, height: 10 });
    const loaded = player.load(media());
    const fit = player.control('fit', 'cover');
    assert.equal(await old, false);
    await Promise.all([loaded, fit]);
    assert.equal(await player.command(['get_property', 'video-zoom']), 0);
    assert.equal(await player.command(['get_property', 'video-pan-x']), 0);
    assert.equal(await player.command(['get_property', 'panscan']), 1);
    assert.deepEqual(errors, []);
});

test('ASS信息层沿用同一IPC，能力未知不启动、空闲显示、旋转与状态栏开关、崩溃不由时钟重启', async t => {
    const { player, starts } = await createPlayer(t, 'win32');
    const controller = new NodeMediaController({}, { player });
    await controller.initialize();
    controller.updateOverlay({ theme: 'gold', ttsOpacity: 0.6, connection: '已连接',
        ttsEvent: { phase: 'start', id: 1, text: '本机正在播放' }, asrText: '[小爱] 识别回显' });
    assert.equal(starts.length, 0);
    await controller.setCapabilities({ mediaRendering: true });
    assert.equal(starts.length, 1);
    assert.ok(starts[0].args.includes('--force-window=immediate'));
    const pid = player.process.pid;
    let rendered = await player.command(['get_property', 'test-overlay']);
    assert.match(rendered.data, /本机正在播放/);
    assert.match(rendered.data, /识别回显/);
    assert.deepEqual(player.overlay.state.appearance, { theme: 'gold', ttsOpacity: 0.6 });
    assert.ok(rendered.data.includes('0B86B8'), '能力确认前到达的主题在首次启动生效');
    await player.control('rotate', 90);
    controller.updateOverlay({ connection: '已断开', showStatusBar: false });
    await player.queueOverlay();
    rendered = await player.command(['get_property', 'test-overlay']);
    assert.match(rendered.data, /\\frz-90/);
    assert.doesNotMatch(rendered.data, /已断开/);
    assert.match(rendered.data, /本机正在播放/);
    assert.equal(player.process.pid, pid);
    player.process.kill('SIGKILL');
    for (let attempt = 0; player.session && attempt < 100; attempt += 1) await delay(10);
    await delay(1100);
    assert.equal(starts.length, 1, '1Hz时钟不得自动启动崩溃播放器');
    await player.load(media());
    assert.equal(starts.length, 2);
    controller.updateOverlay({ theme: 'light', ttsOpacity: 0.1 });
    await player.queueOverlay();
    assert.deepEqual(player.overlay.state.appearance, { theme: 'light', ttsOpacity: 0.1 });
    rendered = await player.command(['get_property', 'test-overlay']);
    assert.match(rendered.data, /识别回显/);
    await controller.setCapabilities({ mediaRendering: false });
    assert.equal((await player.command(['get_property', 'test-overlay'])).format, 'none');
    assert.equal(player.overlay.timer, null);
    assert.equal(player.overlay.hideTimers.size, 0);
    await player.close();
    assert.equal(player.overlayWrite, null);
});

test('几何与网页真实applyCrop一致：横竖媒体、窗口、四方向和六模式组合', () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    const start = source.indexOf('function applyCrop(options = {})');
    const end = source.indexOf('function applyCustomCrop(', start);
    assert.ok(start > 0 && end > start);
    for (const [width, height] of [[1280, 720], [720, 1280]]) {
        for (const [windowWidth, windowHeight] of [[800, 600], [600, 800]]) {
            for (const rotation of [0, 90, 180, 270]) {
                for (const fit of ['contain', 'cover', 'height', 'width', 'crop', 'dynamic']) {
                    const crop = { x: 12, y: 9, width: 61, height: 70 };
                    const element = { style: { display: 'block' }, classList: { remove() {}, add() {} }, naturalWidth: width, naturalHeight: height };
                    vm.runInNewContext(`${source.slice(start, end)}; applyCrop();`, {
                        mediaImage: element, mediaVideo: {}, mediaHtml: { style: { display: 'none' } },
                        currentRotation: rotation, currentFit: fit, dynamicGeometryMode: 'contain', currentCrop: crop,
                        document: { getElementById: () => ({ clientWidth: windowWidth, clientHeight: windowHeight }) }, _cropLog() {}
                    });
                    const turned = rotation % 180 !== 0;
                    const fallbackWidth = fit === 'height' ? windowHeight * width / height : windowWidth;
                    const fallbackHeight = fit === 'width' ? windowWidth * height / width : windowHeight;
                    const cssWidth = parseFloat(element.style.width) || fallbackWidth;
                    const cssHeight = parseFloat(element.style.height) || fallbackHeight;
                    const expectedWidth = turned ? cssHeight : cssWidth;
                    const expectedHeight = turned ? cssWidth : cssHeight;
                    const actual = calculateGeometry({ width, height, windowWidth, windowHeight, rotation, fit: fit === 'dynamic' ? 'contain' : fit, crop });
                    const description = JSON.stringify({ width, height, windowWidth, windowHeight, rotation, fit });
                    assert.ok(Math.abs(actual.width - expectedWidth) < 0.0001, `宽度 ${description}`);
                    assert.ok(Math.abs(actual.height - expectedHeight) < 0.0001, `高度 ${description}`);
                    if (fit === 'crop') {
                        const expectedLeft = parseFloat(element.style.left) + (turned ? (cssWidth - cssHeight) / 2 : 0);
                        const expectedTop = parseFloat(element.style.top) + (turned ? (cssHeight - cssWidth) / 2 : 0);
                        assert.ok(Math.abs(actual.left - expectedLeft) < 0.0001, `左偏移 ${description}`);
                        assert.ok(Math.abs(actual.top - expectedTop) < 0.0001, `上偏移 ${description}`);
                    }
                }
            }
        }
    }
    assert.equal(calculateGeometry({ width: 0 }), null);
    assert.throws(() => normalizeRotation(17), /旋转仅支持/);
    assert.ok(normalizeCrop({ x: 100, width: 0 }).width > 0);
});

class StubPlayer extends EventEmitter {
    constructor() { super(); this.calls = []; }
    async checkAvailable() { return true; }
    async load(...args) { this.calls.push(['load', ...args]); return true; }
    async clear() { this.calls.push(['clear']); }
    async control(...args) { this.calls.push(['control', ...args]); }
    async close() {}
}

test('权威恢复的裁剪位置与离线期间新位置进入真实mpv，回执保留关联ID', async t => {
    const { player, errors } = await createPlayer(t, process.platform, { fixtureNoScale: true });
    const sent = [];
    const controller = new NodeMediaController({}, { player, send: message => sent.push(message) });
    await controller.initialize();
    await controller.restore({ rotation: 270, fit: 'crop', crop: { x: 0, y: 0, width: 20, height: 20 }, currentMedia: media() });
    await controller.handleControl({ action: 'crop', value: { x: 60, y: 40, width: 20, height: 20 }, correlationId: 'crop-move' });
    await controller.setCapabilities({ mediaRendering: true });
    assert.equal(await player.command(['get_property', 'video-rotate']), 270);
    assert.ok(await player.command(['get_property', 'video-zoom']) > 0);
    assert.deepEqual(player.visual.crop, { x: 60, y: 40, width: 20, height: 20 });
    assert.ok(sent.some(message => message.correlationId === 'crop-move' && message.success));
    const pid = player.process.pid;
    await player.clear();
    await player.load(media('http://localhost/next.mp4', 'video'));
    assert.equal(player.process.pid, pid);
    assert.equal(await player.command(['get_property', 'video-rotate']), 270);
    assert.ok(await player.command(['get_property', 'video-zoom']) > 0);
    assert.deepEqual(errors, []);
});

test('媒体控制器等待权威能力、恢复暂停与断点、转发进度、关闭能力及重连隔离', async () => {
    const player = new StubPlayer();
    const sent = [];
    const controller = new NodeMediaController({}, { player, send: message => sent.push(message) });
    await controller.initialize();
    const state = { rotation: 270, fit: 'cover', crop: { x: 1 }, volume: 40,
        currentMedia: media(), isPlaying: false, currentMediaProgress: { currentTime: 18 } };
    await controller.restore(state);
    assert.equal(player.calls.length, 0);
    await controller.setCapabilities({ mediaRendering: true });
    assert.deepEqual(player.calls.find(call => call[0] === 'load')[2], { paused: true, resumeTime: 18 });
    assert.equal(player.calls.filter(call => call[1] === 'crop').length, 0);
    player.emit('progress', { mediaType: 'audio', currentTime: 3, duration: 9, isPlaying: true });
    assert.ok(sent.some(message => message.type === 'audioProgress' && message.duration === 9));
    await controller.setCapabilities({ mediaRendering: false });
    assert.equal(player.calls.at(-1)[0], 'clear');
    const before = player.calls.length;
    await controller.handleMedia(media());
    assert.equal(player.calls.length, before);
    controller.disconnected();
    await controller.handleMedia(media('http://localhost/stale'));
    controller.disconnected();
    await controller.setCapabilities({ mediaRendering: true });
    assert.equal(player.calls.length, before);
});

test('服务端配置更新保留跨平台播放器与录音设置，损坏配置保留原文件', () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/server/boot/server-app.js'), 'utf8');
    const start = source.indexOf('function updateVoiceDisplayConfig(');
    const end = source.indexOf('\nsetInterval(', start);
    let stored = JSON.stringify({ mediaPlayer: { enabled: true, linux: { display: ':7' } }, recordingMode: 'cut', vadThreshold: 0.02 });
    const sandbox = {
        PROJECT_ROOT: '/test', path, log() {}, logError() {},
        fs: { existsSync: () => true, readFileSync: () => stored, writeFileSync: (file, data) => { stored = data; } }
    };
    vm.runInNewContext(`${source.slice(start, end)}; updateVoiceDisplayConfig('10.0.0.9', 8081, 'https');`, sandbox);
    const saved = JSON.parse(stored);
    assert.equal(saved.serverUrl, 'https://10.0.0.9:8081');
    assert.equal(saved.mediaPlayer.linux.display, ':7');
    assert.equal(saved.recordingMode, 'cut');
    assert.equal(saved.vadThreshold, 0.02);
    stored = '{broken';
    vm.runInNewContext(`${source.slice(start, end)}; updateVoiceDisplayConfig('10.0.0.9', 8081, 'https');`, sandbox);
    assert.equal(stored, '{broken');
});

test('非法媒体输入、加载超时及退出时待回执均有界结束', async t => {
    const { player } = await createPlayer(t, process.platform, { loadTimeoutMs: 100 });
    await player.load(media());
    await assert.rejects(player.load(media('file:///tmp/private')), /仅支持HTTP/);
    await assert.rejects(player.load({ type: 'url', mediaType: 'image' }), /不能为空/);
    await assert.rejects(player.load({ type: 'base64', mediaType: 'video', data: '$bad' }), /base64无效/);
    await assert.rejects(player.load(media('http://localhost/file.html', 'html')), /仅支持图片/);
    await assert.rejects(player.load(media('http://localhost/never-load')), /加载媒体超时/);
    assert.equal(player.loading, null);
    const pending = assert.rejects(player.command(['ignore']), /关闭/);
    await player.close();
    await pending;
    assert.equal(player.pending.size, 0);
});

test('初始化期间退出不遗留子进程或临时目录，启动失败后可有界返回', async t => {
    const { player } = await createPlayer(t, process.platform, {
        spawn: () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }),
        connect: address => net.createConnection(address)
    });
    const loading = player.load(media());
    const failure = assert.rejects(loading, /取消|关闭|超时/);
    for (let attempt = 0; !player.process && attempt < 100; attempt += 1) await delay(5);
    const child = player.process;
    const directory = player.session.directory;
    await player.close();
    await failure;
    assert.ok(child.exitCode !== null || child.signalCode);
    assert.equal(fs.existsSync(directory), false);

    const failed = await createPlayer(t, process.platform, {
        spawn: () => spawn(path.join(directory, 'missing-mpv'), [], { stdio: 'ignore' }),
        connect: address => net.createConnection(address)
    });
    await assert.rejects(failed.player.load(media()), /超时|取消|关闭/);
});

test('VoiceDisplay真实消息分支连接媒体控制器，能力声明/旋转/音量/退出仍保留录音处理', async () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/voice-display-node/main.js'), 'utf8');
    const start = source.indexOf('class VoiceDisplay {');
    const end = source.indexOf('\nfunction loadConfig(', start);
    const mainErrors = [];
    const sandbox = {
        module: { exports: {} }, NodeMediaController, MEDIA_CONTROLS: require('../src/apps/voice-display-node/media-controller').MEDIA_CONTROLS,
        WindowsTextInputInjector: class { close() {} isAvailable() { return false; } }, WindowsGlobalHotkey: class { close() {} },
        normalizeTextInputVoiceprintPolicy: () => false, path, __dirname: '/test', AbortController, require,
        WINDOWS_VOICEPRINT_HOTKEY_LABEL: 'Alt+C', log() {}, logError: (...args) => mainErrors.push(args),
        AudioRecorder: class {}, formatAsrDisplayText: require('../src/apps/voice-display-node/asr-display').formatAsrDisplayText,
        useTUI: false, WebSocket: { OPEN: 1 }, clearTimeout, clearInterval
    };
    vm.runInNewContext(`${mainUrlImports(source)}\n${source.slice(start, end)}; module.exports = VoiceDisplay;`, sandbox);
    const instance = new sandbox.module.exports({ displayId: 'node-test', serverUrl: 'http://localhost' });
    const player = new StubPlayer();
    const overlayUpdates = [];
    player.updateOverlay = data => overlayUpdates.push(data);
    let closed = false;
    player.close = async () => { closed = true; };
    const sent = [];
    instance.ws = { readyState: 1, send: raw => sent.push(JSON.parse(raw)), close() {} };
    instance.media = new NodeMediaController({}, { player, send: message => instance.sendJSON(message) });
    await instance.media.initialize();
    instance.enableRecording = () => { instance.recordingEnabled = true; };
    instance.disableRecording = () => { instance.recordingEnabled = false; };
    instance.declareCapabilities();
    assert.equal(sent[0].capabilities.mediaRendering, true);
    instance.handleMessage('restoreState', { state: { fit: 'cover', currentMedia: media(), isPlaying: false } });
    instance.handleMessage('capabilitiesUpdated', { capabilities: { mediaRendering: true, voicePlayback: true, voiceRecording: true } });
    await delay(10);
    assert.equal(instance.recordingEnabled, true);
    assert.ok(player.calls.some(call => call[0] === 'load' && call[2].paused === true));
    instance.handleMessage('url', media());
    instance.handleMessage('base64', { type: 'base64', mediaType: 'image', data: 'aGVsbG8=' });
    instance.handleMessage('control', { action: 'rotate', value: 180, correlationId: 'rotate-one' });
    instance.handleMessage('control', { action: 'volume', value: 50 });
    instance.handleMessage('control', { action: 'setRecording', enabled: false });
    await delay(10);
    assert.equal(instance.recordingEnabled, false);
    assert.equal(instance._volume, 50);
    assert.ok(player.calls.some(call => call[0] === 'control' && call[1] === 'rotate' && call[2] === 180));
    assert.ok(sent.some(message => message.type === 'commandAck' && message.correlationId === 'rotate-one' && message.details === 'rotate'));
    // 媒体与TTS使用各自播放器：播报、停止播报、清空媒体不能互相调用停止接口。
    const ttsUrls = [];
    let ttsStops = 0;
    const queueOptions = [];
    instance.audio = { queueURL: (url, options) => { ttsUrls.push(url); queueOptions.push(options); }, stop: () => { ttsStops += 1; }, clearQueue() {} };
    const mediaCalls = player.calls.length;
    await instance.handleTTS({ action: 'playAudio', audioUrl: '/uploads/tts/speech.wav', text: '正在播放的字幕' });
    assert.deepEqual(ttsUrls, ['http://localhost/uploads/tts/speech.wav']);
    assert.equal(queueOptions[0].text, '正在播放的字幕');
    instance.connectionLabel = '已连接';
    instance.updateTUIConnectionState();
    assert.equal(overlayUpdates.at(-1).connection, '已连接');
    const overlays = overlayUpdates.length;
    instance.handleMessage('displayStatusBarConfig', { displayId: 'other-node', showStatusBar: false });
    assert.equal(overlayUpdates.length, overlays);
    instance.handleMessage('displayStatusBarConfig', { displayId: 'node-test', showStatusBar: false });
    assert.equal(overlayUpdates.at(-1).showStatusBar, false);
    instance.handleMessage('controlThemeChanged', { theme: 'gold' });
    assert.equal(overlayUpdates.at(-1).theme, 'gold');
    instance.handleMessage('displayTtsBackgroundOpacityConfig', { opacity: 0.6 });
    assert.equal(overlayUpdates.at(-1).ttsOpacity, 0.6);
    let recognize;
    let finishRecording;
    const results = [ { status: 'success', text: '你好', speaker: '小爱' }, { status: 'ignored', text: '没有声纹也回显' } ];
    instance.asr = { isReady: () => true, recognize: async () => results.shift(), close() {} };
    instance.recorder = { isRecording: () => false, isPaused: () => false,
        start: callback => { recognize = callback; return new Promise(resolve => { finishRecording = resolve; }); },
        stop: () => finishRecording?.() };
    instance.handleTextInputResult = async () => {};
    instance.recordingEnabled = true;
    await instance.startVoiceRecognition();
    await recognize(Buffer.from('wav'));
    assert.deepEqual(mainErrors, []);
    assert.equal(overlayUpdates.at(-1).asrText, '你好');
    await recognize(Buffer.from('wav'));
    assert.equal(overlayUpdates.at(-1).asrText, '没有声纹也回显');
    await instance.handleTTS({ action: 'stop' });
    assert.equal(ttsStops, 1);
    assert.equal(player.calls.length, mediaCalls);
    await instance.media.handleControl({ action: 'clearMedia' });
    assert.equal(ttsStops, 1);
    await instance.stop();
    assert.equal(closed, true);
});

test('真实URL导入支持TTS相对/绝对地址及一次失败回调，保留WebSocket地址解析', async () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/voice-display-node/main.js'), 'utf8');
    const start = source.indexOf('class VoiceDisplay {');
    const end = source.indexOf('\nfunction loadConfig(', start);
    const errors = [], queued = [], connections = [];
    const sandbox = { require, module: { exports: {} }, log() {}, logError: (_, message) => errors.push(message),
        WebSocket: class {
            constructor(address, options) { connections.push({ address, options }); throw new Error('连接夹具停止，不实际联网'); }
        }
    };
    vm.runInNewContext(`${mainUrlImports(source)}\n${source.slice(start, end)}; module.exports = VoiceDisplay;`, sandbox);
    // 只验证真实业务方法，不初始化TUI、录音或设备连接。
    const instance = Object.create(sandbox.module.exports.prototype);
    instance.config = { serverUrl: 'https://voice.example.invalid:8081' };
    instance.audio = { queueURL: (address, options) => queued.push({ address, options }) };
    const options = { owner: 'text:fixture', text: '现在时间是深夜10点整', onComplete() {} };
    for (const [address, expected] of [
        ['/uploads/tts/time.wav?q=%E4%BD%A0', 'https://voice.example.invalid:8081/uploads/tts/time.wav?q=%E4%BD%A0'],
        ['uploads/tts/time.wav', 'https://voice.example.invalid:8081/uploads/tts/time.wav'],
        ['http://cdn.example.invalid:8080/time.wav', 'http://cdn.example.invalid:8080/time.wav'],
        ['https://cdn.example.invalid/time.wav', 'https://cdn.example.invalid/time.wav']
    ]) {
        await instance.playAudioFromURL(address, options);
        assert.equal(queued.at(-1)?.address, expected);
        assert.equal(queued.at(-1).options, options);
    }
    assert.deepEqual(errors, []);
    for (const address of ['https://[bad', 'file:///tmp/time.wav', 'data:audio/wav;base64,YQ==']) {
        const completed = [];
        await instance.playAudioFromURL(address, { onComplete: (error, idle) => completed.push({ message: error.message, idle }) });
        assert.equal(completed.length, 1); assert.ok(completed[0].message); assert.equal(completed[0].idle, true);
        assert.equal(queued.length, 4, '非法地址不得加入音频队列');
    }
    assert.equal(errors.length, 3);
    instance.updateTUIConnectionState = () => {};
    instance.clientDisplayId = 'node-test';
    for (const [address, expected] of [
        ['https://voice.example.invalid:8081', 'wss://voice.example.invalid:8081/display?subDisplay=true&clientType=node&displayId=node-test'],
        ['http://voice.example.invalid:3000', 'ws://voice.example.invalid:3000/display?subDisplay=true&clientType=node&displayId=node-test']
    ]) {
        instance.config.serverUrl = address;
        await assert.rejects(instance.connect(), /连接夹具停止/);
        assert.equal(connections.at(-1).address, expected);
    }
    assert.equal(connections[0].options.rejectUnauthorized, false);
    assert.equal(connections[1].options, undefined);
});

test('TTS继续使用Windows PowerShell和Linux aplay内存输入，不调用mpv', async () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/voice-display-node/audio-player.js'), 'utf8');
    for (const platform of ['win32', 'linux']) {
        const sandbox = { module: { exports: {} }, Buffer, console,
            require: name => {
                if (name === 'os') return { platform: () => platform };
                if (name === 'node-fetch') return () => { throw new Error('本测试不得下载'); };
                return require(name);
            }
        };
        vm.runInNewContext(source, sandbox);
        const player = new sandbox.module.exports();
        const commands = [];
        player.runPlayer = async (...args) => { commands.push(args); };
        await player.playWavBuffer(Buffer.from('wav fixture'));
        assert.equal(commands.length, 1);
        assert.equal(commands[0][0], platform === 'win32' ? 'powershell.exe' : 'aplay');
        if (platform === 'win32') assert.match(commands[0][1].at(-1), /SoundPlayer/);
        assert.equal(typeof commands[0][2], platform === 'win32' ? 'string' : 'object');
    }
});

test('重连恢复尚未完成时，新媒体/清空优先，旧恢复不得覆盖后续请求', async () => {
    const player = new StubPlayer();
    const controller = new NodeMediaController({}, { player });
    await controller.initialize();
    await controller.setCapabilities({ mediaRendering: true });
    let release;
    player.control = action => action === 'clearMedia' ? player.clear() : new Promise(resolve => { release = resolve; });
    const restoring = controller.restore({ rotation: 90, currentMedia: media('http://localhost/old') });
    await controller.handleMedia(media('http://localhost/new'));
    release();
    await restoring;
    assert.deepEqual(player.calls.filter(call => call[0] === 'load').map(call => call[1].url), ['http://localhost/new']);
    player.calls = [];
    const anotherRestore = controller.restore({ rotation: 180, currentMedia: media('http://localhost/old') });
    const clear = controller.handleControl({ action: 'clearMedia' });
    release();
    await clear;
    await anotherRestore;
    assert.equal(player.calls.filter(call => call[0] === 'load').length, 0);
});

test('启动ASS空闲窗口期间的新媒体优先，能力关闭立即取消加载，旧初始化不恢复旧媒体', async () => {
    const player = new StubPlayer();
    let release;
    player.setOverlayEnabled = enabled => enabled ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
    const controller = new NodeMediaController({}, { player });
    await controller.initialize();
    await controller.restore({ fit: 'crop', currentMedia: media('http://localhost/old') });
    const activating = controller.setCapabilities({ mediaRendering: true });
    await controller.handleMedia(media('http://localhost/new'));
    release();
    await activating;
    assert.deepEqual(player.calls.filter(call => call[0] === 'load').map(call => call[1].url), ['http://localhost/new']);
    controller.disconnected();
    player.calls = [];
    await controller.restore({ currentMedia: media('http://localhost/old-again') });
    const reactivating = controller.setCapabilities({ mediaRendering: true });
    await controller.setCapabilities({ mediaRendering: false });
    assert.equal(player.calls.at(-1)[0], 'clear');
    release();
    await reactivating;
    assert.equal(player.calls.filter(call => call[0] === 'load').length, 0);
});
