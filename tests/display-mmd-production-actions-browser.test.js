'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const { STATIC_MMD_RELEASE } = require('../src/apps/server/modules/mmd/mmd-resource-service');
const MODELS = path.resolve(__dirname, '../3rd/mmd-ar-test/model-cache', STATIC_MMD_RELEASE.version, 'mmd');
const CHROME = '/usr/bin/chromium';

test('正式真实PMX：灯光保存/预设、待机/动态目录、MPL静默填入与真实TTS优先', {
    timeout: 240000, skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(MODELS, 'miya/miya.pmx'))
}, async () => {
    // 使用正式HTML、脚本和真实米娅，只隔离服务器连接及摄像头业务。
    const $ = cheerio.load(fs.readFileSync(path.join(ROOT, 'display.html'), 'utf8'));
    const scripts = new Set(['display-lipsync-audio.js', 'display-mmd-settings.js', 'display-mmd-human-bridge.js',
        'display-mmd.js', 'display-mmd-panel-groups.js', 'display-mmd-lighting.js', 'display-mmd-production-controls.js',
        'display-mmd-physics-controls.js', 'display-mmd-performance.js', 'mmd-render-settings.mjs', 'mmd-screen-lighting-panel.mjs', 'mmd-actions-ui.mjs', 'mmd-tts-actions.mjs']);
    $('script').each((_index, node) => {
        if ($(node).attr('type') !== 'importmap' && !scripts.has(path.basename($(node).attr('src') || ''))) $(node).remove();
    });
    const errors = [], missing = [], html = $.html();
    let sourceDelay = 0;
    const server = http.createServer(async (request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
        if (!relative) { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
        if (relative === 'api/mmd/resources') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ status: 'success', resources: [{ resourceId: 'miya-default', modelType: 'pmx',
                modelUrl: '/models/mmd/miya/miya.pmx', motionUrl: '/models/mmd/motions/miya-default.vmd', motionResourceId: 'miya-default-motion' }] }));
            return;
        }
        if (relative === 'mmd-actions.json') {
            const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, relative)));
            catalog.actions.push({ id: 'future', name: '新动作', type: 'vmd', url: './mmd/motions/miya-default.vmd' });
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(catalog)); return;
        }
        const directory = relative.startsWith('models/mmd/') ? MODELS : ROOT;
        const file = path.resolve(directory, directory === MODELS ? relative.slice(11) : relative);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            missing.push(relative); response.writeHead(404).end(); return;
        }
        response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
            '.json': 'application/json', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream');
        if (sourceDelay && relative.endsWith('/miya-idle.mpl')) await new Promise(resolve => setTimeout(resolve, sourceDelay));
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        page.on('pageerror', error => { errors.push(error.message); console.log('正式页面错误：', error.message); });
        page.on('console', message => { if (['error', 'warn'].includes(message.type())) console.log('正式浏览器：', message.text()); });
        await page.setViewport({ width: 320, height: 480 });
        // 验证正式既有值不会被首次日光默认覆盖，也不会写入独立测试存储。
        await page.evaluateOnNewDocument(() => {
            if (!sessionStorage.getItem('seeded')) {
                localStorage.setItem('aasc.display.mmdLighting.v1', JSON.stringify({ ambientIntensity: .3, specularEnabled: false, pmxAoEnabled: false, keyShadowEnabled: false }));
                localStorage.setItem('aasc.display.mmdSpecular.v1', JSON.stringify({ enabled: false }));
                localStorage.setItem('aasc.display.mmdAoEdgeCorrection.v1', 'true');
                localStorage.setItem('aasc.display.mmd.render.v1', JSON.stringify({ canvasScale: .5 }));
                localStorage.setItem('aasc.display.mmd.screenLighting.v1', JSON.stringify({ giEnabled: false }));
                sessionStorage.setItem('seeded', 'true');
            }
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        console.log('正式灯光初始化：', await page.evaluate(() => ({ groups: Object.keys(window.DisplayMmdLightingPresetGroups || {}), status: document.querySelector('[data-preset-status]')?.textContent, mmd: !!window.DisplayMmd })));
        await page.waitForFunction(() => document.getElementById('displayMmdLightingPreset').options.length > 1);
        const initial = await page.evaluate(() => ({ lighting: window.DisplayMmd.getLighting(), edge: window.DisplayMmdAoEdgeCorrection,
            render: window.DisplayMmdRenderSettings, specular: window.DisplayMmdLightingPresetGroups.specular.read(), initialized: document.getElementById('mmdArLightingPresets').dataset.initialized,
            diagnosticStorage: localStorage.getItem('aasc.mmdArTest.lightingPresets.v1') }));
        assert.equal(initial.lighting.ambientIntensity, .3);
        assert.equal(initial.specular.enabled, false);
        assert.equal(initial.edge, true); assert.equal(initial.render.canvasScale, .5); assert.equal(initial.diagnosticStorage, null);
        const preset = await page.evaluate(() => {
            const panel = document.getElementById('mmdArLightingPresets'), button = panel.querySelector('.display-mmd-panel-group-toggle');
            button.click(); const folded = document.getElementById(button.getAttribute('aria-controls')).hidden;
            button.click(); const open = !document.getElementById(button.getAttribute('aria-controls')).hidden;
            const select = document.getElementById('displayMmdLightingPreset'); select.value = select.options[1].value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { open, folded, lighting: window.DisplayMmd.getLighting(), edge: window.DisplayMmdAoEdgeCorrection,
                label: document.getElementById('displayMmdPmxAoEdgeCorrection').checked, screen: window.DisplayMmdScreenLighting };
        });
        assert.equal(preset.folded, true); assert.equal(preset.open, true); assert.equal(preset.lighting.keyColor, '#fec086');
        assert.equal(preset.edge, false); assert.equal(preset.label, false); assert.equal(preset.screen.giEnabled, true);
        await page.evaluate(() => {
            const panel = document.getElementById('mmdArLightingPresets'); panel.querySelector('[data-preset-name]').value = '正式自测';
            panel.querySelector('[data-preset-action="save"]').click();
            // 软件GPU验收动作时关闭重型光照，灯光参数已在上面通过实际入口验证。
            window.DisplayMmdLighting.apply({ pmxAoEnabled: false, keyShadowEnabled: false });
            window.DisplayMmdLightingPresetGroups.screenLighting.apply({ giEnabled: false });
            window.DisplayMmdLightingPresetGroups.render.apply({ canvasScale: .5 });
            window.DisplayMmd.init({ canvas: document.getElementById('displayMmdCanvas'), onLoadProgress() {}, status: document.getElementById('displayMmdStatus') });
            window.DisplayMmd.setVisible(true);
        });
        try { await page.waitForFunction(() => window.DisplayMmd?.getHumanInterface?.()?.getState().ready, { timeout: 90000 }); }
        catch (error) { console.log(await page.evaluate(() => ({ state: window.DisplayMmd.getState(), status: document.getElementById('displayMmdStatus')?.textContent }))); throw error; }
        // 初始化正式舞台而不连接服务器；验证真实渲染计时及角色控件生命周期。
        await page.addScriptTag({ path: path.join(ROOT, 'js/display-stage.js') });
        await page.waitForFunction(() => window.DisplayMmd.getPerformanceState()?.ready
            && window.DisplayMmd.getPhysicsSolverState().running, { timeout: 30000 });
        const performanceState = await page.evaluate(() => ({ state: window.DisplayMmd.getPerformanceState(),
            physics: window.DisplayMmd.getPhysicsSolverState(), fps: document.getElementById('displayMmdFps').textContent,
            render: document.getElementById('displayMmdRenderTime').textContent,
            physicalLabel: document.getElementById('mmdArPhysicsSolverStatus').textContent }));
        assert.ok(performanceState.state.fps > 0); assert.ok(performanceState.state.renderMs >= 0);
        assert.ok(performanceState.physics.frameMs > 0); assert.match(performanceState.fps, /\d+\.\d FPS/u);
        assert.match(performanceState.render, /\d+\.\d+ ms/u); assert.match(performanceState.physicalLabel, /物理耗时/u);
        const hiddenControls = await page.evaluate(() => {
            document.getElementById('displayMmdLightingToggle').click(); window.DisplayStage.setMmdVisible(false);
            return { controls: getComputedStyle(document.querySelector('.display-stage-lighting-control')).display,
                hidden: document.getElementById('displayMmdFps').hidden,
                panels: [...document.querySelectorAll('.display-stage-lighting-control > section')].every(panel => panel.hidden),
                ready: window.DisplayMmd.getPerformanceState().ready, physicsMs: window.DisplayMmd.getPhysicsSolverState().frameMs };
        });
        assert.deepEqual(hiddenControls, { controls: 'none', hidden: true, panels: true, ready: false, physicsMs: 0 });
        await page.evaluate(() => window.DisplayStage.setMmdVisible(true));
        await page.waitForFunction(() => window.DisplayMmd.getPerformanceState()?.ready, { timeout: 30000 });
        console.log('正式性能/隐藏：', JSON.stringify(performanceState));
        assert.match(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), /miya-idle\.vmd$/u);
        await page.waitForFunction(() => document.querySelectorAll('[data-server-actions] [data-advanced]').length === 3);
        assert.equal(await page.$$eval('[data-builtin-actions] button', nodes => nodes.length), 28);
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().available);
        const sampled = await page.evaluate(() => ({ arm: window.DisplayMmd.getHumanInterface().getArmAvoidanceState(),
            gaze: window.DisplayMmd.getHumanInterface().getState().gaze,
            parsed: window.DisplayMmdReplyPreview.parse('❤️🐾🐈‍⬛🫶🏽😊🤷🏾‍♀️') }));
        assert.deepEqual(sampled.parsed.events.map(item => item.name), ['比心', '猫爪', '猫咪撒娇', '比心', '开心', '摊手']);
        assert.equal(sampled.gaze.head, true); assert.equal(sampled.gaze.eyes, true);
        console.log('正式避让状态：', JSON.stringify(sampled.arm));
        // 直接点击实际动作按钮，真实Worker生成源码；折叠、焦点和滚动均保持。
        const navigation = await page.evaluate(() => {
            document.getElementById('displayMmdMotionToggle').click();
            document.getElementById('mmdArAdvancedMotionPanel').closest('.display-mmd-panel-group').querySelector('button').click();
            const button = document.querySelector('[data-advanced="猫爪"]'); button.scrollIntoView(); button.focus({ preventScroll: true });
            window.__navigationNodes = []; for (let node = button.parentElement; node; node = node.parentElement) window.__navigationNodes.push(node);
            const positions = window.__navigationNodes.map(node => [node.scrollLeft, node.scrollTop]); button.click();
            return positions;
        });
        await page.waitForFunction(() => document.getElementById('mmdArMplSource').value === window.DisplayMmd.getHumanInterface().mpl.advancedSource({ name: '猫爪' }));
        const renderedSource = await page.evaluate(() => ({ source: document.getElementById('mmdArMplSource').value,
            folded: document.getElementById('mmdArMplPanel').closest('.display-mmd-panel-group-body').hidden,
            active: document.activeElement.dataset.advanced, positions: window.__navigationNodes.map(node => [node.scrollLeft, node.scrollTop]) }));
        assert.equal(renderedSource.folded, true); assert.equal(renderedSource.active, '猫爪');
        renderedSource.positions.forEach((value, index) => assert.ok(value.every((axis, i) => Math.abs(axis - navigation[index][i]) <= 1)));
        const compiled = await page.evaluate(async source => {
            await window.DisplayMmdReplyPreview.stop();
            const result = await window.DisplayMmdMplPlayback.play(source, 'formal:preview', true);
            await window.DisplayMmdMplPlayback.stop(); return { bytes: result.buffer.byteLength, duration: result.duration };
        }, renderedSource.source);
        assert.ok(compiled.bytes > 0); assert.ok(compiled.duration > 0);
        sourceDelay = 450;
        await page.evaluate(() => {
            document.querySelector('[data-advanced="待机"]').click();
            const input = document.getElementById('mmdArMplSource'); input.value = '用户最新编辑'; input.dispatchEvent(new Event('input'));
        });
        await new Promise(resolve => setTimeout(resolve, 750));
        assert.equal(await page.$eval('#mmdArMplSource', node => node.value), '用户最新编辑'); sourceDelay = 0;
        const dance = await page.evaluate(async () => {
            await window.DisplayMmdReplyPreview.stop();
            const human = window.DisplayMmd.getHumanInterface(), result = await human.perform({ action: '跳舞', owner: 'formal:dance' });
            const future = await human.perform({ action: '新动作', owner: 'formal:future', duration: 1.5, count: 2 });
            human.stop(); return { duration: result.duration, future: future.duration };
        });
        assert.ok(Math.abs(dance.duration - 15.2) < 1e-5); assert.equal(dance.future, 3);
        await page.evaluate(() => {
            const input = document.getElementById('mmdArHandAvoidance'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await page.evaluate(() => localStorage.getItem('aasc.display.mmd.handAvoidance.v1')), 'false');
        // 真正使用原TTS audio播放8秒WAV，口型必须按currentTime，预览及停止不能接管。
        const tts = await page.evaluate(async () => {
            const bytes = new ArrayBuffer(44 + 16000 * 2 * 8), view = new DataView(bytes);
            const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
            text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
            view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
            text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
            const audio = document.getElementById('ttsAudio'), src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
            window.DisplayLipSyncAudio.prepare(audio, '你好啊你好啊你好啊你好啊', src); audio.src = src; await audio.play();
            await new Promise(resolve => setTimeout(resolve, 300));
            const before = window.DisplayMmdLipSyncPreview.getState(); let rejected = false;
            try { await window.DisplayMmdLipSyncPreview.play('抢占测试'); } catch (error) { rejected = /TTS/u.test(error.message); }
            window.DisplayMmdLipSyncPreview.stop(); await window.DisplayMmdReplyPreview.stop();
            const after = window.DisplayMmdLipSyncPreview.getState(), time = audio.currentTime, paused = audio.paused;
            audio.pause(); window.DisplayLipSyncAudio.clear(audio); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(src);
            return { before, after, time, paused, rejected };
        });
        assert.equal(tts.before.phase, 'tts'); assert.equal(tts.after.phase, 'tts'); assert.equal(tts.before.sequence, tts.after.sequence);
        assert.equal(tts.rejected, true); assert.equal(tts.paused, false); assert.ok(Math.abs(tts.after.time - tts.time) < .05);
        // 生成期间提前真实编译，随后绑定同句音频；暂停只冻结自动层，基础物理继续。
        const sync = await page.evaluate(async () => {
            const human = window.DisplayMmd.getHumanInterface(), player = window.DisplayMmdTtsActions;
            await window.DisplayMmdReplyPreview.stop(); await window.DisplayMmdMplPlayback.stop(); human.stop();
            const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
            const data = { id: 'real-audio-actions', phase: 'answer', conversationId: 'test',
                text: '[动作:点头 时长=4]你好啊你好啊你好啊', speech: '你好啊你好啊你好啊' };
            await player.ready(data);
            const preparedState = player.getState(), methods = [typeof human.prepare, typeof human.startPrepared];
            const before = human.getState().layers.filter(layer => layer.owner.startsWith('tts:')).length;
            const bytes = new ArrayBuffer(44 + 16000 * 2 * 6), view = new DataView(bytes);
            const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
            text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
            view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
            text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
            const audio = document.getElementById('ttsAudio'), src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
            window.DisplayLipSyncAudio.prepare(audio, data.speech, src, data); audio.src = src; await audio.play();
            await wait(350);
            const read = () => human.getState().layers.find(layer => layer.owner === 'tts:' + data.id);
            const started = read(); audio.pause(); const pausedTime = read()?.time; await wait(300); const held = read()?.time;
            const playingState = player.getState(), source = window.DisplayLipSyncAudio.getState(audio);
            await audio.play(); await wait(300); const resumed = read();
            const mouth = window.DisplayMmdLipSyncPreview.getState().phase;
            player.cancel({ id: data.id });
            const removed = read() === undefined, voiceContinues = !audio.paused;
            audio.pause(); window.DisplayLipSyncAudio.clear(audio); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(src);
            return { before, started, pausedTime, held, resumed, removed, voiceContinues, mouth, preparedState, playingState,
                methods, sourceHasActions: !!source?.ttsAction };
        });
        console.log('真实TTS动作同步：', JSON.stringify(sync));
        assert.equal(sync.before, 0); assert.ok(sync.started?.time > 0);
        // pause事件异步派发，允许事件前最后一次采样到实际停声位置的亚帧差值。
        assert.ok(Math.abs(sync.held - sync.pausedTime) < .01); assert.ok(sync.resumed.time > sync.held);
        assert.equal(sync.mouth, 'tts'); assert.equal(sync.removed, true); assert.equal(sync.voiceContinues, true);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmdLighting && document.getElementById('displayMmdLightingPreset').options.length >= 3);
        assert.equal(await page.evaluate(() => window.DisplayMmdLightingPresetGroups.aoEdgeCorrection.read().enabled), false);
        await page.evaluate(() => {
            window.DisplayMmd.init({ canvas: document.getElementById('displayMmdCanvas'), onLoadProgress() {} }); window.DisplayMmd.setVisible(true);
        });
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface()?.getState().ready, { timeout: 90000 });
        await page.waitForFunction(() => !document.getElementById('mmdArHandAvoidance').checked);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().enabled), false);
        assert.equal(await page.evaluate(async () => window.DisplayMmd.setPhysicsSolver('xpbd')), true);
        await page.waitForFunction(() => window.DisplayMmd.getPerformanceState()?.ready
            && window.DisplayMmd.getPhysicsSolverState().running, { timeout: 90000 });
        const xpbdTiming = await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState());
        assert.equal(xpbdTiming.solver, 'xpbd'); assert.ok(xpbdTiming.frameMs > 0);
        assert.equal(await page.evaluate(async () => window.DisplayMmd.setPhysicsEnabled(false)), true);
        await page.waitForFunction(() => window.DisplayMmd.getState().modelReady && window.DisplayMmd.getPerformanceState()?.ready, { timeout: 90000 });
        const stoppedTiming = await page.evaluate(() => ({ physics: window.DisplayMmd.getPhysicsSolverState(),
            label: document.getElementById('mmdArPhysicsSolverStatus').textContent }));
        assert.equal(stoppedTiming.physics.frameMs, 0); assert.match(stoppedTiming.label, /物理已关闭|物理未运行/u);
        assert.deepEqual(errors, []); assert.deepEqual(missing.filter(name => name !== 'favicon.ico'), []);
        console.log('正式集成：灯光/保存/动态动作/MPL/真实音频通过');
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
