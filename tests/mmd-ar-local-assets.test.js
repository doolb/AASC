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
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 240000
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
        await page.evaluateOnNewDocument(() => localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false'));
        await page.goto(`http://127.0.0.1:${server.address().port}/deep/mmd-ar/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false, keyShadowEnabled: false }));
        await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        await page.click('#mmdArMotionToggle');
        assert.deepEqual(errors, []);
        assert.equal(await page.$eval('#mmdArMotionPanel', (element) => element.hidden), false);
        await page.click('#mmdArLocalAssets .mmd-ar-panel-group-toggle');
        const upload = async (selector, files) => {
            const input = await page.$(selector);
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
        };
        await upload('#mmdArLocalFiles', [pmxPath, ...textures]);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'false');
        assert.match(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), /__local__/u);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getMotionProgress()), null);
        const currentUrl = await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl);
        await upload('#mmdArLocalVmd', [vmdPath]);
        assert.equal(await page.$eval('#mmdArLocalMessage', (element) => element.dataset.error), 'false');
        assert.ok(await page.evaluate(() => window.DisplayMmd.getMotionProgress().durationSeconds > 0));
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
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl.includes('__local__')), true);
        await page.evaluate(async () => {
            if (!await window.DisplayMmd.setPhysicsEnabled(false)) throw new Error('物理重载失败');
            if (!await window.DisplayMmd.setPhysicsEnabled(true)) throw new Error('物理重载失败');
        });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), currentUrl);
        assert.ok(await page.evaluate(() => window.DisplayMmd.getMotionProgress().durationSeconds > 0));
        await page.click('#mmdArLocalDefaultMotion');
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl), currentUrl);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl.includes('__local__')), false);
        await page.click('#mmdArLocalDefaultModel');
        await page.waitForFunction(() => !document.getElementById('mmdArLocalFilesButton').disabled, { timeout: 90000 });
        assert.equal(await page.evaluate(() => window.DisplayMmd.getModelProfile().modelUrl.includes('__local__')), false);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getState().modelReady), true);
        assert.deepEqual(errors, []);
        assert.equal(requests.some((url) => url.includes('__local__')), false, '本地资源不能回退到 HTTP 请求');
    } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
        // 只清理本测试创建的损坏 VMD 临时文件。
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
