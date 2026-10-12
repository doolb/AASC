'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const modulePromise = import('../src/apps/web-mediacenter/ui/public/js/mmd-performance.mjs');

test('FPS按实际间隔汇总，CPU渲染和物理分开且不逐帧发布', async () => {
    const { createFramePerformance } = await modulePromise;
    const updates = [];
    const meter = createFramePerformance({ documentRef: null, onUpdate: data => updates.push(data) });
    for (let frame = 0; frame <= 30; frame++) meter.record({ now: frame * 1000 / 60, renderMs: 4, physicsMs: 2, physicsRunning: true });
    assert.equal(updates.length, 2);
    const state = meter.getState();
    assert.ok(Math.abs(state.fps - 60) < 1e-8);
    assert.equal(state.renderMs, 4); assert.equal(state.physicsMs, 2);
    assert.equal(state.ready, true);
    meter.dispose();
});

test('慢帧使用真实间隔，不使用动画截断后的delta', async () => {
    const { createFramePerformance } = await modulePromise;
    const meter = createFramePerformance({ documentRef: null });
    meter.record({ now: 0, renderMs: 3000 }); meter.record({ now: 5000, renderMs: 3000 });
    assert.equal(meter.getState().fps, .2); assert.equal(meter.getState().renderMs, 3000);
    meter.dispose();
});

test('关闭/阈值暂停物理立即清掉旧耗时，恢复发布实际调用', async () => {
    const { createFramePerformance } = await modulePromise;
    const updates = [], meter = createFramePerformance({ documentRef: null, onUpdate: data => updates.push(data) });
    meter.record({ now: 0, renderMs: 4, physicsMs: 20, physicsRunning: true });
    meter.record({ now: 500, renderMs: 4, physicsMs: 20, physicsRunning: true });
    meter.record({ now: 510, renderMs: 4, physicsMs: 20, physicsRunning: false });
    assert.equal(updates.at(-1).physicsMs, 0); assert.equal(updates.at(-1).physicsRunning, false);
    meter.record({ now: 520, renderMs: 4, physicsMs: 3, physicsRunning: true });
    assert.equal(updates.at(-1).physicsMs, 3);
    meter.dispose();
});

test('后台/恢复清窗口，后台帧无发布，销毁移除监听', async () => {
    const { createFramePerformance } = await modulePromise;
    const documentRef = Object.assign(new EventTarget(), { hidden: false });
    const updates = [], meter = createFramePerformance({ documentRef, onUpdate: data => updates.push(data) });
    meter.record({ now: 0, renderMs: 1 }); meter.record({ now: 500, renderMs: 1 });
    documentRef.hidden = true; documentRef.dispatchEvent(new Event('visibilitychange'));
    assert.equal(meter.getState().running, false);
    const count = updates.length; meter.record({ now: 100000, renderMs: 50 }); assert.equal(updates.length, count);
    documentRef.hidden = false; documentRef.dispatchEvent(new Event('visibilitychange'));
    meter.record({ now: 100000, renderMs: 2 }); assert.equal(meter.getState().ready, false);
    meter.record({ now: 100500, renderMs: 2 }); assert.equal(meter.getState().fps, 2);
    meter.dispose(); const disposedCount = updates.length;
    documentRef.dispatchEvent(new Event('visibilitychange')); assert.equal(updates.length, disposedCount);
});

test('模型或可见性重置不残留上一模型的窗口', async () => {
    const { createFramePerformance } = await modulePromise;
    const meter = createFramePerformance({ documentRef: null });
    meter.record({ now: 0, renderMs: 3 }); meter.record({ now: 500, renderMs: 3 }); meter.reset();
    assert.equal(meter.getState().fps, null); assert.equal(meter.getState().renderMs, null);
    meter.record({ now: 300000, renderMs: 10 }); meter.record({ now: 300500, renderMs: 10 });
    assert.equal(meter.getState().fps, 2); assert.equal(meter.getState().renderMs, 10); meter.dispose();
});

test('实例测时保持this/参数/返回值并只包装一次', async () => {
    const { instrumentPhysics, getPhysicsTiming } = await modulePromise;
    let clock = 10, calls = 0;
    const physics = { update(delta, value) { assert.equal(this, physics); assert.equal(delta, .016); calls++; clock += 3; return value; } };
    instrumentPhysics(physics, () => clock); const wrapped = physics.update;
    instrumentPhysics(physics, () => { throw new Error('不应重复包装'); }); assert.equal(physics.update, wrapped);
    assert.equal(physics.update(.016, 'result'), 'result'); assert.equal(calls, 1);
    assert.deepEqual(getPhysicsTiming(physics), { sequence: 1, frameMs: 3 });
    const copy = getPhysicsTiming(physics); copy.sequence = 999; assert.equal(getPhysicsTiming(physics).sequence, 1);
});

test('物理异常继续上抛，finally计时，未执行帧序号不变', async () => {
    const { instrumentPhysics, getPhysicsTiming } = await modulePromise;
    let clock = 0; const error = new Error('physics');
    const physics = { update() { clock += 7; throw error; } };
    instrumentPhysics(physics, () => clock); const before = getPhysicsTiming(physics).sequence;
    assert.throws(() => physics.update(), candidate => candidate === error);
    assert.equal(getPhysicsTiming(physics).sequence, before + 1); assert.equal(physics.frameMs, 7);
    assert.equal(getPhysicsTiming(physics).sequence, getPhysicsTiming(physics).sequence);
});

test('新建helper接入实际physics实例测时，不改变物理步长', async () => {
    const { getPhysicsTiming } = await modulePromise;
    const { createPmxMotionHelper } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');
    const physics = { update(delta) { return delta; } };
    class Helper {
        constructor() { this.objects = new Map(); }
        add(mesh, options) { this.options = options; this.objects.set(mesh, { physics }); }
    }
    const result = await createPmxMotionHelper({ mesh: { geometry: { userData: { MMD: { rigidBodies: [{}] } } } },
        MMDAnimationHelper: Helper, ensurePhysics: async () => {}, physicsFps: 90 });
    assert.equal(result.helper.options.unitStep, 1 / 90);
    assert.equal(physics.update(.032), .032); assert.equal(getPhysicsTiming(physics).sequence, 1);
});

test('VRM实际帧入口只统计绘制，排除动画更新，隐藏后不继续绘制', async () => {
    const { createFramePerformance } = await modulePromise;
    const framePerformance = createFramePerformance({ documentRef: null });
    const source = fs.readFileSync(path.join(PUBLIC, 'js/display-vrm-runtime.js'), 'utf8');
    const body = source.slice(source.indexOf('    function renderFrame(now)'), source.indexOf('    function startRendering()'));
    let clock = 0, renders = 0, updates = 0;
    const context = vm.createContext({ visible: true, frameHandle: 0, lastFrameAt: 0, framePerformance,
        currentVrm: { update() { clock += 12; updates++; } },
        updateModelRotation() { clock += 3; }, updateCameraView() { clock += 1; },
        renderer: { render() { clock += 4; renders++; } }, scene: {}, camera: {},
        performance: { now: () => clock }, requestAnimationFrame: () => 1 });
    vm.runInContext(body, context);
    for (let frame = 0; frame <= 5; frame++) context.renderFrame(frame * 100);
    assert.equal(framePerformance.getState().fps, 10); assert.equal(framePerformance.getState().renderMs, 4);
    assert.equal(framePerformance.getState().physicsRunning, false); assert.equal(updates, 6);
    context.visible = false; context.renderFrame(600); assert.equal(renders, 6);
    framePerformance.dispose();
});

test('真实DOM：左上角FPS不挡指针，灯光耗时与角色隐藏/面板收起一致', {
    skip: !fs.existsSync('/usr/bin/chromium')
}, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8')); $('script, link').remove();
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage(); await page.setViewport({ width: 390, height: 740 });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.setContent($.html());
        for (const file of ['theme.css', 'display.css', 'display-chat.css', 'display-mmd.css', 'display-voice-controls.css']) {
            await page.addStyleTag({ path: path.join(PUBLIC, 'css', file) });
        }
        await page.evaluate(() => {
            window.DisplayMmd = { init() {}, resize() {}, setPointerEnabled() {}, getState: () => ({ visible: true }),
                setVisible(visible) { window.dispatchEvent(new CustomEvent('display-mmd-visibility', { detail: { visible } })); } };
        });
        for (const file of ['display-mmd-panel-groups.js', 'display-mmd-performance.js', 'display-stage.js']) {
            await page.addScriptTag({ path: path.join(PUBLIC, 'js', file) });
        }
        const read = () => page.evaluate(() => {
            const hud = document.getElementById('displayMmdFps'), rect = hud.getBoundingClientRect();
            return { fps: hud.textContent, hidden: hud.hidden, render: document.getElementById('displayMmdRenderTime').textContent,
                pointer: getComputedStyle(hud).pointerEvents, top: rect.top, left: rect.left,
                controls: getComputedStyle(document.querySelector('.display-stage-lighting-control')).display,
                panels: [...document.querySelectorAll('.display-stage-lighting-control > section')].every(panel => panel.hidden),
                expanded: [...document.querySelectorAll('.display-stage-lighting-control > button')].some(button => button.getAttribute('aria-expanded') === 'true'),
                roleEntry: getComputedStyle(document.getElementById('displayMmdToggle')).display !== 'none' };
        });
        await page.evaluate(() => document.getElementById('displayMmdCanvas').dispatchEvent(new CustomEvent('mmd-performance', {
            detail: { running: true, ready: true, fps: 59.98, renderMs: 2.345 } })));
        const shown = await read(); assert.equal(shown.fps, '60.0 FPS'); assert.equal(shown.render, '2.35 ms');
        assert.equal(shown.hidden, false); assert.equal(shown.pointer, 'none'); assert.ok(shown.top >= 0 && shown.left >= 0);
        // 使用独立编辑器的实际样式做布局验证，避免FPS存在但被工具栏遮住。
        const editorSource = fs.readFileSync(path.resolve(__dirname, '../3rd/mmd-ar-test/web-editor-ui.mjs'), 'utf8');
        const editorStyle = editorSource.split('style.textContent=`')[1].split('`;document.head.append(style);')[0];
        await page.addStyleTag({ content: editorStyle });
        await page.evaluate(() => {
            const host = document.createElement('section'); host.id = 'mmdEditor';
            host.innerHTML = '<nav><button>编辑</button><button>预览</button><button>渲染</button><button>Blender工程</button></nav>';
            document.body.append(host);
        });
        const overlap = () => page.evaluate(() => {
            const fps = document.getElementById('displayMmdFps').getBoundingClientRect();
            const editor = document.getElementById('mmdEditor').getBoundingClientRect();
            return fps.bottom > editor.top && fps.top < editor.bottom && fps.right > editor.left && fps.left < editor.right;
        });
        assert.equal(await overlap(), false);
        await page.addStyleTag({ content: '#displayStageLayers { --display-safe-inset-top: 24px; } body { --mmd-ar-safe-inset-top: 24px; }' });
        assert.equal(await overlap(), false);
        await page.screenshot({ path: path.join(os.tmpdir(), 'aasc-mmd-performance-ui.png') });
        await page.evaluate(() => { document.getElementById('displayMmdMotionToggle').click(); window.DisplayStage.setMmdVisible(false); });
        const hidden = await read(); assert.equal(hidden.controls, 'none'); assert.equal(hidden.hidden, true);
        assert.equal(hidden.panels, true); assert.equal(hidden.expanded, false); assert.equal(hidden.roleEntry, true);
        await page.evaluate(() => window.DisplayStage.setMmdVisible(true));
        const restored = await read(); assert.notEqual(restored.controls, 'none'); assert.equal(restored.expanded, false);
        assert.equal(restored.fps, '-- FPS'); assert.equal(restored.render, '-- ms'); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
