'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const SUPPORTED_LEVELS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 94, 95, 97, 98, 99, 100, 101, 102, 103, 104, 112, 113, 114, 115, 116, 117, 118];

test('环境预设 16 种季节×天气组合与关卡季节映射完整', async () => {
    const presets = await import('../web/pig-level/3d/presets.mjs');
    assert.deepEqual(presets.SEASONS, ['spring', 'summer', 'autumn', 'winter']);
    assert.deepEqual(presets.WEATHERS, ['sunny', 'cloudy', 'rain', 'snow']);
    assert.equal(presets.WEATHER_BASE.cloudy.sunIntensity, 1.4);
    assert.equal(presets.WEATHER_BASE.cloudy.hemiIntensity, 1.06);
    assert.equal(presets.WEATHER_BASE.rain.sunIntensity, 1.08);
    assert.equal(presets.WEATHER_BASE.rain.hemiIntensity, 1.02);

    for (const season of presets.SEASONS) {
        for (const weather of presets.WEATHERS) {
            for (const cage of [false, true]) {
                const p = presets.buildPreset(season, weather, { cage });
                for (const key of presets.PRESET_KEYS) {
                    assert.notEqual(p[key], undefined, `${season}/${weather}/cage=${cage} 缺少 ${key}`);
                }
                assert.equal(p.dusk, cage ? 1 : 0);
                assert.match(p.skyZenith, /^#[0-9a-f]{6}$/i);
                assert.match(p.grassTip, /^#[0-9a-f]{6}$/i);
            }
        }
    }

    for (const id of SUPPORTED_LEVELS) {
        const s = presets.seasonForLevel(id);
        assert.ok(presets.SEASONS.includes(s));
        const w1 = presets.randomWeather(s, id);
        const w2 = presets.randomWeather(s, id);
        assert.equal(w1, w2, '同关随机天气应稳定');
        assert.ok(presets.WEATHERS.includes(w1));
    }
});

test('FPS 自动降档需连续两个周期低于阈值且切换窗口可重置', async () => {
    const { createPostPipeline } = await import('../web/pig-level/3d/post.mjs');
    const dummyRenderer = { setPixelRatio() {}, setSize() {}, shadowMap: { enabled: true } };
    const tiers = [];
    const post = createPostPipeline(dummyRenderer, 'high', t => tiers.push(t), false);
    const runWindow = (fps, sec = 2.6) => {
        const step = 1 / fps;
        for (let t = 0; t < sec; t += step) post.recordFrame(step);
    };
    runWindow(20); // 首轮编译跳过窗口：不降档
    assert.equal(post.getTier(), 'high');
    runWindow(20); // 第 1 次低帧窗口：仅累计不降档
    assert.equal(post.getTier(), 'high');
    post.resetFpsMonitor(); // 模拟切回标签页/获焦重置
    runWindow(20);
    runWindow(20);
    assert.equal(post.getTier(), 'high');
    runWindow(20); // 连续第 2 个非跳过低帧窗口才降到 medium
    assert.equal(post.getTier(), 'medium');
    assert.deepEqual(tiers, ['medium']);
    post.dispose();
});

test('本地预览服务提供全部 3D 模块与 vendor 资源', async () => {
    const port = 18988 + Math.floor(Math.random() * 500);
    const server = spawn(process.execPath, ['scripts/serve-pig-level.js'], { env: { ...process.env, PIG_LEVEL_PORT: String(port) }, stdio: 'pipe' });
    try {
        await new Promise((resolve, reject) => {
            server.stdout.once('data', resolve);
            server.once('error', reject);
        });
        const files = [
            '/vendor/three.module.min.js',
            '/3d/presets.mjs', '/3d/textures.mjs', '/3d/geometry.mjs', '/3d/models.mjs',
            '/3d/scenery.mjs', '/3d/grass.mjs', '/3d/particles.mjs', '/3d/environment.mjs',
            '/3d/holo-ui.mjs', '/3d/audio.mjs', '/3d/post.mjs', '/3d/view.mjs'
        ];
        for (const f of files) {
            const res = await fetch(`http://127.0.0.1:${port}${f}`, { method: 'HEAD' });
            assert.equal(res.status, 200, `${f} 应返回 200`);
        }
    } finally {
        server.kill();
    }
});

// 查找 DISPLAY=:0 可用的 XAUTHORITY 文件，并在 DISPLAY=:0 上新开独立的硬件 GPU Chromium（不用 9222，也不用软光栅）。
function resolveDisplay0Auth() {
    if (process.env.XAUTHORITY && existsSync(process.env.XAUTHORITY)) return process.env.XAUTHORITY;
    try {
        const tmpMatch = readdirSync('/tmp')
            .filter(name => name.startsWith('xauth_'))
            .map(name => join('/tmp', name))
            .find(p => existsSync(p));
        if (tmpMatch) return tmpMatch;
    } catch (_) {}
    const homeAuth = join(process.env.HOME || '/home/as', '.Xauthority');
    return existsSync(homeAuth) ? homeAuth : '';
}

async function launchDisplay0Chromium(puppeteer) {
    if (!existsSync('/usr/bin/chromium')) return null;
    const xauth = resolveDisplay0Auth();
    let debugPort = 9333;
    try {
        const probe = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(400) });
        if (probe.ok) debugPort = 0; // 若 9333 已被占用，改用动态空闲调试端口
    } catch (_) {}
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: false,
        env: { ...process.env, DISPLAY: ':0', ...(xauth ? { XAUTHORITY: xauth } : {}) },
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=1360,820',
            '--remote-debugging-address=127.0.0.1',
            `--remote-debugging-port=${debugPort}`
        ]
    });
    return { browser, attached: false };
}

test('3D 模式渲染、点击小猪、全息 UI 按钮、季节天气切换与多视口校验', { timeout: 180000 }, async t => {
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); } catch (_) { t.skip('需要 puppeteer-core'); return; }

    const port = 19500 + Math.floor(Math.random() * 500);
    const server = spawn(process.execPath, ['scripts/serve-pig-level.js'], { env: { ...process.env, PIG_LEVEL_PORT: String(port) }, stdio: 'pipe' });
    let session = null;
    let page = null;
    try {
        await new Promise((resolve, reject) => {
            server.stdout.once('data', resolve);
            server.once('error', reject);
        });
        session = await launchDisplay0Chromium(puppeteer);
        if (!session) { t.skip('需要 DISPLAY=:0 与 /usr/bin/chromium'); return; }
        const { browser } = session;
        page = await browser.newPage();
        await page.bringToFront();
        const errors = [];
        const warns = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
            if (msg.type() === 'warning') warns.push(msg.text());
        });

        await page.setViewport({ width: 1280, height: 720 });
        await page.goto(`http://127.0.0.1:${port}/?level=48`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d?.ready || document.querySelectorAll('.pig').length > 0), { timeout: 45000 });

        const probe = await page.evaluate(() => {
            const c = document.createElement('canvas');
            const glCtx = c.getContext('webgl2') || c.getContext('webgl');
            const dbg = glCtx ? glCtx.getExtension('WEBGL_debug_renderer_info') : null;
            const renderer = dbg && glCtx ? String(glCtx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
            return {
                gl: Boolean(glCtx),
                renderer,
                isSoftware: /swiftshader|llvmpipe|softpipe/i.test(renderer),
                tier: window.__pig3d?.tier,
                has3d: Boolean(window.__pig3d && window.__pig3d.ready && document.body.classList.contains('mode-3d'))
            };
        });
        assert.deepEqual(warns.filter(w => w.includes('3D 视图初始化失败')), [], `3D 初始化不应报错降级: ${warns.join('; ')}`);
        if (!probe.gl) {
            assert.equal(await page.$$('.pig').then(a => a.length) > 0, true, '无 WebGL 时应自动回退 2D 棋盘');
            assert.deepEqual(errors, []);
            return;
        }
        assert.equal(probe.has3d, true, 'WebGL 可用时必须成功进入 3D 模式');
        assert.equal(probe.isSoftware, false, `不应使用软光栅渲染，当前 renderer: ${probe.renderer}`);
        assert.ok(['high', 'medium'].includes(probe.tier), `DISPLAY=:0 硬件 GPU 应运行在 high 或 medium 画质档位，当前: ${probe.tier}`);
        const eyeY = await page.evaluate(id => window.__pig3d.getEyeOffsetY(id), 1);
        assert.ok(eyeY > 0.3, `小猪眼睛应以眼窝中心为原点偏移 (${eyeY})，避免眨眼掉出`);

        // 1. 连续点击前两只提示小猪：第一只离场动画未播完时也能直接点下一只
        const firstTwo = await page.evaluate(async () => (await (await fetch('./level-48.json')).json()).steps.slice(0, 2).map(s => s.id));
        const pt = await page.evaluate(id => window.__pig3d.screenOf(id), firstTwo[0]);
        assert.ok(pt && pt.x > 0 && pt.y > 0, '提示小猪应有有效的 3D 屏幕投影坐标');
        await page.mouse.click(pt.x, pt.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '1 / 176', { timeout: 15000 });
        const pt2 = await page.evaluate(id => window.__pig3d.screenOf(id), firstTwo[1]);
        await page.mouse.click(pt2.x, pt2.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '2 / 176', { timeout: 15000 });

        // 1b. 验证右键平移（抑制浏览器右键弹窗且不触发点击）
        await page.mouse.move(600, 360);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(650, 390);
        await page.mouse.up({ button: 'right' });

        // 1c. 验证居中平滑滑动关卡选择器打开与有边界翻页
        const pickerBtn = await page.evaluate(() => window.__pig3d.holoButton('level-picker'));
        await page.mouse.click(pickerBtn.x, pickerBtn.y);
        const pickerTitlePos = await page.evaluate(() => window.__pig3d.holoButton('picker-title'));
        const halfW = await page.evaluate(() => window.innerWidth / 2);
        assert.ok(pickerTitlePos && Math.abs(pickerTitlePos.x - halfW) < 80, '关卡选择器应居中显示');
        const loopBtn = await page.evaluate(() => window.__pig3d.holoButton('picker-next'));
        await page.mouse.click(loopBtn.x, loopBtn.y);
        const closeBtn = await page.evaluate(() => window.__pig3d.holoButton('picker-close'));
        await page.mouse.click(closeBtn.x, closeBtn.y);

        // 2. 通过全息 UI 按钮执行下一步、撤回、切换季节天气
        const nextBtn = await page.evaluate(() => window.__pig3d.holoButton('next'));
        assert.ok(nextBtn, '全息下一步按钮应可定位');
        await page.mouse.click(nextBtn.x, nextBtn.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '3 / 176', { timeout: 15000 });

        const undoBtn = await page.evaluate(() => window.__pig3d.holoButton('undo'));
        await page.mouse.click(undoBtn.x, undoBtn.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '2 / 176', { timeout: 15000 });

        // 打开环境设置抽屉并切换冬雪
        const setBtn = await page.evaluate(() => window.__pig3d.holoButton('settings-toggle'));
        await page.mouse.click(setBtn.x, setBtn.y);
        const winterBtn = await page.evaluate(() => window.__pig3d.holoButton('season-winter'));
        const snowBtn = await page.evaluate(() => window.__pig3d.holoButton('weather-snow'));
        assert.ok(winterBtn && snowBtn, '全息季节天气按钮应可见');
        await page.mouse.click(winterBtn.x, winterBtn.y);
        await page.mouse.click(snowBtn.x, snowBtn.y);
        const preset = await page.evaluate(() => window.__pig3d.preset);
        assert.deepEqual(preset, { season: 'winter', weather: 'snow', isCageLevel: false });

        // 3. 验证四种视口下全屏一屏无滚动且棋盘存在（并用独立标签页验证移动端 2x HiDPI 清晰度，避免 setViewport 变更 DPR 触发重载超时）
        for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }, { width: 960, height: 720 }]) {
            await page.setViewport(vp);
            const metrics = await page.evaluate(() => ({
                sw: document.documentElement.scrollWidth,
                sh: document.documentElement.scrollHeight,
                iw: window.innerWidth,
                ih: window.innerHeight,
                actors: window.__pig3d.getActorCount()
            }));
            assert.ok(metrics.sw <= metrics.iw && metrics.sh <= metrics.ih, `${vp.width}x${vp.height} 不应溢出视口`);
            assert.ok(metrics.actors > 0);
        }
        const mobPage = await browser.newPage();
        try {
            await mobPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
            await mobPage.bringToFront();
            await mobPage.goto(`http://127.0.0.1:${port}/?level=48`, { waitUntil: 'domcontentloaded' });
            await mobPage.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
            const mobMetrics = await mobPage.evaluate(() => {
                const cv = document.querySelector('#scene3d canvas');
                return { cw: cv ? cv.width : 0, iw: window.innerWidth, dpr: window.devicePixelRatio || 1, tier: window.__pig3d.tier };
            });
            assert.ok(['high', 'medium'].includes(mobMetrics.tier), `高分手机端不应被像素数降档为 low，当前: ${mobMetrics.tier}`);
            assert.ok(mobMetrics.cw >= mobMetrics.iw * 1.75, `移动端 2x HiDPI 渲染画布应保持高分辨率 (${mobMetrics.cw} vs ${mobMetrics.iw}×${mobMetrics.dpr})`);
        } finally {
            await mobPage.close().catch(() => {});
        }
        await page.bringToFront();

        // 4. 测试简洁 2D 控件快捷键 'c' 与第 118 关自由试玩、第 61 关铁笼黄昏
        await page.keyboard.press('c');
        assert.equal(await page.evaluate(() => document.body.classList.contains('show-2d-controls')), true);
        await page.goto(`http://127.0.0.1:${port}/?level=61`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
        assert.equal(await page.evaluate(() => window.__pig3d.preset.isCageLevel), true);
        await page.goto(`http://127.0.0.1:${port}/?level=118`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
        assert.equal(await page.evaluate(() => window.__pig3d.getActorCount()), 91);

        // 5. 验证第 113 关计时炸弹会实时倒计时
        await page.goto(`http://127.0.0.1:${port}/?level=113`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
        const tBefore = await page.evaluate(() => window.__pig3d.getTimerSeconds(24));
        await new Promise(r => setTimeout(r, 2300));
        const tAfter = await page.evaluate(() => window.__pig3d.getTimerSeconds(24));
        assert.ok(tBefore <= 80 && tBefore >= 75 && tAfter < tBefore, `第 113 关计时炸弹应实时倒计时 (${tBefore} -> ${tAfter})`);
        // 6. 验证第 63 关鸭子通路打开后触发 3D 逃出移动动画（第 3 步起即有小鸭逃出）
        await page.goto(`http://127.0.0.1:${port}/?level=63`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
        let duckTweenSaw = false;
        for (let i = 0; i < 6; i++) {
            const btn = await page.evaluate(() => window.__pig3d.holoButton('next'));
            assert.ok(btn, '第 63 关下一步全息按钮应可定位');
            await page.mouse.click(btn.x, btn.y);
            if (await page.evaluate(() => window.__pig3d.getDuckExitTweenCount() > 0)) {
                duckTweenSaw = true;
                break;
            }
        }
        assert.equal(duckTweenSaw, true, '第 63 关小鸭通路打通时应触发逃出移动动画');

        // 7. 验证 ?tier=low 花降档与 0 报错
        await page.goto(`http://127.0.0.1:${port}/?level=48&tier=low`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
        assert.equal(await page.evaluate(() => window.__pig3d.tier), 'low');

        assert.deepEqual(errors, [], `不应有页面或控制台错误: ${errors.join('; ')}`);
    } finally {
        if (page) await page.close().catch(() => {});
        if (session) {
            if (session.attached) session.browser.disconnect();
            else await session.browser.close().catch(() => {});
        }
        server.kill();
    }
});
