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
const BROWSER_PATH = [process.env.AASC_MMD_TEST_BROWSER_PATH, '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(file => file && fs.existsSync(file));

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

test('PMX重置先清物理状态再发布，同步面板回调不会读到旧耗时', () => {
    const source = fs.readFileSync(path.join(PUBLIC, 'js/display-pmx-runtime.js'), 'utf8');
    for (const [name, next, call] of [
        ['disposeCurrentModel', 'renderFrame', 'disposeCurrentModel()'],
        ['setVisible', 'rotateModelBy', 'setVisible(false)']
    ]) {
        const body = source.slice(source.indexOf('    const ' + name + ' ='), source.indexOf('    const ' + next + ' ='));
        const values = [];
        const context = vm.createContext({ physicsFrame: { running: true, frameMs: 23 },
            framePerformance: { reset() { values.push({ ...context.physicsFrame }); } },
            ambientOcclusion: { invalidateTemporal() {} }, motionSequence: 0, stopMotion() {}, currentMesh: null,
            visible: true, frameHandle: 0, human: { setVisible() {} } });
        vm.runInContext(body + '\n' + call, context);
        assert.deepEqual(values, [{ running: false, frameMs: 0 }]);
    }
});

test('PMX后台恢复尚未渲染时不暴露旧物理帧，实际新帧才恢复回显', () => {
    const source = fs.readFileSync(path.join(PUBLIC, 'js/display-pmx-runtime.js'), 'utf8');
    const body = source.slice(source.indexOf('    const getPhysicsSolverState ='), source.indexOf('    const raycaster ='));
    const mesh = {}, physics = { bodies: [{}], constraints: [], getState: () => ({}) };
    let rendered = false;
    const context = vm.createContext({ currentMesh: mesh, helper: { current: { objects: new Map([[mesh, { physics }]]) } },
        physicsSolver: 'ammo', physicsEnabled: true, visible: true, document: { hidden: false },
        physicsFrame: { running: true, frameMs: 23 }, framePerformance: { getState: () => ({ running: rendered }) } });
    vm.runInContext(body + '\nglobalThis.readPhysics = getPhysicsSolverState;', context);
    assert.equal(context.readPhysics().running, false); assert.equal(context.readPhysics().frameMs, 0);
    rendered = true; assert.equal(context.readPhysics().running, true); assert.equal(context.readPhysics().frameMs, 23);
    context.document.hidden = true; assert.equal(context.readPhysics().frameMs, 0);
});

function mockGpuTimer() {
    const state = { status: 'supported', generation: 0 }, batches = [], calls = [];
    return { state, batches, calls, getState: () => ({ ...state }),
        poll() { calls.push('poll'); return { ...state, samples: batches.shift() || [] }; },
        begin() { calls.push('begin'); }, end() { calls.push('end'); },
        reset() { calls.push('reset'); state.generation += 1; },
        contextLost() { calls.push('lost'); state.status = 'lost'; state.generation += 1; },
        restore() { calls.push('restore'); state.status = 'supported'; state.generation += 1; },
        dispose() { calls.push('dispose'); } };
}

const recordGpuFrame = (meter, now) => {
    meter.beginRender(); meter.endRender(); meter.record({ now, renderMs: 4, physicsMs: 2, physicsRunning: true });
};

test('GPU按有效异步样本单独平均，无样本窗口不沿用旧值或记零', async () => {
    const { createFramePerformance } = await modulePromise;
    const gpuTimer = mockGpuTimer(), meter = createFramePerformance({ documentRef: null, gpuTimer });
    gpuTimer.batches.push([], [2, 8, NaN, -1, Infinity], [5]);
    recordGpuFrame(meter, 0); recordGpuFrame(meter, 250); recordGpuFrame(meter, 500);
    assert.equal(meter.getState().gpuRenderMs, 5); assert.equal(meter.getState().renderMs, 4);
    assert.equal(meter.getState().physicsMs, 2); assert.equal(meter.getState().fps, 4);
    recordGpuFrame(meter, 1000); assert.equal(meter.getState().gpuRenderMs, null);
    gpuTimer.batches.push([0]); recordGpuFrame(meter, 1500); assert.equal(meter.getState().gpuRenderMs, 0);
    meter.dispose();
});

test('GPU失效代次立即清旧回显，丢弃窗口旧值和begin后迟到结果', async () => {
    const { createFramePerformance } = await modulePromise;
    const gpuTimer = mockGpuTimer(), updates = [];
    const meter = createFramePerformance({ documentRef: null, gpuTimer, onUpdate: state => updates.push(state) });
    gpuTimer.batches.push([20], [20]); recordGpuFrame(meter, 0); recordGpuFrame(meter, 500);
    gpuTimer.batches.push([30]); recordGpuFrame(meter, 510);
    gpuTimer.state.status = 'disjoint'; gpuTimer.state.generation += 1; recordGpuFrame(meter, 520);
    assert.equal(updates.at(-1).gpuRenderMs, null); assert.equal(updates.at(-1).renderMs, 4);
    gpuTimer.state.status = 'supported'; gpuTimer.batches.push([3]); recordGpuFrame(meter, 1000);
    assert.equal(meter.getState().gpuRenderMs, 3);
    gpuTimer.batches.push([999]); meter.beginRender(); gpuTimer.state.generation += 1;
    meter.endRender(); meter.record({ now: 1500, renderMs: 4 }); assert.equal(meter.getState().gpuRenderMs, null);
    meter.dispose();
});

test('GPU结果同帧只消费一次，模型/后台/上下文重置与销毁清查询监听', async () => {
    const { createFramePerformance } = await modulePromise;
    const gpuTimer = mockGpuTimer(), documentRef = Object.assign(new EventTarget(), { hidden: false });
    const canvasRef = new EventTarget(), meter = createFramePerformance({ gpuTimer, documentRef, canvasRef });
    gpuTimer.batches.push([6]); meter.beginRender(); meter.endRender(); meter.record({ now: 0, renderMs: 4 });
    meter.record({ now: 500, renderMs: 4 }); assert.equal(meter.getState().gpuRenderMs, 6);
    meter.record({ now: 1000, renderMs: 4 }); assert.equal(meter.getState().gpuRenderMs, null);
    meter.reset(); assert.equal(meter.getState().gpuRenderMs, null);
    documentRef.hidden = true; documentRef.dispatchEvent(new Event('visibilitychange'));
    const callCount = gpuTimer.calls.length; meter.beginRender(); assert.equal(gpuTimer.calls.length, callCount);
    documentRef.hidden = false; documentRef.dispatchEvent(new Event('visibilitychange'));
    canvasRef.dispatchEvent(new Event('webglcontextlost')); assert.equal(meter.getState().gpuStatus, 'lost');
    canvasRef.dispatchEvent(new Event('webglcontextrestored')); assert.equal(meter.getState().gpuStatus, 'supported');
    assert.equal(meter.getState().ready, false);
    meter.dispose(); const disposedCount = gpuTimer.calls.length; meter.dispose();
    canvasRef.dispatchEvent(new Event('webglcontextrestored')); documentRef.dispatchEvent(new Event('visibilitychange'));
    meter.beginRender(); meter.endRender(); meter.record({ now: 2000, renderMs: 4 });
    assert.equal(gpuTimer.calls.length, disposedCount); assert.equal(gpuTimer.calls.at(-1), 'dispose');
});

test('PMX/VRM真实绘制区间GPU查询在物理后，CPU不含查询，异常finally结束', () => {
    for (const kind of ['pmx', 'vrm']) {
        const source = fs.readFileSync(path.join(PUBLIC, `js/display-${kind}-runtime.js`), 'utf8');
        const start = source.indexOf('        if (current' + (kind === 'pmx' ? 'Mesh' : 'Vrm') + ') framePerformance.beginRender();');
        const stop = source.indexOf(kind === 'pmx' ? '        if (!frameHandle) frameHandle = requestAnimationFrame' : '        frameHandle = requestAnimationFrame', start);
        const body = source.slice(start, stop); assert.ok(start > source.indexOf(kind === 'pmx' ? 'advancePmxMotionFrame({' : 'currentVrm.update(delta)'));
        const calls = [], context = vm.createContext({ currentMesh: {}, currentVrm: {}, firstFramePivot: null,
            firstFramePivotVisible: true, followTestShadowRoot() {}, alignTestShadowCamera() {},
            keyLight: {}, fillLight: {}, currentMotionResourceId: null, lightingState: {}, scene: {}, camera: {}, now: 500,
            physicsFrame: { running: true, frameMs: 2 }, performance: { now: () => context.clock }, clock: 0,
            framePerformance: { beginRender() { calls.push('begin'); context.clock += 10; },
                endRender() { calls.push('end'); context.clock += 10; }, record(data) { calls.push(data.renderMs); } },
            renderer: { shadowMap: { enabled: false }, render() { calls.push('draw'); context.clock += 4; } },
            ambientOcclusion: { setTemporalContent() {}, render() { context.renderer.render(); } } });
        vm.runInContext('{\n' + body + '\n}', context); assert.deepEqual(calls, ['begin', 'draw', 'end', 4]);
        calls.length = 0; const error = new Error('draw'); context.renderer.render = () => { throw error; };
        assert.throws(() => vm.runInContext('{\n' + body + '\n}', context), candidate => candidate === error);
        assert.deepEqual(calls, ['begin', 'end']);
    }
});

test('独立构建GPU叶子到性能模块指纹一致，重复导入不叠加版本串', async () => {
    const fsp = require('node:fs/promises'), crypto = require('node:crypto');
    const { fingerprintProductionImports } = require('../3rd/mmd-ar-test/web-production-shared');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mmd-gpu-imports-'));
    try {
        await fsp.mkdir(path.join(root, 'js'));
        for (const file of ['mmd-gpu-timer.mjs', 'mmd-performance.mjs']) {
            await fsp.copyFile(path.join(PUBLIC, 'js', file), path.join(root, 'js', file));
        }
        const source = "import { a } from './mmd-performance.mjs';\nimport { b } from './mmd-performance.mjs';";
        const output = await fingerprintProductionImports(source, root);
        const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'js', file))).digest('hex').slice(0, 12);
        const performanceSource = await fsp.readFile(path.join(root, 'js/mmd-performance.mjs'), 'utf8');
        assert.ok(performanceSource.includes(`./mmd-gpu-timer.mjs?v=${hash('mmd-gpu-timer.mjs')}`));
        assert.equal(output.split(`./mmd-performance.mjs?v=${hash('mmd-performance.mjs')}`).length - 1, 2);
        assert.ok(!output.includes('?v=' + hash('mmd-performance.mjs') + '?v='));
        assert.equal(await fingerprintProductionImports(source, root), output);
        assert.equal(await fingerprintProductionImports(output, root), output);
    } finally {
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'mmd-gpu-imports-')));
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('真实DOM：左上角FPS不挡指针，CPU/GPU耗时与角色隐藏/面板收起一致', {
    skip: !BROWSER_PATH
}, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8')); $('script, link').remove();
    const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--no-sandbox'] });
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
            // 此轻量夹具不加载依赖完整runtime的灯光模块，只复现其面板开合生命周期。
            window.DisplayMmdLighting = { close() { document.getElementById('displayMmdLightingPanel').hidden = true; } };
            document.getElementById('displayMmdLightingToggle').addEventListener('click', event => {
                event.stopPropagation();
                const panel = document.getElementById('displayMmdLightingPanel'); panel.hidden = !panel.hidden;
            });
        });
        for (const file of ['display-mmd-panel-groups.js', 'display-mmd-performance.js', 'display-stage.js']) {
            await page.addScriptTag({ path: path.join(PUBLIC, 'js', file) });
        }
        const read = () => page.evaluate(() => {
            const hud = document.getElementById('displayMmdFps'), rect = hud.getBoundingClientRect();
            return { fps: hud.textContent, hidden: hud.hidden, render: document.getElementById('displayMmdRenderTime').textContent,
                gpu: document.getElementById('displayMmdGpuRenderTime').textContent,
                pointer: getComputedStyle(hud).pointerEvents, top: rect.top, left: rect.left,
                controls: getComputedStyle(document.querySelector('.display-stage-lighting-control')).display,
                panels: [...document.querySelectorAll('.display-stage-lighting-control > section')].every(panel => panel.hidden),
                expanded: [...document.querySelectorAll('.display-stage-lighting-control > button')].some(button => button.getAttribute('aria-expanded') === 'true'),
                roleEntry: getComputedStyle(document.getElementById('displayMmdToggle')).display !== 'none' };
        });
        await page.evaluate(() => document.getElementById('displayMmdCanvas').dispatchEvent(new CustomEvent('mmd-performance', {
            detail: { running: true, ready: true, fps: 59.98, renderMs: 2.345, gpuStatus: 'supported', gpuRenderMs: 4.567 } })));
        const shown = await read(); assert.equal(shown.fps, '60.0 FPS'); assert.equal(shown.render, '2.35 ms');
        assert.equal(shown.gpu, '4.57 ms');
        for (const [gpuStatus, expected] of [['unsupported', '不支持'], ['disjoint', '-- ms'], ['supported', '-- ms']]) {
            await page.evaluate(status => document.getElementById('displayMmdCanvas').dispatchEvent(new CustomEvent('mmd-performance', {
                detail: { running: true, ready: true, fps: 60, renderMs: 2.345, gpuStatus: status, gpuRenderMs: status === 'disjoint' ? 999 : null } })), gpuStatus);
            assert.equal((await read()).gpu, expected);
        }
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
        await page.evaluate(() => document.getElementById('displayMmdCanvas').dispatchEvent(new CustomEvent('mmd-performance', {
            detail: { running: true, ready: true, fps: 60, renderMs: 2.345, gpuStatus: 'supported', gpuRenderMs: 4.567 } })));
        await page.evaluate(() => document.getElementById('displayMmdLightingToggle').click());
        const renderLayout = await page.evaluate(() => {
            const output = document.getElementById('displayMmdGpuRenderTime'), row = output.closest('p');
            const rect = row.getBoundingClientRect();
            return { visible: rect.width > 0 && rect.height > 0, overflow: row.scrollWidth > row.clientWidth, text: row.textContent };
        });
        assert.equal(renderLayout.visible, true); assert.equal(renderLayout.overflow, false);
        assert.match(renderLayout.text, /CPU.*2\.35 ms.*GPU.*4\.57 ms/);
        await page.evaluate(() => document.getElementById('displayMmdGpuRenderTime').scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: path.join(os.tmpdir(), 'aasc-mmd-performance-ui.png') });
        await page.evaluate(() => { document.getElementById('displayMmdMotionToggle').click(); window.DisplayStage.setMmdVisible(false); });
        const hidden = await read(); assert.equal(hidden.controls, 'none'); assert.equal(hidden.hidden, true);
        assert.equal(hidden.panels, true); assert.equal(hidden.expanded, false); assert.equal(hidden.roleEntry, true);
        await page.evaluate(() => window.DisplayStage.setMmdVisible(true));
        const restored = await read(); assert.notEqual(restored.controls, 'none'); assert.equal(restored.expanded, false);
        assert.equal(restored.fps, '-- FPS'); assert.equal(restored.render, '-- ms'); assert.equal(restored.gpu, '-- ms'); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('真实WebGL2：异步GPU查询返回有效结果，丢失恢复清代次且无GL错误', {
    skip: !BROWSER_PATH, timeout: 30000
}, async t => {
    const browser = await puppeteer.launch({ executablePath: BROWSER_PATH, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const source = fs.readFileSync(path.join(PUBLIC, 'js/mmd-gpu-timer.mjs'), 'utf8');
        const result = await page.evaluate(async text => {
            const { createGpuRenderTimer } = await import('data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(text))));
            const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; document.body.append(canvas);
            const waitEvent = name => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error(name + '事件等待超时')), 4000);
                canvas.addEventListener(name, event => { clearTimeout(timeout); resolve(event); }, { once: true });
            });
            const gl = canvas.getContext('webgl2');
            if (!gl) return { status: 'no-webgl2' };
            const timer = createGpuRenderTimer(gl), status = timer.getState().status;
            if (status === 'unsupported') { timer.dispose(); return { status }; }
            const compile = (type, code) => {
                const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
                return shader;
            };
            const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}');
            const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(.2,.4,.8,1.);}');
            const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            gl.useProgram(program);
            const samples = [];
            for (let frame = 0; frame < 120 && !samples.length; frame += 1) {
                samples.push(...timer.poll().samples); timer.begin(); gl.drawArrays(gl.TRIANGLES, 0, 3); timer.end();
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 30);
                    requestAnimationFrame(() => { clearTimeout(timeout); resolve(); });
                });
            }
            const error = gl.getError(), pending = timer.getState().pending;
            timer.reset(); const empty = timer.getState().pending === 0;
            const generation = timer.getState().generation, lose = gl.getExtension('WEBGL_lose_context');
            let recovered = null;
            if (lose) {
                canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); timer.contextLost(); }, { once: true });
                const loss = waitEvent('webglcontextlost');
                lose.loseContext(); await loss;
                const lossStatus = timer.getState().status;
                const recovery = waitEvent('webglcontextrestored');
                setTimeout(() => lose.restoreContext(), 100); await recovery; timer.restore();
                recovered = { lossStatus, status: timer.getState().status, changed: timer.getState().generation > generation };
            } else {
                gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
            }
            timer.dispose(); timer.dispose();
            return { status, samples, error, pending, empty, recovered, disposed: timer.getState().status };
        }, source);
        t.diagnostic(JSON.stringify(result));
        if (['no-webgl2', 'unsupported'].includes(result.status)) { t.skip('本机浏览器未暴露GPU时间查询；降级由DOM及mock覆盖'); return; }
        assert.equal(result.status, 'supported'); assert.ok(result.samples.length > 0);
        assert.ok(result.samples.every(value => Number.isFinite(value) && value >= 0));
        assert.equal(result.error, 0); assert.ok(result.pending <= 4); assert.equal(result.empty, true); assert.equal(result.disposed, 'disposed');
        if (result.recovered) {
            assert.equal(result.recovered.lossStatus, 'lost'); assert.equal(result.recovered.changed, true);
            assert.ok(['supported', 'unsupported'].includes(result.recovered.status));
        }
    } finally { await browser.close(); }
});
