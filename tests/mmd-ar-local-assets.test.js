'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = '/usr/bin/chromium';
const localAssets = () => import('../3rd/mmd-ar-test/web-local-assets.mjs');

function file(name, relativePath = '') {
    const blob = new Blob(['fixture']);
    Object.defineProperties(blob, { name: { value: name }, webkitRelativePath: { value: relativePath } });
    return blob;
}

test('本地资源匹配目录、Windows 分隔符、大小写和唯一平铺文件，释放后禁止重用', async () => {
    const assets = await localAssets();
    const pmx = file('人物.pmx', '包/人物.pmx');
    const png = file('A.png', '包/tex/A.png');
    const selection = assets.createLocalModelSelection([pmx, png], pmx);
    let resolver;
    assets.configureLocalLoader({ manager: { setURLModifier(value) { resolver = value; } } }, selection.profile.modelUrl);
    const base = selection.profile.modelUrl.slice(0, selection.profile.modelUrl.lastIndexOf('/') + 1);
    const textureUrl = resolver(`${base}tex\\a.png`);
    assert.match(textureUrl, /^blob:/u);
    assert.equal(await (await fetch(textureUrl)).text(), 'fixture');
    assert.equal(resolver('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
    assert.throws(() => resolver(`${base}tex/absent.png`), /缺少贴图/u);
    assert.throws(() => resolver('https://example.com/a.png'), /未选择/u);
    selection.release();
    await assert.rejects(fetch(textureUrl));
    assert.throws(() => resolver(`${base}tex/A.png`), /已经释放/u);
    assert.throws(() => assets.configureLocalLoader({ manager: {} }, selection.profile.modelUrl), /已经释放/u);
    const flat = assets.createLocalModelSelection([file('model.pmx'), file('a.png')]);
    assets.configureLocalLoader({ manager: { setURLModifier(value) { resolver = value; } } }, flat.profile.modelUrl);
    assert.match(resolver(flat.profile.modelUrl.replace('model.pmx', 'tex/a.png')), /^blob:/u);
    flat.release();
});

test('本地资源拒绝歧义、重复路径和目录越界，并在网格创建前检查缺失纹理', async () => {
    const assets = await localAssets();
    const pmx = file('model.pmx');
    const selection = assets.createLocalModelSelection([pmx, file('A.png'), file('a.PNG')]);
    let resolver;
    assets.configureLocalLoader({ manager: { setURLModifier(value) { resolver = value; } } }, selection.profile.modelUrl);
    assert.throws(() => resolver(selection.profile.modelUrl.replace('model.pmx', 'tex/a.png')), /歧义/u);
    assert.throws(() => assets.createLocalModelSelection([pmx, pmx]), /重复/u);
    assert.throws(() => assets.normalizeLocalPath('../../private.png'), /超出/u);
    assert.throws(() => assets.normalizeLocalPath('C:\\file.png'), /绝对/u);
    await assert.rejects(assets.validateLocalModel({ _getParser: () => ({ parsePmx: () => ({
        materials: [{ textureIndex: 0, envTextureIndex: -1, toonFlag: 1 }], textures: ['missing.png']
    }) }) }, selection.profile.modelUrl), /缺少贴图/u);
    selection.release();
    assert.throws(() => assets.createLocalMotionSelection(file('wrong.txt')), /VMD/u);
});

test('真实网页文件选择加载 PMX/VMD，失败保留旧模型，物理重载和恢复默认可用', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 900000
}, async () => {
    // 使用构建缓存的真实资源，通过 file input 上传，验证对象 URL 和同一 ESM 注册表。
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd-resources.json'), 'utf8'));
    const profile = manifest.resources[0];
    const pmxPath = path.resolve(ROOT, profile.modelUrl);
    const vmdPath = path.resolve(ROOT, profile.motionUrl);
    const textureDir = path.join(path.dirname(pmxPath), 'tex');
    const textures = fs.readdirSync(textureDir).map((name) => path.join(textureDir, name));
    const requests = [];
    const errors = [];
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        requests.push(pathname);
        const relative = decodeURIComponent(pathname.replace(/^\/deep\/mmd-ar\//u, '')) || 'index.html';
        const absolute = path.resolve(ROOT, relative);
        if (!absolute.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
            response.writeHead(404).end();
            return;
        }
        response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
            : /\.html$/u.test(absolute) ? 'text/html'
            : /\.css$/u.test(absolute) ? 'text/css' : 'application/octet-stream');
        fs.createReadStream(absolute).pipe(response);
    });
    let browser;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-ar-local-test-'));
    try {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false');
            // 此用例验证重载保留用户设置，显式固定测试值，避免依赖另一个功能的默认值。
            localStorage.setItem('aasc.mmdArTest.gravityFilter.v1', JSON.stringify({ deadZoneDegrees: 0.5, smoothingMs: 120 }));
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/deep/mmd-ar/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.setLighting);
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false, keyShadowEnabled: false }));
        await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        // 在真实生成页面上验证新控件、原控制器事件及 runtime 使用同一组独立设置。
        assert.equal(await page.$('#displayArMotionSensitivity'), null);
        assert.equal(await page.$eval('#mmdArGravityDeadZone', (input) => input.value), '0.5');
        assert.equal(await page.$eval('#mmdArGravitySmoothing', (input) => input.value), '120');
        await page.evaluate(() => window.DisplayMmdAr.initialize());
        await page.evaluate(() => {
            const change = (id, value) => {
                const input = document.getElementById(id);
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            change('mmdArGravityDeadZone', '0.8');
            change('mmdArGravitySmoothing', '0');
            const toggle = document.getElementById('displayArMotionEnabled');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.getElementById('displayArMotionMessage').textContent.includes('等待重力方向'), { timeout: 10000 });
        const gravity = await page.evaluate(() => {
            const toggle = document.getElementById('displayArMotionEnabled');
            // 等待启用完成后连续派发，覆盖真实事件绑定且避免原生屏幕事件插入样本序列。
            const orient = (beta) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta, gamma: 0 }));
            orient(30);
            const initial = window.DisplayMmd.getModelGravityState();
            orient(30.4);
            const small = window.DisplayMmd.getModelGravityState();
            orient(60);
            const tilted = window.DisplayMmd.getModelGravityState();
            document.getElementById('displayArMotionRecenter').click();
            const centered = window.DisplayMmd.getModelGravityState();
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));
            return { initial, small, tilted, centered,
                saved: JSON.parse(localStorage.getItem('aasc.mmdArTest.gravityFilter.v1')) };
        });
        assert.deepEqual(gravity.initial.target, [0, 0, 0, 1]);
        assert.deepEqual(gravity.small.target, [0, 0, 0, 1]);
        assert.ok(Math.abs(2 * Math.acos(gravity.tilted.target[3]) * 180 / Math.PI - 30) < 1e-6, JSON.stringify(gravity));
        assert.deepEqual(gravity.centered.target, [0, 0, 0, 1]);
        assert.deepEqual(gravity.saved, { deadZoneDegrees: 0.8, smoothingMs: 0 });
        await page.click('#mmdArMotionToggle');
        assert.deepEqual(errors, []);
        assert.equal(await page.$eval('#mmdArMotionPanel', (element) => element.hidden), false);
        await page.click('#mmdArLocalAssets .mmd-ar-panel-group-toggle');
        // 用MutationObserver保留同步阶段的各个文本节点，避免只看到最终完成消息。
        await page.evaluate(() => {
            window.localLoadProgressTrace = [];
            window.localLoadProgressStarts = [];
            const progress = document.getElementById('mmdArLoadingProgress');
            new MutationObserver((records) => {
                for (const record of records) for (const node of record.addedNodes) {
                    window.localLoadProgressTrace.push(node.textContent);
                }
            }).observe(document.getElementById('mmdArLoadingText'), { childList: true });
            for (const id of ['mmdArLocalFiles', 'mmdArLocalDirectory', 'mmdArLocalVmd', 'mmdArLocalPmx']) {
                document.getElementById(id).addEventListener('change', () => {
                    window.localLoadProgressStarts.push({ hidden: progress.hidden,
                        state: progress.dataset.state, text: document.getElementById('mmdArLoadingText').textContent });
                });
            }
        });
        const upload = async (selector, files, waiting = false) => {
            await page.evaluate(() => { window.localLoadProgressTrace.length = 0; window.localLoadProgressStarts.length = 0; });
            const input = await page.$(selector);
            // 模拟选择按钮先清空input的实际行为；浏览器相同FileList不会再次触发change。
            await input.evaluate((element) => { element.value = ''; });
            await input.uploadFile(...files);
            try {
                await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
            } catch (error) {
                const snapshot = await page.evaluate(() => ({
                    local: document.getElementById('mmdArLocalMessage').textContent,
                    status: document.getElementById('displayMmdStatus').textContent,
                    progress: document.getElementById('mmdArLoadingText').textContent,
                    state: window.DisplayMmd.getState()
                }));
                throw new Error(`${selector}: ${JSON.stringify(snapshot)}; ${error.message}`);
            }
            const progress = await page.evaluate(() => ({
                state: document.getElementById('mmdArLoadingProgress').dataset.state,
                percent: document.getElementById('mmdArLoadingProgress').getAttribute('aria-valuenow'),
                start: window.localLoadProgressStarts.at(-1), trace: [...window.localLoadProgressTrace]
            }));
            assert.equal(progress.start.hidden, false, '文件确认后立即显示进度');
            assert.equal(progress.start.state, 'loading');
            assert.ok(progress.trace.length > 0);
            if (progress.state === 'error') {
                assert.equal(progress.percent, null);
                assert.equal(progress.trace.some((value) => value.includes('100%')), false);
            } else if (waiting) {
                assert.equal(progress.state, 'waiting');
                assert.equal(progress.percent, null);
            } else {
                assert.equal(progress.state, 'complete');
                assert.equal(progress.percent, '100');
                if (selector === '#mmdArLocalVmd') {
                    assert.ok(progress.trace.some((value) => value.includes('读取/解析 VMD')));
                    assert.ok(progress.trace.some((value) => value.includes('恢复 T Pose')));
                }
            }
            return progress;
        };
        const initialMotionUrl = await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl);
        const directoryProgress = await upload('#mmdArLocalDirectory', [path.dirname(pmxPath)]);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), initialMotionUrl);
        assert.equal(await page.$eval('#mmdArLocalMotionName', (element) => element.textContent), '内置默认动作');
        await page.waitForFunction(() => window.DisplayMmd.getMotionProgress()?.timeSeconds > 0);
        assert.ok(directoryProgress.trace.some((value) => value.includes('校验 PMX')));
        assert.ok(directoryProgress.trace.some((value) => value.includes('加载纹理')));
        const alternatePmx = path.join(temporary, 'alternate.pmx');
        fs.copyFileSync(pmxPath, alternatePmx);
        const beforeSelection = await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl);
        await upload('#mmdArLocalFiles', [pmxPath, alternatePmx, ...textures], true);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), beforeSelection);
        await page.select('#mmdArLocalPmx', path.basename(pmxPath));
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal(await page.$eval('#mmdArLoadingProgress', (element) => element.dataset.state), 'complete');
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'false');
        assert.match(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), /__local__/u);
        assert.ok(await page.evaluate(() => window.DisplayMmd.getMotionProgress().durationSeconds > 0));
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), initialMotionUrl);
        await upload('#mmdArLocalVmd', [vmdPath]);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'false');
        assert.ok(await page.evaluate(() => window.DisplayMmd.getMotionProgress().durationSeconds > 0));
        const localMotionUrl = await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl);
        await upload('#mmdArLocalFiles', [alternatePmx, ...textures]);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), localMotionUrl);
        assert.equal(await page.$eval('#mmdArLocalMotionName', (element) => element.textContent), path.basename(vmdPath));
        await page.waitForFunction(() => window.DisplayMmd.getMotionProgress()?.timeSeconds > 0);
        const currentUrl = await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl);
        await page.evaluate(() => window.DisplayMmd.setMotionPlaybackEnabled(false));
        const paused = await page.evaluate(() => window.DisplayMmd.getMotionProgress().timeSeconds);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
        assert.ok(Math.abs(await page.evaluate(() => window.DisplayMmd.getMotionProgress().timeSeconds) - paused) < 0.001);
        const badVmd = path.join(temporary, 'broken.vmd');
        fs.writeFileSync(badVmd, 'invalid');
        await upload('#mmdArLocalVmd', [badVmd]);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'true');
        assert.ok(await page.evaluate(() => window.DisplayMmd.getMotionProgress().durationSeconds > 0));
        await upload('#mmdArLocalFiles', [pmxPath]);
        assert.match(await page.$eval('#mmdArLocalMessage', (element) => element.textContent), /缺少贴图/u);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getState().modelReady), true);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), currentUrl);
        assert.deepEqual(await page.evaluate(() => window.DisplayMmd.getModelGravityState().settings), { deadZoneDegrees: 0.8, smoothingMs: 0 });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl.includes('__local__')), true);
        await page.evaluate(async () => {
            // 使用importmap同一个带指纹模块，覆盖实际runtime；只保留存活实例，避免观测本身累积模型引用。
            const { MMDAnimationHelper } = await import('three/addons/animation/MMDAnimationHelper.js');
            const create = MMDAnimationHelper.prototype._createMMDPhysics;
            window.physicsLifetime = { active: new Set(), created: 0, disposed: 0, errors: [] };
            MMDAnimationHelper.prototype._createMMDPhysics = function (...args) {
                const physics = create.apply(this, args);
                const stats = window.physicsLifetime;
                stats.active.add(physics);
                stats.created += 1;
                const dispose = physics.dispose.bind(physics);
                physics.dispose = () => {
                    const alreadyDisposed = physics.disposed;
                    const result = dispose();
                    if (!alreadyDisposed) {
                        stats.disposed += 1;
                        stats.active.delete(physics);
                        if (physics.manager.nativeObjects.size) stats.errors.push('物理销毁后仍有native资源');
                    }
                    return result;
                };
                return physics;
            };
        });
        await page.evaluate(async () => {
            if (!await window.DisplayMmd.setPhysicsEnabled(false)) throw new Error('物理重载失败');
            if (!await window.DisplayMmd.setPhysicsEnabled(true)) throw new Error('物理重载失败');
        });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), currentUrl);
        assert.deepEqual(await page.evaluate(() => window.DisplayMmd.getModelGravityState().settings), { deadZoneDegrees: 0.8, smoothingMs: 0 });
        assert.ok(await page.evaluate(() => window.DisplayMmd.getMotionProgress().durationSeconds > 0));
        // 记录真实物理创建与前两次渲染更新；加载阶段不得调用零帧更新。
        await page.evaluate(async () => {
            const { MMDAnimationHelper } = await import('three/addons/animation/MMDAnimationHelper.js');
            const update = MMDAnimationHelper.prototype.update;
            const setup = MMDAnimationHelper.prototype._setupMeshPhysics;
            const frameCounts = new WeakMap();
            window.motionSwitchTrace = [];
            MMDAnimationHelper.prototype.update = function (delta) {
                const data = this.objects.get(this.meshes[0]);
                if (delta === 0 && data?.mixer && !data.physics) {
                    window.motionSwitchTrace.push({ phase: 'early-pose' });
                }
                const count = frameCounts.get(this);
                if (data?.mixer && count !== undefined && count < 2) {
                    window.motionSwitchTrace.push({ phase: 'frame', animation: this.enabled.animation,
                        time: data.mixer._actions[0].time });
                    frameCounts.set(this, count + 1);
                }
                return update.call(this, delta);
            };
            MMDAnimationHelper.prototype._setupMeshPhysics = function (mesh, options) {
                const data = this.objects.get(mesh);
                window.motionSwitchTrace.push({ phase: 'physics', time: data?.mixer?._actions?.[0]?.time,
                    animationWarmup: options.animationWarmup, warmup: options.warmup });
                if (data?.mixer) frameCounts.set(this, 0);
                return setup.call(this, mesh, options);
            };
        });
        await upload('#mmdArLocalVmd', [vmdPath]);
        await page.waitForFunction(() => window.motionSwitchTrace.filter((item) => item.phase === 'frame').length === 2);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'false');
        assert.deepEqual(await page.evaluate(() => window.motionSwitchTrace), [
            { phase: 'physics', time: 0, animationWarmup: false, warmup: 0 },
            { phase: 'frame', animation: false, time: 0 },
            { phase: 'frame', animation: false, time: 0 }
        ]);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getMotionProgress().timeSeconds), 0);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getState().motionPlaybackEnabled), false);
        await page.evaluate(() => { window.motionSwitchTrace.length = 0; });
        await page.click('#mmdArLocalDefaultMotion');
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), currentUrl);
        assert.deepEqual(await page.evaluate(() => window.DisplayMmd.getModelGravityState().settings), { deadZoneDegrees: 0.8, smoothingMs: 0 });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl.includes('__local__')), false);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getMotionProgress().timeSeconds), 0);
        await page.waitForFunction(() => window.motionSwitchTrace.filter((item) => item.phase === 'frame').length === 2);
        assert.deepEqual(await page.evaluate(() => window.motionSwitchTrace.map((item) => item.phase)), ['physics', 'frame', 'frame']);
        await page.click('#mmdArLocalDefaultModel');
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl.includes('__local__')), false);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getState().modelReady), true);
        await page.waitForFunction(() => window.motionSwitchTrace.filter((item) => item.phase === 'frame').length === 4);
        // 超过原64MiB堆可容纳的泄漏切换次数；每轮只剩当前实例，验证实际文件输入和native回收。
        const probes = [];
        for (let index = 0; index < 24; index += 1) {
            const playing = index < 12;
            await page.evaluate((enabled) => {
                window.DisplayMmd.setMotionPlaybackEnabled(enabled);
                window.motionSwitchTrace.length = 0;
            }, playing);
            await upload('#mmdArLocalVmd', [vmdPath]);
            await page.waitForFunction(() => window.motionSwitchTrace.filter((item) => item.phase === 'frame').length === 2);
            assert.deepEqual(await page.evaluate(() => window.motionSwitchTrace), [
                { phase: 'physics', time: 0, animationWarmup: false, warmup: 0 },
                { phase: 'frame', animation: false, time: 0 },
                { phase: 'frame', animation: playing, time: 0 }
            ]);
            if (index % 6 === 5) {
                const inheritedUrl = await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl);
                await upload('#mmdArLocalFiles', [pmxPath, ...textures]);
                assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), playing ? inheritedUrl : '');
                if (playing) {
                    await page.waitForFunction(() => window.DisplayMmd.getMotionProgress()?.timeSeconds > 0);
                    assert.equal(await page.$eval('#mmdArLocalMotionName', (element) => element.textContent), path.basename(vmdPath));
                } else {
                    assert.equal(await page.evaluate(() => window.DisplayMmd.getMotionProgress()), null);
                    assert.equal(await page.$eval('#mmdArLocalMotionName', (element) => element.textContent), '无 VMD 动作（可单独选择）');
                }
            }
            const lifetime = await page.evaluate(() => {
                const { active, created, disposed, errors } = window.physicsLifetime;
                const pointer = Ammo._malloc(4 * 1024 * 1024);
                Ammo._free(pointer);
                return { active: active.size, created, disposed, errors,
                    resources: [...active].map((physics) => physics.manager.nativeObjects.size),
                    probe: pointer, heap: Ammo.HEAP8.byteLength };
            });
            assert.equal(lifetime.active, 1, JSON.stringify(lifetime));
            assert.equal(lifetime.created - lifetime.disposed, 1);
            assert.deepEqual(lifetime.errors, []);
            assert.ok(lifetime.resources[0] > 0);
            assert.equal(lifetime.heap, 64 * 1024 * 1024);
            assert.ok(lifetime.probe > 0);
            probes.push(lifetime.probe);
            assert.equal(await page.evaluate(() => window.DisplayMmd.getState().motionPlaybackEnabled), playing);
            if (index % 6 === 5) console.info(`连续切换已验证${index + 1}/24次动作、${(index + 1) / 6}/4次模型`);
        }
        // 新旧实例在提交前短暂并存，碰撞计算也会改变空闲块布局；地址不必逐字相同。
        // 限制预热后的地址范围，并逐轮确认64MiB堆、当前仅1实例和销毁后的native分配为0。
        const stableProbes = probes.slice(8);
        const probeRange = Math.max(...stableProbes) - Math.min(...stableProbes);
        assert.ok(probeRange < 8 * 1024 * 1024, `切换后内存范围必须保持有界：${probes}`);
        const result = await page.evaluate(() => ({ created: window.physicsLifetime.created,
            disposed: window.physicsLifetime.disposed, active: window.physicsLifetime.active.size,
            heap: Ammo.HEAP8.byteLength }));
        console.info('真实网页24次VMD/4次PMX连续切换:', JSON.stringify({ ...result, probeRange }));
        assert.deepEqual(errors, []);
        assert.equal(requests.some((url) => url.includes('__local__')), false, '本地资源不能回退到 HTTP 请求');
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
        // 只清理本测试创建的损坏 VMD 和备用 PMX 临时文件。
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
