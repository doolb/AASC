'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = process.env.AASC_MMD_TEST_WEB_ROOT || path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = '/usr/bin/chromium';

test('真实米娅默认待机、动态服务器动作、原时长/本地优先与物理开关刷新/后端重建', {
    skip: !fs.existsSync(CHROME) || !fs.existsSync(path.join(ROOT, 'index.html')), timeout: 300000
}, async () => {
    const errors = [], timing = [];
    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-mmd-source-download-'));
    let sourceDelay = 0;
    const server = http.createServer(async (request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/mmd-actions.json') {
            const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd-actions.json')));
            catalog.actions.push({ id: 'future', name: '新动作', type: 'vmd', url: './mmd/motions/miya-default.vmd' });
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(catalog)); return;
        }
        const file = path.resolve(ROOT, pathname.slice(1) || 'index.html');
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
        response.setHeader('Content-Type', /\.m?js$/u.test(file) ? 'text/javascript' : /\.html$/u.test(file) ? 'text/html'
            : /\.css$/u.test(file) ? 'text/css' : /\.json$/u.test(file) ? 'application/json' : 'application/octet-stream');
        if (sourceDelay && pathname.endsWith('/miya-idle.mpl')) await new Promise(resolve => setTimeout(resolve, sourceDelay));
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        // 本机/tmp也是容量受限的tmpfs；让浏览器使用有余量的/dev/shm，避免重载时资源不足。
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            ignoreDefaultArgs: ['--disable-dev-shm-usage'],
            args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 540, height: 800 });
        await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
        page.on('pageerror', error => { errors.push(error.message); console.log('页面错误：', error.message); });
        page.on('console', message => {
            if (message.type() === 'error' || (message.type() === 'warn' && message.text().includes('[MMD]'))) {
                console.log('浏览器诊断：', message.text());
            }
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        const ready = async () => {
            await page.waitForFunction(() => window.DisplayMmd?.setLighting);
            await page.evaluate(() => window.DisplayMmd.setLighting({ pmxAoEnabled: false, keyShadowEnabled: false }));
            try { await page.waitForFunction(() => window.DisplayMmd?.getHumanInterface?.()?.getState().ready, { timeout: 90000 }); }
            catch (error) {
                console.log('初始化诊断：', await page.evaluate(() => ({ display: window.DisplayMmd?.getState(),
                    humanReady: window.DisplayMmd?.getHumanInterface?.()?.getState().ready,
                    arm: window.DisplayMmd?.getHumanInterface?.()?.getArmAvoidanceState(), text: document.body.innerText.slice(-500) })));
                throw error;
            }
            // Human绑定可能早于基础VMD加载完成；等模型可见后再验证默认姿态并截图。
            await page.waitForFunction(() => window.DisplayMmd.getState().modelReady && window.DisplayMmd.getState().visible, { timeout: 90000 });
        };
        await ready();
        assert.match(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), /miya-idle\.vmd$/u);
        await page.waitForFunction(() => document.querySelectorAll('[data-server-actions] [data-advanced]').length === 3);
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().enabled), true);
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().available);
        timing.push(await page.evaluate(async () => {
            const values = [];
            for (let i = 0; i < 12; i++) { await new Promise(requestAnimationFrame); values.push(window.DisplayMmd.getHumanInterface().getArmAvoidanceState().frameMs); }
            values.sort((a, b) => a - b);
            return { ...window.DisplayMmd.getHumanInterface().getArmAvoidanceState(), medianMs: values[6], maxMs: values[11] };
        }));
        const idleScreenshot = await page.screenshot({ path: path.join(os.tmpdir(), 'aasc-mmd-idle-avoidance.png') });
        const modelPixels = await page.evaluate(async base64 => {
            // 对真实浏览器截图采样中央模型区域，不能把仅有模型ready状态的空白画面算作通过。
            const picture = new Image();
            await new Promise((resolve, reject) => { picture.onload = resolve; picture.onerror = reject;
                picture.src = 'data:image/png;base64,' + base64; });
            const canvas = document.createElement('canvas'); canvas.width = picture.width; canvas.height = picture.height;
            const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0);
            const pixels = context.getImageData(90, 150, 360, 550).data; let count = 0;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 400) count++;
            return count;
        }, Buffer.from(idleScreenshot).toString('base64'));
        assert.ok(modelPixels > 3000, '模型实际截图缺少可见像素：' + modelPixels);
        assert.equal(await page.$$eval('[data-builtin-actions] [data-advanced]', buttons => buttons.length), 28);
        assert.equal(await page.$$eval('[data-builtin-actions] button', buttons => buttons.length), 28);
        assert.equal(await page.$$eval('[data-server-actions] button', buttons => buttons.length), 3);
        assert.equal(await page.$$eval('#mmdArAdvancedMotionPanel [data-advanced-source]', buttons => buttons.length), 0);
        const catalogSymbols = await page.evaluate(() => window.MmdArReplyPreview.parse('❤️🐾🐈‍⬛🫶🏽😊🤷🏾‍♀️'));
        assert.equal(catalogSymbols.speech, '');
        assert.deepEqual(catalogSymbols.events.map(event => event.name), ['比心', '猫爪', '猫咪撒娇', '比心', '开心', '摊手']);
        await page.evaluate(() => {
            window.__emojiOriginalMpl = window.MmdArMplPlayback; window.__emojiRuns = [];
            // 仍调用真实Human/Worker，只观察自动按钮实际编译结果，随后与编辑器预览逐字节比较。
            window.MmdArMplPlayback = Object.freeze({ ...window.__emojiOriginalMpl, async perform(event, owner) {
                const result = await window.__emojiOriginalMpl.perform(event, owner);
                window.__emojiRuns.push({ name: event.name, buffer: result.buffer, warnings: result.warnings });
                return result;
            } });
            for (const [key, value] of [['duration', 2.4], ['strength', 0.4], ['count', 2]]) {
                document.querySelector('#mmdArAdvancedMotionPanel [data-' + key + ']').value = value;
            }
        });
        for (const [index, name] of ['比心', '猫爪', '猫咪撒娇', '晚安', '开心', '赞同'].entries()) {
            // 使用真实折叠控件与滚动容器，分别验收编辑器折叠/展开时不导航、不抢焦点。
            const beforeNavigation = await page.evaluate(async ({ name, collapsed }) => {
                const motionToggle = document.getElementById('mmdArMotionToggle');
                if (motionToggle.getAttribute('aria-expanded') !== 'true') motionToggle.click();
                const advanced = document.getElementById('mmdArAdvancedMotionPanel');
                if (advanced.closest('.mmd-ar-panel-group-body').hidden) advanced.closest('.mmd-ar-panel-group').querySelector('.mmd-ar-panel-group-toggle').click();
                const mpl = document.getElementById('mmdArMplPanel');
                if (mpl.closest('.mmd-ar-panel-group-body').hidden !== collapsed) mpl.closest('.mmd-ar-panel-group').querySelector('.mmd-ar-panel-group-toggle').click();
                const button = advanced.querySelector('[data-advanced="' + name + '"]');
                button.scrollIntoView({ block: 'center' }); button.focus({ preventScroll: true });
                await new Promise(requestAnimationFrame);
                window.__mplNavigationNodes = [];
                for (let node = button.parentElement; node; node = node.parentElement) window.__mplNavigationNodes.push(node);
                const positions = window.__mplNavigationNodes.map(node => [node.scrollLeft, node.scrollTop]);
                button.click();
                return { collapsed, positions };
            }, { name, collapsed: index < 3 });
            await page.waitForFunction(name => window.__emojiRuns.some(run => run.name === name), { timeout: 30000 }, name);
            await page.waitForFunction(name => document.getElementById('mmdArMplSource').value === window.DisplayMmd.getHumanInterface().mpl.advancedSource({ name, duration: 2.4, strength: 0.4, count: 2 }), {}, name);
            const afterNavigation = await page.evaluate(() => ({
                collapsed: document.getElementById('mmdArMplPanel').closest('.mmd-ar-panel-group-body').hidden,
                focusedAction: document.activeElement?.dataset.advanced,
                positions: window.__mplNavigationNodes.map(node => [node.scrollLeft, node.scrollTop])
            }));
            assert.equal(afterNavigation.collapsed, beforeNavigation.collapsed, name + '改变了MPL分类折叠状态');
            assert.equal(afterNavigation.focusedAction, name, name + '填入源码抢走动作按钮焦点');
            for (let i = 0; i < beforeNavigation.positions.length; i++) {
                assert.ok(afterNavigation.positions[i].every((value, axis) => Math.abs(value - beforeNavigation.positions[i][axis]) <= 1), name + '填入源码改变了滚动位置');
            }
            const comparison = await page.evaluate(async name => {
                const source = document.getElementById('mmdArMplSource').value;
                const human = window.DisplayMmd.getHumanInterface();
                const exactSource = source === human.mpl.advancedSource({ name, duration: 2.4, strength: 0.4, count: 2 });
                const actual = window.__emojiRuns.find(run => run.name === name);
                const preview = await window.MmdArMplPlayback.play(source, 'browser:emoji-source', true);
                const before = new Uint8Array(actual.buffer), after = new Uint8Array(preview.buffer);
                const identical = before.length > 0 && before.length === after.length && before.every((byte, index) => byte === after[index]);
                await window.MmdArMplPlayback.stop(); await window.MmdArReplyPreview.stop();
                return { exactSource, identical, bytes: before.length, warnings: actual.warnings };
            }, name);
            assert.ok(comparison.exactSource && comparison.identical, name + '实际播放与编辑预览不一致');
            console.log('Emoji自动源码与真实Worker一致：', name, JSON.stringify(comparison));
        }
        // 延迟服务器源码期间快切、输入和停止，都必须保留较新的编辑状态。
        sourceDelay = 450;
        await page.evaluate(() => {
            document.querySelector('[data-advanced="待机"]').click();
            document.querySelector('[data-advanced="猫爪"]').click();
        });
        await page.waitForFunction(() => document.getElementById('mmdArMplSource').value.includes('elbow_l bend forward 48;'));
        await new Promise(resolve => setTimeout(resolve, 750));
        assert.match(await page.$eval('#mmdArMplSource', element => element.value), /elbow_l bend forward 48;/u);
        await page.evaluate(() => {
            document.querySelector('[data-advanced="待机"]').click();
            const input = document.getElementById('mmdArMplSource'); input.value = '自动请求期间的用户编辑'; input.dispatchEvent(new Event('input'));
        });
        await new Promise(resolve => setTimeout(resolve, 750));
        assert.equal(await page.$eval('#mmdArMplSource', element => element.value), '自动请求期间的用户编辑');
        await page.evaluate(() => {
            document.querySelector('[data-advanced="待机"]').click();
            document.querySelector('[data-advanced-stop]').click();
        });
        await new Promise(resolve => setTimeout(resolve, 750));
        assert.equal(await page.$eval('#mmdArMplSource', element => element.value), '自动请求期间的用户编辑');
        sourceDelay = 0;
        await page.evaluate(() => {
            window.MmdArMplPlayback = window.__emojiOriginalMpl;
            for (const key of ['duration', 'strength', 'count']) document.querySelector('#mmdArAdvancedMotionPanel [data-' + key + ']').value = '';
        });
        const libraryBeforeEditing = await page.evaluate(() => JSON.stringify(window.DisplayMmd.getHumanInterface().learn.list()));
        await page.waitForFunction(() => window.MmdArMplPlayback?.editSource);
        for (const name of ['点头', '摇头', '挥手', '鞠躬', '歪头']) {
            await page.evaluate(name => document.querySelector('[data-advanced="' + name + '"]').click(), name);
            await page.waitForFunction(name => document.getElementById('mmdArMplSource').value === window.DisplayMmd.getHumanInterface().mpl.advancedSource({ name }), {}, name);
            assert.match(await page.$eval('#mmdArMplSource', element => element.value), /@animation gesture/u);
            await page.evaluate(() => window.MmdArReplyPreview.stop());
        }
        await page.evaluate(() => {
            document.querySelector('[data-advanced="待机"]').click();
            const input = document.getElementById('mmdArMplSource'); input.value = '用户正在编辑'; input.dispatchEvent(new Event('input'));
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.equal(await page.$eval('#mmdArMplSource', element => element.value), '用户正在编辑', '迟到源码不能覆盖用户输入');
        await page.evaluate(() => document.querySelector('[data-advanced="待机"]').click());
        const expectedIdleSource = fs.readFileSync(path.join(ROOT, 'mmd/motions/miya-idle.mpl'), 'utf8');
        await page.waitForFunction(source => document.getElementById('mmdArMplSource').value === source, {}, expectedIdleSource);
        const idleSource = await page.$eval('#mmdArMplSource', element => element.value);
        assert.equal(idleSource, expectedIdleSource);
        assert.match(idleSource, /wrist_l bend forward -10/u);
        // 源码已填入，用户手动打开编辑器后仍可预览和下载。
        await page.evaluate(() => {
            const panel = document.getElementById('mmdArMplPanel');
            if (panel.closest('.mmd-ar-panel-group-body').hidden) panel.closest('.mmd-ar-panel-group').querySelector('.mmd-ar-panel-group-toggle').click();
        });
        assert.equal(await page.$eval('#mmdArMplPanel', element => element.closest('.mmd-ar-panel-group-body').hidden), false);
        await page.evaluate(() => document.querySelector('[data-advanced="跳舞"]').click());
        await page.waitForFunction(() => document.querySelector('#mmdArAdvancedMotionPanel [role="status"]').textContent.includes('暂无MPL源码'));
        assert.equal(await page.$eval('#mmdArMplSource', element => element.value), idleSource);
        await page.evaluate(() => document.querySelector('[data-mpl="download-source"]').click());
        const downloadDeadline = Date.now() + 10000;
        while (!fs.existsSync(path.join(downloads, '待机.mpl')) && Date.now() < downloadDeadline) await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(fs.readFileSync(path.join(downloads, '待机.mpl'), 'utf8'), idleSource);
        await page.evaluate(() => window.MmdArReplyPreview.stop());
        await page.evaluate(source => window.MmdArMplPlayback.play(source, 'browser:source', true), idleSource);
        await page.evaluate(() => window.MmdArMplPlayback.stop());
        assert.equal(await page.evaluate(() => JSON.stringify(window.DisplayMmd.getHumanInterface().learn.list())), libraryBeforeEditing);
        assert.match(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), /miya-idle\.vmd$/u);
        assert.equal(await page.$eval('#mmdArMplPanel', element => !!element.querySelector('[data-mpl="register"]')), false);
        await page.evaluate(() => {
            const input = document.getElementById('mmdArMplSource'); input.value += '\n'; input.dispatchEvent(new Event('input'));
        });
        await page.waitForFunction(() => document.querySelector('[data-mpl="save"]').disabled);
        // 关闭面板再观察真实风吹，避免大文本面板遮挡模型。
        await page.evaluate(() => { const button = document.getElementById('mmdArMotionToggle'); if (button.getAttribute('aria-expanded') === 'true') button.click(); });
        const wind = await page.evaluate(async () => {
            const saved = window.DisplayMmd.getWindSettings(), values = [];
            try {
                for (const longitude of [-90, 90]) {
                    window.DisplayMmd.setWindSettings({ enabled: true, strength: 6, longitude, latitude: -65, gust: 75 });
                    // 软件GPU的帧率可能很低；以时间预算采样，记录实际帧数，避免120帧占满整个用例。
                    const deadline = performance.now() + 3000;
                    for (let i = 0; i < 60 && performance.now() < deadline; i++) {
                        await new Promise(requestAnimationFrame);
                        values.push(window.DisplayMmd.getHumanInterface().getArmAvoidanceState());
                    }
                }
            } finally { window.DisplayMmd.setWindSettings(saved); }
            return values;
        });
        assert.ok(wind.length >= 2, '双方向风吹需要实际采样');
        for (const sample of wind) {
            assert.ok(Number.isFinite(sample.penetration) && Number.isFinite(sample.stepDegrees));
            assert.ok(sample.correctionDegrees <= 35.0001); assert.ok(sample.stepDegrees <= 10.5001);
            assert.ok(sample.iterations <= 4);
            assert.ok(sample.returnAttempts <= 2 && sample.returning <= 2);
        }
        console.log('真实风吹采样：', JSON.stringify({ frames: wind.length,
            contactFrames: wind.filter(value => value.contacts > 0).length,
            maxCorrection: Math.max(...wind.map(value => value.correctionDegrees)),
            maxStep: Math.max(...wind.map(value => value.stepDegrees)),
            maxPenetration: Math.max(...wind.map(value => value.penetration)),
            returnAttemptFrames: wind.filter(value => value.returnAttempts > 0).length,
            returningFrames: wind.filter(value => value.returning > 0).length }));
        const dance = await page.evaluate(async () => {
            const human = window.DisplayMmd.getHumanInterface();
            const result = await human.perform({ action: '跳舞', owner: 'browser:dance' });
            const future = await human.perform({ action: '新动作', owner: 'browser:future', duration: 1.5, count: 2 });
            human.stop('browser:future'); human.stop('browser:dance'); return { duration: result.duration, repeated: future.duration };
        });
        assert.ok(Math.abs(dance.duration - 15.2) < 1e-5); assert.equal(dance.repeated, 3);
        const local = await page.evaluate(async () => {
            const human = window.DisplayMmd.getHumanInterface();
            await human.learn.register({ actionId: '跳舞', vmd: './mmd/motions/miya-idle.vmd', duration: 1.3 });
            const result = await human.perform({ action: '跳舞', owner: 'browser:local' }); human.stop('browser:local');
            return result.duration;
        });
        assert.equal(local, 1.3);
        const wave = await page.evaluate(async () => window.DisplayMmd.getHumanInterface().perform({ action: '挥手', duration: 2, strength: 1, owner: 'browser:wave' }));
        assert.equal(wave.duration, 2);
        await page.waitForFunction(id => window.DisplayMmd.getHumanInterface().getRequest(id).time > 0.5, {}, wave.id);
        timing.push(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState()));
        await page.screenshot({ path: path.join(os.tmpdir(), 'aasc-mmd-wave-avoidance.png') });
        await page.evaluate(() => {
            const input = document.getElementById('mmdArHandAvoidance'); input.checked = false;
            input.dispatchEvent(new Event('change', { bubbles: true })); window.DisplayMmd.getHumanInterface().stop();
        });
        assert.equal(await page.evaluate(() => localStorage.getItem('aasc.mmdArTest.handAvoidance.v1')), 'false');
        assert.equal(await page.evaluate(() => document.getElementById('mmdArHandAvoidance').closest('.mmd-ar-panel-group').querySelector('[data-group-title]').dataset.groupTitle), '物理');
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().enabled), false);
        assert.match(await page.evaluate(() => window.DisplayMmd.getModelProfile().motionUrl), /miya-idle\.vmd$/u);
        assert.equal(await page.evaluate(async () => window.DisplayMmd.setPhysicsSolver('xpbd')), true); await ready();
        assert.equal(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().enabled), false);
        await page.evaluate(() => window.DisplayMmd.getHumanInterface().setArmAvoidanceEnabled(true));
        await page.waitForFunction(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState().available);
        timing.push(await page.evaluate(() => window.DisplayMmd.getHumanInterface().getArmAvoidanceState()));
        assert.deepEqual(errors, []); console.log('避让运行状态：', JSON.stringify(timing));
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
