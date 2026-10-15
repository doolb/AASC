'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = process.env.AASC_MMD_TEST_WEB_ROOT || path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const IMAGE = process.env.AASC_MMD_POSE_TEST_IMAGE || path.resolve(__dirname, '../3rd/mmd-ar-test/model-cache/pose-onnx/reference-person.jpg');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };

test('全身IK唯一图片入口：真ONNX本地识别、预览、自动启用VaM并应用，取消/无人不改骨骼', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(IMAGE) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 240000
}, async t => {
    const requests = [], errors = [];
    const server = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 540, height: 800 });
        await page.evaluateOnNewDocument(() => {
            // 只观察真实Worker结果，不替换推理内容或增加生产测试接口。
            const NativeWorker = window.Worker;
            window.Worker = class extends NativeWorker {
                constructor(url, options) {
                    super(url, options);
                    if (String(url).includes('web-human-pose-worker.mjs')) this.addEventListener('message', ({ data }) => {
                        if (data.type === 'result') window.__observedImagePose = data.result;
                    });
                }
            };
        });
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.getHumanInterface?.()?.getState().ready, { timeout: 180000 });
        await page.evaluate(async () => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            const api = window.DisplayMmd.getHumanInterface();
            await api.physiology.set({ breathing: false, blinking: false }); await api.gaze.set({ head: false, eyes: false });
            const groups = window.MmdArLightingPresetGroups;
            groups.lighting.apply({ ...groups.lighting.read(), pmxAoEnabled: false, shadowSource: 'none', keyShadowEnabled: false });
            groups.screenLighting.apply({ ...groups.screenLighting.read(), giEnabled: false, contactEnabled: false });
            groups.render.apply({ ...groups.render.read(), aaMode: 'taa', taaEnabled: false, canvasScale: 0.25 });
        });
        await page.waitForSelector('[data-pose-panel]');
        assert.equal(await page.$$eval('[data-pose-panel]', elements => elements.length), 1);
        assert.equal(await page.$eval('[data-pose-panel]', element => element.closest('section').id), 'mmdArIKPanel');
        assert.deepEqual(await page.$$eval('[data-body="mode"] option', elements => elements.map(element => element.value)), ['physics']);
        assert.ok(!requests.some(request => request.url.includes('/vendor/pose/')), '图片识别资源不应首屏加载');
        await page.click('#mmdArIKToggle');
        await page.$eval('[data-pose-panel]', element => { element.open = true; });
        await (await page.$('[data-pose="file"]')).uploadFile(IMAGE);
        await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
        await page.click('[data-pose="recognize"]');
        await page.waitForFunction(() => !document.querySelector('[data-pose="apply"]').disabled || /失败|未识别|无效|不匹配/u.test(document.querySelector('[data-pose="status"]').textContent), { timeout: 120000 });
        const recognized = await page.$eval('[data-pose="status"]', element => element.textContent);
        assert.match(recognized, /识别完成/u, recognized);
        assert.ok(Number(recognized.match(/(\d+)\/33/u)[1]) >= 20, recognized);
        const points = await page.evaluate(() => window.__observedImagePose.landmarks);
        // 固定公开参考图：面向镜头、双臂水平，人物左腕在画面右侧，右膝在画面左侧。
        assert.ok(points[15].x > 0.65 && points[16].x < 0.35, '真实图片左右腕映射不符');
        assert.ok(points[26].x < 0.45, '真实图片右膝映射不符');
        assert.ok(points[15].world[0] > points[16].world[0], '估计3D左右语义反转');
        await page.click('[data-pose="apply"]');
        await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('已应用'), { timeout: 20000 });
        const applied = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
        assert.equal(applied.mode, 'physics'); assert.equal(applied.enabled, true); assert.ok(applied.activeTargets >= 9);
        assert.ok(applied.controls.every(control => [...control.target, ...control.rotation].every(Number.isFinite)));
        await page.evaluate(async () => {
            let steps = 0;
            while (steps < 270) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                const state = window.DisplayMmd.getHumanInterface().getInteractiveIKState();
                if (!state.available || !state.physics) throw new Error(state.reason || '图片姿态应用后物理停止');
                if (!state.controls.every(control => control.achieved.every(Number.isFinite))) throw new Error('图片姿态应用后骨骼无效');
                steps += state.physics.substeps;
            }
        });
        if (process.env.AASC_MMD_POSE_SCREENSHOT) await page.screenshot({ path: process.env.AASC_MMD_POSE_SCREENSHOT });
        const before = applied.controls.map(({ key, target, positionState }) => ({ key, target, positionState }));
        // 同一浏览器任务内点击，避免快速推理已结束后才送达第二个自动化指针事件。
        await page.evaluate(() => {
            document.querySelector('[data-pose="recognize"]').click();
            document.querySelector('[data-pose="cancel"]').click();
        });
        assert.match(await page.$eval('[data-pose="status"]', element => element.textContent), /取消/u);
        assert.equal(await page.$eval('[data-pose="apply"]', element => element.disabled), true);
        // 无人照片通过真实Worker再次运行，不能把背景或零点应用到身体。
        await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
            const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), value => value.charCodeAt(0));
            const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'blank.png', { type: 'image/png' }));
            const input = document.querySelector('[data-pose="file"]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
        await page.click('[data-pose="recognize"]');
        await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled, { timeout: 90000 });
        assert.match(await page.$eval('[data-pose="status"]', element => element.textContent), /未识别/u);
        const after = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(({ key, target, positionState }) => ({ key, target, positionState })));
        assert.deepEqual(after, before);
        // 用户图片只从本机环境变量指定的位置读取，不放入仓库或发送到外部服务。
        if (process.env.AASC_MMD_POSE_ANIME_IMAGE) {
            assert.ok(fs.existsSync(process.env.AASC_MMD_POSE_ANIME_IMAGE));
            await (await page.$('[data-pose="file"]')).uploadFile(process.env.AASC_MMD_POSE_ANIME_IMAGE);
            await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
            await page.click('[data-pose="recognize"]');
            await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled, { timeout: 90000 });
            const anime = await page.evaluate(() => window.__observedImagePose);
            assert.ok(anime.candidates.length >= 2 && anime.candidates.length <= 3, '女孩和小猪应成为独立候选且不超过预算');
            assert.ok(anime.landmarks[0].x * 450 > 190 && anime.landmarks[0].x * 450 < 240
                && anime.landmarks[0].y * 407 > 85 && anime.landmarks[0].y * 407 < 140, '默认鼻点未回到女孩脸上');
            assert.ok(anime.landmarks[11].y < .5 && anime.landmarks[12].y < .5, '默认肩点仍在裙摆');
            assert.equal(await page.$eval('[data-pose="candidate-row"]', element => element.hidden), false);
            assert.equal(await page.$$eval('[data-pose="candidate"] option', elements => elements.length), anime.candidates.length);
            const pig = anime.candidates.findIndex(candidate => candidate.landmarks[0].y > .6 && candidate.landmarks[0].x < .4);
            assert.ok(pig > 0, '误检小猪候选应保留以便比较');
            const preview = await page.$eval('[data-pose="preview"]', canvas => canvas.toDataURL());
            await page.select('[data-pose="candidate"]', String(pig));
            assert.match(await page.$eval('[data-pose="status"]', element => element.textContent), new RegExp(`候选${pig + 1}`));
            assert.notEqual(await page.$eval('[data-pose="preview"]', canvas => canvas.toDataURL()), preview, '切换候选没有重画预览');
            const switched = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(({ key, target, positionState }) => ({ key, target, positionState })));
            assert.deepEqual(switched, before, '切换预览不应立即改变身体目标');
            await page.select('[data-pose="candidate"]', '0');
            assert.match(await page.$eval('[data-pose="status"]', element => element.textContent), /低可信/u);
            await page.click('[data-pose="apply"]');
            await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('已应用'), { timeout: 20000 });
            const animeApplied = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
            assert.ok(animeApplied.activeTargets >= 6 && animeApplied.controls.every(control => control.target.every(Number.isFinite)));
            if (process.env.AASC_MMD_POSE_ANIME_SCREENSHOT) await page.screenshot({ path: process.env.AASC_MMD_POSE_ANIME_SCREENSHOT });
            t.diagnostic(`二次元图：${anime.candidates.length}候选，默认鼻点[${(anime.landmarks[0].x * 450).toFixed(1)},${(anime.landmarks[0].y * 407).toFixed(1)}]，身体${anime.quality.visible}/12；切换保持旧目标，应用${animeApplied.activeTargets}目标`);
        }
        assert.ok(requests.filter(request => request.url.includes('/vendor/pose/')).length >= 5);
        assert.ok(requests.every(request => request.method === 'GET'), '图片不应以POST或其他写请求上传');
        assert.deepEqual(errors, []);
        t.diagnostic(recognized + `；应用${applied.activeTargets}个目标；取消与无人图保持旧目标`);
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
