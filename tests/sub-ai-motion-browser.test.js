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

test('真实PMX/Worker：库命中零生成、缺库生成完整播放自动入候选、采用才切默认', {
    timeout: 180000, skip: !fs.existsSync(chrome) || !fs.existsSync(path.join(models, 'miya/miya.pmx'))
}, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    const scripts = new Set(['display-lipsync-audio.js', 'display-mmd-settings.js', 'display-mmd-human-bridge.js',
        'display-mmd.js', 'display-mmd-panel-groups.js', 'display-mmd-lighting.js', 'display-mmd-production-controls.js',
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
    let browser, coordinator;
    const errors = [], statuses = []; let generations = 0;
    try {
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true, ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 640, height: 480 });
        page.on('pageerror', e => errors.push(e.message));
        coordinator = createMotionCoordinator({ models: { selection: () => ({ enabled: true }), generate: async () => {
            generations++; return { source, providerId: 'fixture', model: 'fixture-motion' };
        } }, send: (_id, message) => { void page.evaluate(message => window.actionPlayer?.handle(message), message).catch(e => errors.push(e.message)); }, publish: m => statuses.push(m) });
        await page.exposeFunction('motionSend', message => coordinator.handle('display', message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd);
        await page.evaluate(() => { window.DisplayMmd.init({ canvas: document.getElementById('displayMmdCanvas'), onLoadProgress() {} }); window.DisplayMmd.setVisible(true); });
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface()?.getState().ready, { timeout: 90000 });
        const initial = await page.evaluate(async source => {
            const human = window.DisplayMmd.getHumanInterface();
            const old = await human.learn.register({ actionId: '原动作', source });
            const { createChatActionPlayer } = await import('/js/mmd-chat-actions.mjs');
            window.actionMessages = [];
            window.actionPlayer = createChatActionPlayer({ api: () => window.DisplayMmd.getHumanInterface(),
                send: message => { window.actionMessages.push(message); void window.motionSend(message); }, report: text => { window.motionReport = text; } });
            window.actionPlayer.setConnected(true); await window.actionPlayer.tick();
            window.actionTimer = setInterval(() => { void window.actionPlayer.tick(); }, 100);
            return { active: old.id, key: human.actionKey() };
        }, source);
        for (let i = 0; i < 50 && !coordinator.prompt('display'); i++) await new Promise(r => setTimeout(r, 100));
        assert.match(coordinator.prompt('display'), /原动作/);
        coordinator.begin('display', 'known'); coordinator.request('display', 'known', { prompt: '原动作', references: [] });
        await page.waitForFunction(() => window.actionMessages.some(m => m.op === 'result' && m.status === 'completed'), { timeout: 30000 });
        assert.equal(generations, 0);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().candidates.list().length), 0);
        coordinator.begin('display', 'unknown'); coordinator.request('display', 'unknown', { prompt: '缓缓低头再恢复', references: [] });
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().candidates.list().length === 1, { timeout: 30000 });
        await page.waitForFunction(() => window.actionMessages.filter(m => m.op === 'result' && m.status === 'completed').length === 2, { timeout: 10000 });
        const result = await page.evaluate(async oldActive => {
            clearInterval(window.actionTimer);
            const human = window.DisplayMmd.getHumanInterface(), candidate = human.candidates.list()[0];
            const before = human.learn.list()[0].active;
            const file = human.learn.export();
            const exported = JSON.parse(await file.text());
            const prepared = await human.prepareMpl(candidate.source, { owner: 'candidate:preview' });
            const activeBeforeStart = human.getState().layers.length;
            const adopted = await human.candidates.adopt(candidate.id, '原动作');
            return { before, oldActive, exportedSchema: exported.schema, exportedCandidates: exported.candidates.length,
                duration: prepared.duration, activeBeforeStart, active: human.learn.list()[0].active, adopted: adopted.id, remaining: human.candidates.list().length };
        }, initial.active);
        assert.equal(generations, 1); assert.equal(result.before, initial.active); assert.equal(result.exportedSchema, 2);
        assert.equal(result.exportedCandidates, 1); assert.equal(result.duration, 1); assert.equal(result.activeBeforeStart, 0);
        assert.equal(result.active, result.adopted); assert.notEqual(result.active, initial.active); assert.equal(result.remaining, 0);
        assert.equal(statuses.filter(s => s.state === 'completed').length, 2);
        assert.deepEqual(errors, []);
    } finally { coordinator?.dispose(); await browser?.close(); await new Promise(r => server.close(r)); }
});

test('两端动作模型面板独立Provider/模型与启用值，主AI为Agent也可设置', { skip: !fs.existsSync(chrome) }, async () => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage(); await page.setContent('<div id="control"></div><div id="display"></div>');
        await page.addScriptTag({ path: path.join(root, 'js/chat-model-tier-picker.js') });
        await page.evaluate(() => {
            window.sent = []; window.pickers = ['control', 'display'].map(prefix => window.ChatModelTierPicker.create({
                host: document.getElementById(prefix), prefix, send: m => { window.sent.push(m); return true; } }));
            window.snapshot = { type: 'chatModelTierConfig', selection: { profileMode: 'agent', modelName: 'main' }, providers: [],
                motionSelection: { enabled: false, providerId: 'qwen', model: 'motion-a' }, motionRevision: 'revision-1',
                motionProviders: [{ id: 'qwen', name: 'Qwen', models: [{ id: 'motion-a', name: 'A' }, { id: 'motion-b', name: 'B' }] }] };
            for (const picker of window.pickers) { picker.setConnected(true); picker.handleMessage(window.snapshot); }
        });
        await page.click('#controlChatModelTierToggle');
        await page.select('#controlChatModelTierPanel [data-motion-model]', 'motion-b');
        assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), { type: 'setChatModelTierSelection', purpose: 'motion', providerId: 'qwen', model: 'motion-b', enabled: false, revision: 'revision-1' });
        await page.evaluate(() => { window.snapshot.motionSelection.model = 'motion-b'; window.snapshot.motionRevision = 'revision-2'; for (const p of window.pickers) p.handleMessage(window.snapshot); });
        await page.click('#controlChatModelTierPanel [data-motion-enabled]');
        assert.equal(await page.evaluate(() => window.sent.at(-1).enabled), true);
        assert.equal(await page.$eval('#displayChatModelTierPanel [data-motion-model]', el => el.value), 'motion-b');
        assert.equal(await page.$eval('#controlChatModelTierPanel [data-provider]', el => el.disabled), true);
        assert.equal(await page.$eval('#controlChatModelTierPanel [data-motion-provider]', el => el.disabled), false);
    } finally { await browser.close(); }
});
