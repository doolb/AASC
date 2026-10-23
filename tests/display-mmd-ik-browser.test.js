'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { createMotionCoordinator } = require('../src/apps/server/modules/sub-ai/motion-coordinator');
const { STATIC_MMD_RELEASE } = require('../src/apps/server/modules/mmd/mmd-resource-service');
const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const models = path.resolve(__dirname, '../3rd/mmd-ar-test/model-cache', STATIC_MMD_RELEASE.version, 'mmd');
const chrome = '/usr/bin/chromium';
const source = '@pose rest {\n head reset;\n}\n@pose nod {\n head bend forward 12;\n}\n@animation gesture {\n 0: rest;\n 0.5: nod;\n 1: rest;\n}\nmain {\n gesture;\n}';

test('正式PMX：IK面板、真实指针拖动、物理状态、自动动作门禁与关闭恢复', { timeout: 180000,
    skip: !fs.existsSync(chrome) || !fs.existsSync(path.join(models, 'miya/miya.pmx')) }, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    const scripts = new Set(['display-lipsync-audio.js', 'display-mmd-settings.js', 'display-mmd-human-bridge.js',
        'display-mmd.js', 'display-stage-panel-coordinator.js', 'display-mmd-panel-groups.js', 'display-mmd-lighting.js', 'display-mmd-production-controls.js',
        'display-mmd-physics-controls.js', 'display-mmd-performance.js', 'mmd-render-settings.mjs', 'mmd-screen-lighting-panel.mjs', 'mmd-actions-ui.mjs']);
    $('script').each((_i, node) => { if ($(node).attr('type') !== 'importmap' && !scripts.has(path.basename($(node).attr('src') || ''))) $(node).remove(); });
    const html = $.html();
    const server = http.createServer((req, res) => {
        const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
        if (!relative) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        if (relative === 'api/mmd/resources') {
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', resources: [{ resourceId: 'miya-default', modelType: 'pmx',
                modelUrl: '/models/mmd/miya/miya.pmx', motionUrl: '/models/mmd/motions/miya-default.vmd', motionResourceId: 'miya-default-motion' }] })); return;
        }
        const directory = relative.startsWith('models/mmd/') ? models : root;
        const file = path.resolve(directory, directory === models ? relative.slice(11) : relative);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });

    let browser; const errors = [];
    try {
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true, ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 640, height: 480 });
        page.on('console', m => { if (m.text().startsWith('[IK进度]')) console.error(m.text()); });
        page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
        console.error('[IK验收] 打开页面');
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        // 本测试验证真实骨骼/物理和指针，降低软件渲染像素开销，保留人体与服饰物理。
        await page.evaluate(() => {
            const groups = window.DisplayMmdLightingPresetGroups;
            groups?.lighting?.apply({ ...groups.lighting.read(), pmxAoEnabled: false, shadowSource: 'none', keyShadowEnabled: false });
            groups?.screenLighting?.apply({ ...groups.screenLighting.read(), giEnabled: false, contactEnabled: false });
            groups?.render?.apply({ ...groups.render.read(), aaMode: 'taa', taaEnabled: false, canvasScale: 0.25 });
        });
        console.error('[IK验收] 初始化角色');
        await page.evaluate(() => { window.DisplayMmd.init({ canvas: document.getElementById('displayMmdCanvas'), onLoadProgress: p => console.log('[IK进度]', JSON.stringify(p)) }); window.DisplayMmd.setVisible(true); });
        console.error('[IK验收] 等待模型');
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface()?.getState().ready, { timeout: 90000 });
        await page.evaluate(async () => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            const h = window.DisplayMmd.getHumanInterface(); h.physiology.set({ breathing: false, blinking: false }); h.gaze.set({ head: false, eyes: false });
            const { createChatActionPlayer } = await import('/js/mmd-chat-actions.mjs');
            window.messages = []; window.player = createChatActionPlayer({ api: () => h, send: m => window.messages.push(m) });
            window.player.setConnected(true); await window.player.tick();
        });
        assert.equal(await page.evaluate(() => window.messages.at(-1).catalog.ready), true);
        await page.addScriptTag({ path: path.join(root, 'js/display-stage.js') });
        await page.evaluate(() => window.DisplayStage.setMmdVisible(true));
        console.error('[IK验收] 打开IK面板');
        await page.click('#displayMmdIKToggle');
        console.error('[IK验收] 启用IK');
        await page.click('#displayMmdIKPanel [data-ik-action="enable"]');
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().enabled, { timeout: 30000 });
        console.error('[IK验收] 读取IK状态');
        const state = await page.evaluate(async () => { await window.player.tick(); return window.DisplayMmd.getHumanInterface().getInteractiveIKState(); });
        assert.equal(state.mode, 'physics'); assert.equal(state.targets, 11); assert.ok(state.physics.bodyCount >= 15);
        assert.equal(state.settings.gravity, false); assert.equal(state.settings.strength, 0.85);
        assert.equal(await page.evaluate(() => window.messages.at(-1).catalog.ready), false);
        console.error('[IK验收] 关闭面板');
        await page.click('#displayMmdIKClose');
        const point = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.find(c => c.key === 'leftHand').screen);
        assert.equal(point.visible, true);
        console.error('[IK验收] 实际拖点');
        await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 35, point.y - 35, { steps: 8 }); await page.mouse.up();
        const dragged = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
        assert.ok(dragged.activeTargets > 0); assert.equal(dragged.selected, 'leftHand');
        assert.ok(dragged.controls.every(c => [...c.achieved, ...c.rotation].every(Number.isFinite)));
        const settings = await page.evaluate(() => {
            const h = window.DisplayMmd.getHumanInterface();
            h.setInteractiveBodySettings({ dampingMultipliers: { wrist: 0.6 } });
            h.setInteractiveTargetState('leftHand', 'Hold', 'Hold');
            let rejected = false; try { h.setInteractiveTarget('leftHand', [0, 0, 0]); } catch { rejected = true; }
            h.setInteractiveTargetState('leftHand', 'Comply', 'Off');
            h.setInteractiveMarkerDiameter(40);
            return { rejected, state: h.getInteractiveIKState() };
        });
        assert.equal(settings.rejected, true); assert.equal(settings.state.settings.dampingMultipliers.wrist, 0.6); assert.equal(settings.state.markerDiameter, 40);
        console.error('[IK验收] 重置恢复');
        const reset = await page.evaluate(async () => {
            const h = window.DisplayMmd.getHumanInterface(); h.resetInteractiveIK(); const active = h.getInteractiveIKState().activeTargets;
            h.setInteractiveIKEnabled(false); await window.player.tick();
            return { active, state: h.getInteractiveIKState(), ready: window.messages.at(-1).catalog.ready, candidates: h.candidates.list().length };
        });
        assert.equal(reset.active, 0); assert.equal(reset.state.targets, 0); assert.equal(reset.state.physics, null); assert.equal(reset.ready, true); assert.equal(reset.candidates, 0);
        await page.evaluate(async () => { const h = window.DisplayMmd.getHumanInterface(); await h.setInteractiveIKMode('physics'); h.setInteractiveIKEnabled(true); window.DisplayStage.setMmdVisible(false); });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().enabled), false);
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); await new Promise(r => server.close(r)); }
});
