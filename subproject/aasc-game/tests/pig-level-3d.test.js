'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const SUPPORTED_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 94, 95, 97, 98, 99, 100, 101, 102, 103, 104, 112, 113, 114, 115, 116, 117, 118];

test('环境预设 12 种季节×天气组合（含冬雨自动飘雪）与关卡季节映射完整', async () => {
    const presets = await import('../web/pig-level/3d/presets.mjs');
    assert.deepEqual(presets.SEASONS, ['spring', 'summer', 'autumn', 'winter']);
    assert.deepEqual(presets.WEATHERS, ['sunny', 'cloudy', 'rain']);
    assert.equal(presets.WEATHER_BASE.cloudy.sunIntensity, 1.4);
    assert.equal(presets.WEATHER_BASE.cloudy.hemiIntensity, 1.06);
    assert.equal(presets.WEATHER_BASE.rain.sunIntensity, 1.08);
    assert.equal(presets.WEATHER_BASE.rain.hemiIntensity, 1.02);
    assert.equal(presets.buildPreset('winter', 'rain').precip, 'snow', '冬季降水应自动转为飘雪');
    const winterSun = presets.buildPreset('winter', 'sunny');
    assert.ok(winterSun.lawn !== winterSun.ground && winterSun.snowCover >= 0.78, '冬季应保留棋盘青绿覆霜草坪并形成外围粉雪雪地');

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

test('手机端草叶数量三档调整为 8000 / 4000 / 2000', async () => {
    const { grassCountForTier } = await import('../web/pig-level/3d/grass.mjs');
    assert.equal(grassCountForTier('high', false, false), 140000);
    assert.equal(grassCountForTier('medium', false, false), 36000);
    assert.equal(grassCountForTier('low', false, false), 22000);
    assert.equal(grassCountForTier('high', true, false), 8000);
    assert.equal(grassCountForTier('medium', true, false), 4000);
    assert.equal(grassCountForTier('low', true, false), 2000);
    assert.equal(grassCountForTier('high', true, true), 1500);
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
            '/3d/holo-ui.mjs', '/3d/audio.mjs', '/3d/post.mjs', '/3d/view.mjs',
            '/assets/ui/panel-parchment.svg', '/assets/ui/btn-close.svg',
            '/assets/ui/dial-pointer.svg', '/assets/ui/center-knob.svg', '/assets/ui/btn-pill.svg'
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

test('3D 模式渲染、点击小猪、全息 UI 按钮、季节天气切换与多视口校验', { timeout: 300000 }, async t => {
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
        // 0. 校验无参数默认打开第 1 关，显示新手引导标语与手势精灵并可按指引点击推进
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d?.ready), { timeout: 45000 });
        const lv1Info = await page.evaluate(() => ({
            levelNum: document.querySelector('#levelNumber')?.textContent,
            actors: window.__pig3d.getActorCount(),
            guide: window.__pig3d.getGuideText(),
            hand: window.__pig3d.hasGuideHand(),
            pt: window.__pig3d.screenOf(1),
            otherPt: window.__pig3d.screenOf(6)
        }));
        assert.equal(lv1Info.levelNum, '1', '不带参数打开首页应默认进入第 1 关');
        assert.equal(lv1Info.actors, 6, '第 1 关应包含 6 只小猪');
        assert.match(lv1Info.guide, /点击高亮小猪/, '第 1 关首步应显示新手引导提示');
        assert.equal(lv1Info.hand, true, '第 1 关引导目标应显示 3D 手势精灵');
        // 右键旋转视角后，手指指尖锚点仍应紧贴目标猪 1 号，不发生偏斜
        await page.mouse.move(450, 340);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(680, 340, { steps: 6 });
        await page.mouse.up({ button: 'right' });
        await new Promise(r => setTimeout(r, 200));
        const lv1Rot = await page.evaluate(() => ({
            pig: window.__pig3d.screenOf(1),
            hand: window.__pig3d.getGuideHandScreen(),
            otherPt: window.__pig3d.screenOf(6)
        }));
        const handDist = Math.hypot(lv1Rot.hand.x - lv1Rot.pig.x, lv1Rot.hand.y - lv1Rot.pig.y);
        assert.ok(handDist < 42, `旋转视角后引导手指指尖应依然贴合目标小猪 (${handDist.toFixed(1)}px)`);
        // 引导期点击非目标猪（6号）应被拦截，不能出局或推进步骤
        await page.mouse.click(lv1Rot.otherPt.x, lv1Rot.otherPt.y);
        await new Promise(r => setTimeout(r, 120));
        assert.equal(await page.evaluate(() => document.querySelector('#progressText').textContent), '0 / 6', '引导期点击其它小猪不应触发离场');
        assert.match(await page.evaluate(() => window.__pig3d.getGuideText()), /手势指引/, '引导期误点其它猪应提示先点击手势指引的高亮小猪');
        await page.mouse.click(lv1Rot.pig.x, lv1Rot.pig.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '1 / 6', { timeout: 15000 });

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
        const pcFit = await page.evaluate(() => window.__pig3d.getBoardScreenBounds());
        assert.ok(pcFit.heightRatio >= 0.88 && pcFit.widthRatio <= 0.99, `横屏默认镜头应填满安全区高度 (${JSON.stringify(pcFit)})`);
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

        // 1b. 验证在小猪身上与空白地面左键拖拽均正常平移相机、右键拖拽旋转（抑制浏览器右键弹窗且不触发点击）
        const camOnPigBefore = await page.evaluate(() => window.__pig3d.getCameraState());
        const dragPigPt = await page.evaluate(id => window.__pig3d.screenOf(id), 1);
        await page.mouse.move(dragPigPt.x, dragPigPt.y);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(dragPigPt.x + 80, dragPigPt.y + 35, { steps: 4 });
        await page.mouse.up({ button: 'left' });
        const camOnPigAfter = await page.evaluate(() => window.__pig3d.getCameraState());
        assert.ok(Math.hypot(camOnPigAfter.panX - camOnPigBefore.panX, camOnPigAfter.panZ - camOnPigBefore.panZ) > 0.05,
            '鼠标在小猪身上按下拖动也应正常平移相机');
        assert.ok(Math.abs(camOnPigAfter.yaw - camOnPigBefore.yaw) < 1e-4, '左键平移不应改变偏航角');
        assert.equal(await page.evaluate(() => document.querySelector('#progressText').textContent), '2 / 176', '小猪身上拖动不应触发离场点击');

        const camBefore = await page.evaluate(() => window.__pig3d.getCameraState());
        await page.mouse.move(120, 620);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(200, 650, { steps: 4 });
        await page.mouse.up({ button: 'left' });
        const camAfterPan = await page.evaluate(() => window.__pig3d.getCameraState());
        assert.ok(Math.hypot(camAfterPan.panX - camBefore.panX, camAfterPan.panZ - camBefore.panZ) > 0.05, '空白地面左键拖拽应平移视角');
        assert.ok(Math.abs(camAfterPan.yaw - camBefore.yaw) < 1e-4, '左键平移不应改变偏航角');

        await page.mouse.move(650, 390);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(570, 340, { steps: 4 });
        await page.mouse.up({ button: 'right' });
        const camAfterRot = await page.evaluate(() => window.__pig3d.getCameraState());
        assert.ok(Math.abs(camAfterRot.yaw - camAfterPan.yaw) > 0.05 || Math.abs(camAfterRot.pitch - camAfterPan.pitch) > 0.05, '右键拖拽应旋转视角');
        assert.equal(await page.evaluate(() => document.querySelector('#progressText').textContent), '2 / 176', '拖拽不应误点小猪');
        await page.evaluate(() => window.__pig3d.resetCamera());
        await new Promise(r => setTimeout(r, 1000));

        // 验证偏心鼠标滚轮缩放与右键旋转围绕鼠标下的地面射线点进行
        const gWheel = await page.evaluate(() => window.__pig3d.getGroundAtScreen(300, 220));
        assert.ok(gWheel, '偏心鼠标处应命中地面');
        await page.mouse.move(300, 220);
        await page.mouse.wheel({ deltaY: -220 });
        await new Promise(r => setTimeout(r, 120));
        const pWheelMid = await page.evaluate(g => window.__pig3d.projectWorld(g.x, 0, g.z), gWheel);
        assert.ok(Math.hypot(pWheelMid.x - 300, pWheelMid.y - 220) < 4,
            `滚轮缩放过渡中途也应实时锁定鼠标下地面点 (${pWheelMid.x.toFixed(1)}, ${pWheelMid.y.toFixed(1)} vs 300, 220)`);
        await new Promise(r => setTimeout(r, 900));
        const pWheel = await page.evaluate(g => window.__pig3d.projectWorld(g.x, 0, g.z), gWheel);
        assert.ok(Math.hypot(pWheel.x - 300, pWheel.y - 220) < 6,
            `鼠标滚轮缩放应以鼠标下地面点为中心 (${pWheel.x.toFixed(1)}, ${pWheel.y.toFixed(1)} vs 300, 220)`);

        const gRight = await page.evaluate(() => window.__pig3d.getGroundAtScreen(300, 220));
        await page.mouse.move(300, 220);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(400, 250, { steps: 6 });
        await new Promise(r => setTimeout(r, 120)); // 停稳后松手避免大幅惯性
        await page.mouse.up({ button: 'right' });
        await new Promise(r => setTimeout(r, 1000));
        const pRight = await page.evaluate(g => window.__pig3d.projectWorld(g.x, 0, g.z), gRight);
        assert.ok(Math.hypot(pRight.x - 300, pRight.y - 220) < 8,
            `右键旋转应围绕右键按下时地面射线点保持锁定 (${pRight.x.toFixed(1)}, ${pRight.y.toFixed(1)} vs 300, 220)`);
        const camBeforeDbl = await page.evaluate(() => window.__pig3d.getCameraState());
        await page.mouse.click(120, 620, { clickCount: 2 });
        const camAfterDbl = await page.evaluate(() => window.__pig3d.getCameraState());
        assert.ok(Math.abs(camAfterDbl.yaw - camBeforeDbl.yaw) < 1e-4 && Math.abs(camAfterDbl.zoom - camBeforeDbl.zoom) < 1e-4,
            '双击地面不应再触发视角复位');
        await page.evaluate(() => window.__pig3d.resetCamera());
        await new Promise(r => setTimeout(r, 1000));

        // 1c. 验证居中平滑滑动关卡选择器打开、遮罩半行滚动与有边界翻页
        const pickerBtn = await page.evaluate(() => window.__pig3d.holoButton('level-picker'));
        await page.mouse.click(pickerBtn.x, pickerBtn.y);
        const pickerTitlePos = await page.evaluate(() => window.__pig3d.holoButton('picker-title'));
        const halfW = await page.evaluate(() => window.innerWidth / 2);
        assert.ok(pickerTitlePos && Math.abs(pickerTitlePos.x - halfW) < 80, '关卡选择器应居中显示');
        await page.mouse.move(pickerTitlePos.x, pickerTitlePos.y + 85);
        await page.mouse.wheel({ deltaY: 55 });
        await new Promise(r => setTimeout(r, 150));
        const loopBtn = await page.evaluate(() => window.__pig3d.holoButton('picker-next'));
        await page.mouse.click(loopBtn.x, loopBtn.y);
        const closeBtn = await page.evaluate(() => window.__pig3d.holoButton('picker-close'));
        assert.ok(closeBtn && closeBtn.y < pickerTitlePos.y + 8 && loopBtn.y > pickerTitlePos.y + 120, '关卡标题与翻页按钮应位于遮罩区上下两侧不重叠');
        await page.mouse.click(closeBtn.x, closeBtn.y);

        // 2. 通过全息 UI 按钮执行下一步、撤回、切换季节天气
        const nextBtn = await page.evaluate(() => window.__pig3d.holoButton('next'));
        assert.ok(nextBtn, '全息下一步按钮应可定位');
        await page.mouse.click(nextBtn.x, nextBtn.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '3 / 176', { timeout: 15000 });

        const undoBtn = await page.evaluate(() => window.__pig3d.holoButton('undo'));
        await page.mouse.click(undoBtn.x, undoBtn.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '2 / 176', { timeout: 15000 });

        // 打开居中大号 SVG 环境设置弹窗并操作外圈单指针 24h 表盘切换冬雨(雪)及早/晚/夜，校验 UI 随天气换肤及夜间月光方位
        const setBtn = await page.evaluate(() => window.__pig3d.holoButton('settings-toggle'));
        await page.mouse.click(setBtn.x, setBtn.y);
        const setTitlePos = await page.evaluate(() => window.__pig3d.holoButton('settings-title'));
        const setCloseBtn = await page.evaluate(() => window.__pig3d.holoButton('settings-close'));
        const winterBtn = await page.evaluate(() => window.__pig3d.holoButton('season-winter'));
        const rainBtn = await page.evaluate(() => window.__pig3d.holoButton('weather-rain'));
        const morningBtn = await page.evaluate(() => window.__pig3d.holoButton('time-morning'));
        const noonBtn = await page.evaluate(() => window.__pig3d.holoButton('time-noon'));
        const eveningBtn = await page.evaluate(() => window.__pig3d.holoButton('time-evening'));
        const nightBtn = await page.evaluate(() => window.__pig3d.holoButton('time-night'));
        assert.ok(setTitlePos && Math.abs(setTitlePos.x - halfW) < 80, '环境设置弹窗应居中显示');
        assert.ok(winterBtn && rainBtn && morningBtn && noonBtn && eveningBtn && nightBtn && setCloseBtn, '居中环境弹窗时钟扇区与关闭按钮均应可定位');
        const dialSize = await page.evaluate(() => window.__pig3d.getClockDialSize());
        assert.deepEqual(dialSize, { w: 462, h: 462 }, `桌面端时钟表盘应放大至 462×462 (实际 ${dialSize?.w}×${dialSize?.h})`);
        assert.ok(Math.abs(eveningBtn.y - morningBtn.y) > 350, `462px 表盘早晚按钮间距应等比放大 (${Math.abs(eveningBtn.y - morningBtn.y).toFixed(1)}px)`);
        const parseHexRgb = hex => {
            const clean = String(hex || '#ffffff').replace('#', '');
            return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
        };
        await page.mouse.click(winterBtn.x, winterBtn.y);
        await page.mouse.click(rainBtn.x, rainBtn.y);
        await page.mouse.click(morningBtn.x, morningBtn.y);
        await page.waitForFunction(() => window.__pig3d.getGrassLightState().nightMix < 0.1 && window.__pig3d.getPigLightState().lightDir.x > 0.3, { timeout: 5000 });
        const morningLight = await page.evaluate(() => ({
            sun: window.__pig3d.getSunPosition(),
            grass: window.__pig3d.getGrassLightState(),
            pig: window.__pig3d.getPigLightState()
        }));
        await page.mouse.click(noonBtn.x, noonBtn.y);
        await page.waitForFunction(() => window.__pig3d.timeSlot === 'noon' && Math.abs(window.__pig3d.getPigLightState().lightDir.x) < 0.2, { timeout: 5000 });
        const noonLight = await page.evaluate(() => ({
            grass: window.__pig3d.getGrassLightState(),
            pig: window.__pig3d.getPigLightState()
        }));
        await page.mouse.click(eveningBtn.x, eveningBtn.y);
        await page.waitForFunction(() => window.__pig3d.getSunPosition().x < -10 && window.__pig3d.getPigLightState().lightDir.x < -0.3, { timeout: 5000 });
        const eveningLight = await page.evaluate(() => ({
            sun: window.__pig3d.getSunPosition(),
            grass: window.__pig3d.getGrassLightState(),
            pig: window.__pig3d.getPigLightState()
        }));
        assert.ok(morningLight.sun.x > 10 && eveningLight.sun.x < -10, `主光源应随早->晚时间变化摆动方向 (${morningLight.sun.x.toFixed(1)} -> ${eveningLight.sun.x.toFixed(1)})`);
        assert.ok(morningLight.pig.lightDir.x > 0.3 && eveningLight.pig.lightDir.x < -0.3, `猪材质主光方向应同步随早->晚光源转动 (${morningLight.pig.lightDir.x.toFixed(2)} -> ${eveningLight.pig.lightDir.x.toFixed(2)})`);
        const noonRgb = parseHexRgb(noonLight.grass.sunColor);
        const eveRgb = parseHexRgb(eveningLight.grass.sunColor);
        assert.ok(noonRgb[2] > 210 && eveRgb[0] - eveRgb[2] > 50, `24h 日光颜色应随正午白(${noonLight.grass.sunColor})到傍晚橘暖(${eveningLight.grass.sunColor})真实变化`);
        assert.ok(morningLight.grass.nightMix < 0.1, `白天草地 nightMix 应低于 0.1 (${morningLight.grass.nightMix.toFixed(2)})`);
        await page.mouse.click(nightBtn.x, nightBtn.y);
        await page.waitForFunction(() => window.__pig3d.getGrassLightState().nightMix > 0.8 && window.__pig3d.getPigLightState().nightMix > 0.8, { timeout: 5000 });
        const envState = await page.evaluate(() => ({
            preset: window.__pig3d.preset,
            timeSlot: window.__pig3d.timeSlot,
            sunNight: window.__pig3d.getSunPosition(),
            uiSkin: window.__pig3d.getUiSkinKey(),
            grass: window.__pig3d.getGrassLightState(),
            groundPbr: window.__pig3d.getGroundPbrState(),
            pig: window.__pig3d.getPigLightState()
        }));
        const nightRgb = parseHexRgb(envState.grass.sunColor);
        assert.deepEqual(envState.preset, { season: 'winter', weather: 'rain', isCageLevel: false });
        assert.equal(envState.timeSlot, 'night', '时钟表盘应切换 24h 时段为夜晚');
        assert.ok(envState.grass.snowCover >= 0.78, `冬雨草地应触发雪地稀草状态 (snowCover=${envState.grass.snowCover})`);
        assert.equal(envState.grass.metalness, 0, '草叶 PBR 金属度应预设为 0');
        assert.ok(envState.grass.roughness > 0.6, `冬季雪草 PBR 粗糙度应大于 0.6 (${envState.grass.roughness})`);
        assert.equal(envState.groundPbr.ground.metalness, 0, '外围地形 PBR 金属度应为 0');
        assert.equal(envState.groundPbr.lawn.metalness, 0, '棋盘草坪 PBR 金属度应为 0');
        assert.ok(
            envState.groundPbr.ground.roughness >= 0.4 && envState.groundPbr.ground.roughness <= 0.9 &&
            envState.groundPbr.lawn.roughness >= 0.4 && envState.groundPbr.lawn.roughness <= 0.9,
            `地面与草坪 PBR 粗糙度应在合理范围 (ground=${envState.groundPbr.ground.roughness}, lawn=${envState.groundPbr.lawn.roughness})`
        );
        const snowInteract = await page.evaluate(() => {
            window.__pig3d.stampGround(0, 0, 1.0, 1.0);
            return window.__pig3d.getSnowInteractSample(0, 0);
        });
        assert.ok(snowInteract.trample > 0.5, `冬季棋盘雪地应响应踩雪交互写入 (trample=${snowInteract.trample})`);
        assert.ok(envState.sunNight.z < -10 && envState.pig.lightDir.z < -0.3, `夜晚主光与猪受光方向均应转向天空月亮方位 z<0 (sunZ=${envState.sunNight.z.toFixed(1)}, pigDirZ=${envState.pig.lightDir.z.toFixed(2)})`);
        assert.ok(envState.grass.nightMix > 0.8 && nightRgb[2] > nightRgb[0], `夜晚草地与月光应响应深靛冷蓝夜色 (nightMix=${envState.grass.nightMix.toFixed(2)}, moon=${envState.grass.sunColor})`);
        const snowGroundRgb = parseHexRgb(envState.grass.groundColor);
        const snowBounceRgb = parseHexRgb(envState.grass.hemiGroundColor);
        assert.ok(snowGroundRgb[2] > 180 && snowBounceRgb[2] > snowBounceRgb[0] && snowBounceRgb[2] > 110,
            `冬季草叶应同步地面雪色与24h雪面半球反光 (ground=${envState.grass.groundColor}, bounce=${envState.grass.hemiGroundColor})`);
        assert.equal(envState.uiSkin, 'winterRain:night', '全息 UI 配色应跟随冬雨和夜间状态自动切换');
        await page.mouse.click(setCloseBtn.x, setCloseBtn.y);
        assert.equal(await page.evaluate(() => window.__pig3d.holoButton('settings-title')), null, '点击关闭按钮应关闭环境设置弹窗');

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
            await mobPage.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
            await mobPage.evaluateOnNewDocument(() => {
                Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 8, configurable: true });
            });
            await mobPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
            await mobPage.bringToFront();
            await mobPage.goto(`http://127.0.0.1:${port}/?level=48`, { waitUntil: 'domcontentloaded' });
            await mobPage.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
            const mobMetrics = await mobPage.evaluate(() => {
                const cv = document.querySelector('#scene3d canvas');
                return {
                    cw: cv ? cv.width : 0,
                    iw: window.innerWidth,
                    dpr: window.devicePixelRatio || 1,
                    tier: window.__pig3d.tier,
                    grass: window.__pig3d.getGrassCount(),
                    fit: window.__pig3d.getBoardScreenBounds()
                };
            });
            assert.ok(['high', 'medium'].includes(mobMetrics.tier), `高分手机端不应被像素数降档为 low，当前: ${mobMetrics.tier}`);
            assert.ok(mobMetrics.cw >= mobMetrics.iw * 1.75, `移动端 2x HiDPI 渲染画布应保持高分辨率 (${mobMetrics.cw} vs ${mobMetrics.iw}×${mobMetrics.dpr})`);
            assert.equal(mobMetrics.grass, mobMetrics.tier === 'high' ? 8000 : mobMetrics.tier === 'medium' ? 4000 : 2000, `手机端草叶数应为 8000 / 4000 / 2000 (当前 tier=${mobMetrics.tier}, grass=${mobMetrics.grass})`);
            assert.ok(mobMetrics.fit.widthRatio >= 0.88 && mobMetrics.fit.heightRatio <= 0.99, `竖屏默认镜头应贴紧宽边填满 (${JSON.stringify(mobMetrics.fit)})`);

            // 验证移动端单指平移、双指无极 Z 轴旋转（不手动改俯仰 + 惯性滑行）及高度自动计算俯仰
            const mobGesture = await mobPage.evaluate(async () => {
                const waitFrames = async n => {
                    for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r));
                };
                await waitFrames(3); // 等待首帧着色器/纹理上传就绪后再测手势惯性
                const cv = document.querySelector('#scene3d canvas');
                const fire = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {
                    pointerId: id, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true
                }));
                const c0 = window.__pig3d.getCameraState();
                const mobPig = window.__pig3d.screenOf(1);
                fire('pointerdown', 100, mobPig.x, mobPig.y);
                fire('pointermove', 100, mobPig.x + 55, mobPig.y + 30);
                fire('pointerup', 100, mobPig.x + 55, mobPig.y + 30);
                const cOnPig = window.__pig3d.getCameraState();

                fire('pointerdown', 101, 90, 200);
                fire('pointermove', 101, 150, 230);
                fire('pointerup', 101, 150, 230);
                const c1 = window.__pig3d.getCameraState();

                // 双指同距同角纯粹上下平移：pitch 不应被竖向拖拽改变
                fire('pointerdown', 201, 140, 380);
                fire('pointerdown', 202, 240, 380);
                fire('pointermove', 201, 140, 480);
                fire('pointermove', 202, 240, 480);
                const cVert = window.__pig3d.getCameraState();

                // 双指顺时针大角度拧转突破 ±0.62 限制 + 张开拉近降低俯仰角
                fire('pointermove', 201, 190, 290);
                fire('pointermove', 202, 190, 470); // 旋转约 +90° (1.57 rad) 且距离由 100 拉大到 180
                fire('pointerup', 201, 190, 290);
                fire('pointerup', 202, 190, 470);
                const cRelease = window.__pig3d.getCameraState();
                await new Promise(r => setTimeout(r, 150));
                await waitFrames(3);
                const cInertia = window.__pig3d.getCameraState();
                return { c0, cOnPig, c1, cVert, cRelease, cInertia };
            });
            assert.ok(Math.hypot(mobGesture.cOnPig.panX - mobGesture.c0.panX, mobGesture.cOnPig.panZ - mobGesture.c0.panZ) > 0.05, '移动端单指在小猪身上拖动也应正常平移视角');
            assert.ok(Math.hypot(mobGesture.c1.panX - mobGesture.c0.panX, mobGesture.c1.panZ - mobGesture.c0.panZ) > 0.05, '移动端空白地面单指拖拽应平移视角');
            assert.ok(Math.abs(mobGesture.cVert.pitch - mobGesture.c1.pitch) < 1e-4, `双指纯纵向平移不应直接改动俯仰角 (${mobGesture.c1.pitch} -> ${mobGesture.cVert.pitch})`);
            assert.ok(mobGesture.cRelease.yaw > 0.75, `双指应支持突破 ±0.62 弧度的无极旋转 (yaw=${mobGesture.cRelease.yaw})`);
            assert.ok(mobGesture.cRelease.zoom < mobGesture.c1.zoom && mobGesture.cRelease.pitch < mobGesture.c1.pitch,
                `双指张开拉近降低高度时俯仰角应自动放平 (zoom ${mobGesture.c1.zoom}->${mobGesture.cRelease.zoom}, pitch ${mobGesture.c1.pitch}->${mobGesture.cRelease.pitch})`);
            const dYawInertia = mobGesture.cInertia.yaw - mobGesture.cRelease.yaw;
            assert.ok(dYawInertia > 0.02 && dYawInertia < 0.45,
                `双指快滑松手后应适度轻量惯性旋转且不失控飞转 (${mobGesture.cRelease.yaw} -> ${mobGesture.cInertia.yaw}, Δ=${dYawInertia.toFixed(3)})`);

            // 验证偏心双指中心（例如左上偏心 120,280）缩放/旋转围绕双指比例中心锁定地面点
            await mobPage.evaluate(() => window.__pig3d.resetCamera());
            await new Promise(r => setTimeout(r, 1000));
            const mobAnchorCheck = await mobPage.evaluate(async () => {
                const cv = document.querySelector('#scene3d canvas');
                const fire = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, {
                    pointerId: id, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true
                }));
                const g0 = window.__pig3d.getGroundAtScreen(120, 280);
                fire('pointerdown', 301, 70, 280);
                fire('pointerdown', 302, 170, 280);
                fire('pointermove', 301, 120, 190);
                fire('pointermove', 302, 120, 370); // 围绕 (120, 280) 中心旋转 90° 并张开至 180px
                await new Promise(r => setTimeout(r, 120)); // 停稳后松手不触发惯性偏移测试
                fire('pointerup', 301, 120, 190);
                fire('pointerup', 302, 120, 370);
                await new Promise(r => setTimeout(r, 1000));
                const pAfter = window.__pig3d.projectWorld(g0.x, 0, g0.z);
                return { g0, pAfter };
            });
            assert.ok(mobAnchorCheck.g0 && Math.hypot(mobAnchorCheck.pAfter.x - 120, mobAnchorCheck.pAfter.y - 280) < 8,
                `移动端双指操作应以两指比例中心地面点为锚点 (${mobAnchorCheck.pAfter.x.toFixed(1)}, ${mobAnchorCheck.pAfter.y.toFixed(1)} vs 120, 280)`);
            // 验证双指旋转视角及竖↔横屏旋转后 3D 全息 UI 依然存在且可点击生效
            const mobNextAfterSpin = await mobPage.evaluate(() => window.__pig3d.holoButton('next'));
            assert.ok(mobNextAfterSpin && mobNextAfterSpin.x > 0 && mobNextAfterSpin.y > 0, '双指旋转视角后移动端全息 UI 按钮应保持可见');
            await mobPage.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true });
            await mobPage.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            const mobNextAfterLand = await mobPage.evaluate(() => window.__pig3d.holoButton('next'));
            assert.ok(mobNextAfterLand && mobNextAfterLand.x > 400 && mobNextAfterLand.y < 390, '移动端切换横屏后全息 UI 应自动重排且不消失');
            await mobPage.mouse.click(mobNextAfterLand.x, mobNextAfterLand.y);
            await mobPage.waitForFunction(() => document.querySelector('#progressText').textContent === '1 / 176', { timeout: 15000 });
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

        // 8. 验证第 46 关通关弹窗按钮与标题文字区纵向留白分离、可正常点击重开
        await page.goto(`http://127.0.0.1:${port}/?level=46`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__pig3d && window.__pig3d.ready), { timeout: 45000 });
        for (let i = 0; i < 5; i++) {
            const btn = await page.evaluate(() => window.__pig3d.holoButton('next'));
            await page.mouse.click(btn.x, btn.y);
        }
        await page.waitForFunction(() => Boolean(window.__pig3d.holoButton('modal-btn1')), { timeout: 10000 });
        const modalCheck = await page.evaluate(() => ({
            backdrop: window.__pig3d.hasModalBackdrop(),
            bg: window.__pig3d.holoButton('modalBg'),
            b1: window.__pig3d.holoButton('modal-btn1'),
            b2: window.__pig3d.holoButton('modal-btn2')
        }));
        assert.equal(modalCheck.backdrop, true, '胜利弹窗显示时应同步开启全屏暗色遮罩');
        assert.ok(modalCheck.bg && modalCheck.b1 && modalCheck.b2, '胜利弹窗与双按钮应可见');
        assert.ok(modalCheck.b1.y - modalCheck.bg.y >= 36 && Math.abs(modalCheck.b2.x - modalCheck.b1.x) >= 100,
            `弹窗按钮应位于下半区且左右分开 (${JSON.stringify(modalCheck)})`);
        // 点击遮罩空白区不应穿透关闭弹窗或误触底层按钮
        await page.mouse.click(40, 40);
        assert.equal(await page.evaluate(() => window.__pig3d.hasModalBackdrop()), true, '点击结算遮罩空白区不应穿透关闭弹窗');
        await page.mouse.click(modalCheck.b1.x, modalCheck.b1.y);
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '0 / 5', { timeout: 10000 });
        assert.equal(await page.evaluate(() => window.__pig3d.hasModalBackdrop()), false, '重开后结算全屏遮罩应关闭');

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
