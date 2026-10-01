'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const { addCameraMotionRuntime, addCameraMotionDisplay } = require('../3rd/mmd-ar-test/web-camera-motion-inject');
const { addLocalDisplay } = require('../3rd/mmd-ar-test/web-local-assets-inject');

const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const SOURCE_JS = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');
const GENERATED_PAGE = path.join(ROOT, 'index.html');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
    .find((candidate) => candidate && fs.existsSync(candidate));

// 合成仅含相机关键帧的 VMD：骨骼/表情计数为 0，解析器读完相机段即停止，可省略尾部段。
// 相机关键帧固定 61 字节：帧号/distance/位置/旋转/24 字节插值/FOV/1 字节保留。
function cameraVmdBuffer(keys) {
    const header = Buffer.alloc(30);
    header.write('Vocaloid Motion Data 0002', 'latin1');
    const counts = Buffer.alloc(12);
    counts.writeUInt32LE(0, 0);
    counts.writeUInt32LE(0, 4);
    counts.writeUInt32LE(keys.length, 8);
    const frames = keys.map((key) => {
        const frame = Buffer.alloc(61);
        frame.writeUInt32LE(key.frame, 0);
        frame.writeFloatLE(key.distance, 4);
        frame.writeFloatLE(key.position[0], 8);
        frame.writeFloatLE(key.position[1], 12);
        frame.writeFloatLE(key.position[2], 16);
        frame.writeFloatLE(key.rotation[0], 20);
        frame.writeFloatLE(key.rotation[1], 24);
        frame.writeFloatLE(key.rotation[2], 28);
        // 24 字节插值按 6 组 [x1,x2,y1,y2] 写入 MMD 线性控制点，避免全零曲线退化。
        for (let index = 0; index < 6; index += 1) {
            frame[32 + index * 4 + 0] = 20;
            frame[32 + index * 4 + 1] = 107;
            frame[32 + index * 4 + 2] = 20;
            frame[32 + index * 4 + 3] = 107;
        }
        frame.writeUInt32LE(key.fov, 56);
        return frame;
    });
    return Buffer.concat([header, Buffer.alloc(20), counts, ...frames]);
}

const closePose = (actual, expected) => actual.every((value, index) =>
    Math.abs(value - expected[index]) < 1e-3);

test('相机动作注入命中正式源码唯一锚点并生成完整 API', () => {
    const runtimeSource = fs.readFileSync(path.join(SOURCE_JS, 'display-pmx-runtime.js'), 'utf8');
    const displaySource = fs.readFileSync(path.join(SOURCE_JS, 'display-mmd.js'), 'utf8');
    const injectedRuntime = addCameraMotionRuntime(runtimeSource, './web-local-assets.mjs?v=test');
    for (const api of ['loadCameraMotion', 'setCameraMotionPlaybackEnabled', 'getCameraMotionProgress', 'clearCameraMotion']) {
        assert.ok(injectedRuntime.includes(api), api);
    }
    assert.ok(injectedRuntime.includes('if (!advanceCameraMotion(delta)) updateCameraView(delta);'));
    // 源锚点缺失时必须抛出，避免静默生成不完整适配。
    assert.throws(() => addCameraMotionRuntime(
        runtimeSource.replace('    const dispose = () => {', '    const removedDispose = () => {'), './x'),
    /缺少唯一锚点/u);
    // 显示注入依赖本地资源注入产出的入口文本，单独应用必须失败。
    assert.throws(() => addCameraMotionDisplay(displaySource), /缺少唯一锚点/u);
    const injectedDisplay = addCameraMotionDisplay(addLocalDisplay(displaySource));
    for (const api of ['loadSelectedCameraMotion', 'setCameraMotionPlaybackEnabled', 'getCameraMotionProgress', 'clearCameraMotion']) {
        assert.ok(injectedDisplay.includes(api), api);
    }
    if (fs.existsSync(GENERATED_PAGE)) {
        const generatedRuntime = fs.readFileSync(path.join(ROOT, 'js/display-pmx-runtime.js'), 'utf8');
        const generatedDisplay = fs.readFileSync(path.join(ROOT, 'js/display-mmd.js'), 'utf8');
        const generatedPage = fs.readFileSync(GENERATED_PAGE, 'utf8');
        assert.ok(generatedRuntime.includes('loadCameraMotion,'));
        assert.ok(generatedDisplay.includes('loadSelectedCameraMotion'));
        for (const id of ['mmdArCameraMotionPlayback', 'mmdArCameraMotionProgress', 'mmdArCameraMotionTime',
            'mmdArLocalCameraVmdButton', 'mmdArLocalCameraVmd', 'mmdArLocalCameraMotionName']) {
            assert.ok(generatedPage.includes(id), id);
        }
    }
});

test('真实网页选择相机 VMD 后预览相机循环播放，开关/定位暂停/恢复默认可用', {
    skip: !CHROME || !fs.existsSync(GENERATED_PAGE), timeout: 900000
}, async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd-resources.json'), 'utf8'));
    // 内置角色动作 VMD 不含相机关键帧，用于验证明确报错。
    const motionVmdPath = path.resolve(ROOT, manifest.resources[0].motionUrl);
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
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
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-ar-camera-test-'));
    const cameraVmdPath = path.join(temporary, 'camera.vmd');
    // 两秒镜头：机位从中心左侧移到右侧，FOV 30 → 36，便于观察位姿和投影都发生变化。
    fs.writeFileSync(cameraVmdPath, cameraVmdBuffer([
        { frame: 0, distance: 30, position: [0, 10, 0], rotation: [0, 0, 0], fov: 30 },
        { frame: 60, distance: 30, position: [10, 10, 0], rotation: [0, -0.5, 0], fov: 36 }
    ]));
    const errors = [];
    try {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false');
            localStorage.removeItem('aasc.mmdArTest.cameraMotionPlayback.v1');
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/deep/mmd-ar/`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DisplayMmd?.setLighting);
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false, keyShadowEnabled: false }));
        await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        // 测试页固定 MmdArTestAframeMode=true，可直接读取预览相机状态。
        assert.equal(await page.$eval('#mmdArCameraMotionPlayback', (node) => node.checked), true);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress()), null);

        const readCamera = () => page.evaluate(() => window.DisplayMmd.getArCameraState()?.cameraPosition ?? null);
        const readProjection = () => page.evaluate(() => window.MmdArTestCameraProjection());
        const previewPose = await readCamera();
        const previewProjection = await readProjection();
        assert.ok(Array.isArray(previewPose) && previewPose.every(Number.isFinite));

        const upload = async (files) => {
            const input = await page.$('#mmdArLocalCameraVmd');
            await input.evaluate((element) => { element.value = ''; });
            await input.uploadFile(...files);
            await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        };
        await page.click('#mmdArMotionToggle');
        // 角色动作随默认模型播放；相机动作在没有选择文件前显示未知。
        assert.equal(await page.$eval('#mmdArCameraMotionTime', (node) => node.textContent), '--:-- / --:--');
        assert.equal(await page.$eval('#mmdArCameraMotionProgress', (node) => node.value), 0);
        await page.click('#mmdArLocalAssets .mmd-ar-panel-group-toggle');
        await upload([cameraVmdPath]);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'false');
        assert.equal(await page.$eval('#mmdArLocalCameraMotionName', (element) => element.textContent), 'camera.vmd');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress().durationSeconds), 2);

        // 循环播放：预览相机与投影由相机 VMD 驱动并随时间变化。
        // 软件光栅下渲染帧很稀疏且每帧最多推进 0.1s，等待必须按渲染帧而不是墙钟时间。
        const waitFrames = (count) => page.evaluate((target) => new Promise((resolve) => {
            let seen = 0;
            const step = () => {
                seen += 1;
                if (seen >= target) resolve();
                else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }), count);
        await page.waitForFunction(() => window.DisplayMmd.getCameraMotionProgress()?.timeSeconds > 0.1, { timeout: 60000 });
        const poseA = await readCamera();
        const timeA = await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress().timeSeconds);
        await page.waitForFunction((from) => window.DisplayMmd.getCameraMotionProgress().timeSeconds > from + 0.15,
            { timeout: 60000 }, timeA);
        const poseB = await readCamera();
        assert.notDeepEqual(poseA, poseB);
        assert.notDeepEqual(await readProjection(), previewProjection);

        // 关闭开关：停止推进并回到原来的预览视角（含 FOV 与裁剪面恢复）。
        await page.click('#mmdArCameraMotionPlayback');
        assert.equal(await page.evaluate(() => localStorage.getItem('aasc.mmdArTest.cameraMotionPlayback.v1')), 'false');
        await waitFrames(2);
        const pausedAt = await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress().timeSeconds);
        await waitFrames(2);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress().timeSeconds), pausedAt);
        assert.ok(closePose(await readCamera(), previewPose));
        assert.ok(closePose(await readProjection(), previewProjection));

        // 再开启：从暂停时刻继续推进。
        await page.click('#mmdArCameraMotionPlayback');
        await page.waitForFunction((from) => window.DisplayMmd.getCameraMotionProgress().timeSeconds > from + 0.05,
            { timeout: 60000 }, pausedAt);

        // 不含相机关键帧的角色动作 VMD：明确报错且保留已加载的相机动作。
        await upload([motionVmdPath]);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'true');
        assert.match(await page.$eval('#mmdArLocalMessage', (element) => element.textContent), /相机关键帧/u);
        assert.equal(await page.$eval('#mmdArLocalCameraMotionName', (element) => element.textContent), 'camera.vmd');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress().durationSeconds), 2);

        // 开启定位后相机由 MindAR 接管：相机动作暂停；退出定位后从暂停处继续。
        const arPose = await page.evaluate(() => {
            const projectionMatrix = window.MmdArTestCameraProjection();
            const anchorMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
            const applied = window.DisplayMmd.setArCameraPose({ anchorMatrix, projectionMatrix, targetAspect: 1 });
            return { applied, active: window.DisplayMmd.getArCameraState()?.active === true };
        });
        assert.equal(arPose.applied, true);
        assert.equal(arPose.active, true);
        await waitFrames(2);
        const arBefore = await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress()?.timeSeconds);
        await waitFrames(2);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress()?.timeSeconds), arBefore);
        assert.equal(await page.evaluate(() => {
            window.DisplayMmd.resetArCameraPose();
            return window.DisplayMmd.getArCameraState()?.active === true;
        }), false);
        await page.waitForFunction((from) => window.DisplayMmd.getCameraMotionProgress().timeSeconds > from + 0.05,
            { timeout: 60000 }, arBefore);

        // 恢复默认模型与动作：同时清除相机动作并复位预览。
        await page.click('#mmdArLocalDefaultModel');
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal(await page.$eval('#mmdArLocalCameraMotionName', (element) => element.textContent), '无相机动作');
        assert.equal(await page.evaluate(() => window.DisplayMmd.getCameraMotionProgress()), null);
        assert.ok(closePose(await readCamera(), previewPose));
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
