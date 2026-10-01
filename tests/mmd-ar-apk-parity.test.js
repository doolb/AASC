'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const APK_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/app/build/generated/assets/www');
const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');

test('APK与网页共用全部功能控件，APK仅增加原生定位接口控件', () => {
    const ids = (root) => cheerio.load(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))('[id]')
        .map((_index, node) => node.attribs.id).get().sort();
    const web = ids(WEB_ROOT);
    const apk = ids(APK_ROOT);
    const native = new Set(['mmdArNativeBackend', 'mmdArNativeCalibrationPanel', 'mmdArNativeCalibrationFile',
        'mmdArNativeCalibrationClear', 'mmdArNativeCalibrationHint']);
    assert.deepEqual(apk.filter(id => !native.has(id)), web);
    assert.equal(apk.length, new Set(apk).size);
    for (const module of ['web-motion-switch.mjs', 'web-physics-rate.mjs', 'web-gravity-filter.mjs',
        'web-skeleton-selection.mjs', 'web-skeleton-debug.mjs', 'web-rigid-body-debug.mjs', 'web-specular.mjs',
        'vendor/three/animation/MMDAnimationHelper.js', 'vendor/three/animation/MMDPhysics.js']) {
        assert.deepEqual(fs.readFileSync(path.join(APK_ROOT, 'js', module)), fs.readFileSync(path.join(WEB_ROOT, 'js', module)));
    }
});

test('原生目录转换保留子目录、释放读取令牌，取消和旧回调不替换当前选择', async () => {
    const { createNativeDirectoryPicker } = await import('../3rd/mmd-ar-test/web-local-assets-ui.mjs');
    const events = new EventTarget();
    const requests = [], releases = [];
    const picker = createNativeDirectoryPicker({ events,
        bridge: { chooseDirectory: id => requests.push(id), releaseDirectory: id => releases.push(id) },
        fetchFile: async () => new Response(new Blob(['fixture'], { type: 'image/png' })) });
    const send = detail => { const event = new Event('mmd-ar-directory-picked'); event.detail = detail; events.dispatchEvent(event); };
    const selected = picker.pick();
    send({ operation: requests[0], status: 'selected', files: [
        { path: '模型/tex/测试.png', url: `/picked-files/${randomUUID()}` } ] });
    send({ operation: requests[0], status: 'selected', files: [] });
    const files = await selected;
    assert.equal(files[0].webkitRelativePath, '模型/tex/测试.png');
    assert.equal(await files[0].text(), 'fixture');
    assert.deepEqual(releases, [requests[0]]);
    const cancelled = picker.pick();
    send({ operation: requests[0], status: 'error', message: '旧消息' });
    send({ operation: requests[1], status: 'cancelled' });
    assert.equal(await cancelled, null);
    const invalid = picker.pick();
    send({ operation: requests[2], status: 'selected', files: [{ path: '../私有', url: 'https://example.com/file' }] });
    await assert.rejects(invalid, /地址无效/u);
    const abandoned = picker.pick();
    picker.dispose();
    await assert.rejects(abandoned, /已结束/u);
});

test('模拟输入保持MindAR，真实输入释放网页摄像头后启动SLAM并在停止时归还生命周期', async () => {
    const calls = [];
    const root = new EventTarget();
    const nodes = new Map(['mmdArNativeCalibrationPanel', 'mmdArNativeBackend', 'mmdArNativeCalibrationHint',
        'mmdArNativeCalibrationFile', 'mmdArNativeCalibrationClear', 'mmdArInputMode', 'mmdArBenchmarkLive']
        .map(id => [id, new EventTarget()]));
    let simulated = true;
    Object.assign(root, { localStorage: { getItem: () => null }, setTimeout, clearTimeout,
        DisplayMmdImageTargetTracker: { start: async () => { calls.push('MindAR'); return 'fallback'; } },
        MmdArTestSimCamera: { isSimulated: () => simulated },
        MmdArGravityCamera: { prepareTracking: () => calls.push('releasePreview'), trackingStopped: () => calls.push('restorePreview') },
        createImageBitmap: async () => ({ width: 100, height: 100, close() {} }),
        MmdArNativeSlam: {
            getCapabilities: () => JSON.stringify({ protocolVersion: 1, engine: 'orb-slam3', available: true }),
            start() {
                calls.push('SLAM');
                queueMicrotask(() => {
                    const event = new Event('mmdNativeSlam');
                    event.detail = { type: 'ready', sessionId: 'test', generation: 1, width: 640, height: 480 };
                    root.dispatchEvent(event);
                });
                return JSON.stringify({ sessionId: 'test', generation: 1 });
            }, stop: () => calls.push('stopSLAM')
        } });
    const document = { getElementById: id => nodes.get(id), body: { classList: { add() {}, remove() {} } },
        createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,Zg==' }) };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../3rd/mmd-ar-test/display-mmd-ar-native.js'), 'utf8'),
        { window: root, document, console, Blob });
    assert.equal(await root.DisplayMmdImageTargetTracker.start({}), 'fallback');
    assert.equal(nodes.get('mmdArNativeCalibrationPanel').hidden, true);
    simulated = false;
    nodes.get('mmdArInputMode').dispatchEvent(new Event('change'));
    assert.equal(nodes.get('mmdArNativeCalibrationPanel').hidden, false);
    const session = await root.DisplayMmdImageTargetTracker.start({ referenceImageBlob: new Blob(['image']),
        selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] });
    assert.equal(session.backend, 'orb-slam3');
    await session.stop();
    await session.stop();
    assert.deepEqual(calls, ['MindAR', 'releasePreview', 'SLAM', 'stopSLAM', 'restorePreview']);
});

test('真实APK页面展开三面板、应用阴影与骨骼设置，并通过原生目录适配加载真实PMX', {
    timeout: 240000
}, async () => {
    const directory = path.join(APK_ROOT, 'mmd/miya');
    const relativeFiles = ['miya.pmx', ...fs.readdirSync(path.join(directory, 'tex')).map(name => `tex/${name}`)];
    const tokens = new Map();
    const manifest = relativeFiles.map(relative => {
        const token = randomUUID(); tokens.set(token, path.join(directory, relative));
        return { path: `miya/${relative}`, url: `/picked-files/${token}` };
    });
    const failures = [];
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        let file;
        if (pathname.startsWith('/picked-files/')) file = tokens.get(pathname.slice('/picked-files/'.length));
        else {
            const relative = pathname === '/' ? 'index.html' : pathname === '/api/mmd/resources' ? 'mmd-resources.json'
                : pathname.startsWith('/api/mmd/static/') ? pathname.slice('/api/mmd/static/'.length) : pathname.slice(1);
            file = path.join(APK_ROOT, relative);
        }
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            failures.push(pathname); response.writeHead(404); response.end(); return;
        }
        const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm',
            '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 480, height: 800 });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.evaluateOnNewDocument((files) => {
            window.directoryReleases = [];
            window.MmdArNativeFiles = {
                chooseDirectory(operation) {
                    window.dispatchEvent(new CustomEvent('mmd-ar-directory-picked', { detail: { operation, status: 'selected', files } }));
                },
                releaseDirectory(operation) { window.directoryReleases.push(operation); }
            };
        }, manifest);
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        await page.click('#displayMmdLightingToggle');
        assert.equal(await page.$eval('#displayMmdLightingPanel', node => node.hidden), false);
        await page.click('#displayMmdKeyShadowEnabled');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getLighting().keyShadowEnabled), false);
        await page.click('#mmdArMotionToggle');
        assert.equal(await page.$eval('#mmdArMotionPanel', node => node.hidden), false);
        assert.equal(await page.$eval('#displayMmdLightingPanel', node => node.hidden), true);
        await page.click('#mmdArSkeletonEnabled');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getSkeletonState().enabled), true);
        await page.click('#mmdArLocalAssets .mmd-ar-panel-group-toggle');
        await page.click('#mmdArLocalDirectoryButton');
        try {
            await page.waitForFunction(() => window.DisplayMmd.getModelProfile()?.resourceId.startsWith('local:')
                && document.getElementById('mmdArLocalDirectoryButton').disabled === false, { timeout: 90000 });
        } catch (error) {
            const state = await page.evaluate(() => ({ profile: window.DisplayMmd.getModelProfile(),
                message: document.getElementById('mmdArLocalMessage').textContent,
                disabled: document.getElementById('mmdArLocalDirectoryButton').disabled,
                releases: window.directoryReleases }));
            throw new Error(JSON.stringify({ state, errors, failures }), { cause: error });
        }
        assert.equal(await page.$eval('#mmdArLocalModelName', node => node.textContent), 'miya/miya.pmx');
        assert.equal(await page.evaluate(() => window.directoryReleases.length), 1);
        await (await page.$('#mmdArLocalVmd')).uploadFile(path.join(APK_ROOT, 'mmd/motions/miya-default.vmd'));
        await page.waitForFunction(() => window.DisplayMmd.getModelProfile().motionResourceId.startsWith('local:')
            && !document.getElementById('mmdArLocalVmdButton').disabled, { timeout: 90000 });
        await page.click('#displayArTargetToggle');
        assert.equal(await page.$eval('#displayArTargetPanel', node => node.hidden), false);
        await page.waitForFunction(() => document.getElementById('displayArTargetSelect').options.length > 0);
        assert.equal(await page.evaluate(async () => (await fetch('/assets/mindar-official-card.png')).status), 200);
        assert.deepEqual(errors, []);
        assert.deepEqual(failures.filter(pathname => pathname !== '/favicon.ico'), []);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
