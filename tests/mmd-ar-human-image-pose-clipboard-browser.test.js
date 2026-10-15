'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('全身IK图片粘贴：真实DOM/解码、剪贴板、作用域、权限与过期保护', {
    skip: !fs.existsSync(CHROME), timeout: 90000
}, async t => {
    const requests = [], errors = [];
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body></body></html>'); return; }
        const file = path.resolve(ROOT, '.' + pathname);
        if (!file.startsWith(ROOT + path.sep) || !file.endsWith('.mjs') || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(file).pipe(res);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
        const origin = `http://127.0.0.1:${server.address().port}`;
        await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-sanitized-write']);
        const page = await browser.newPage();
        page.setDefaultTimeout(3000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => requests.push(request.url()));
        await page.goto(origin);
        await page.evaluate(async () => {
            const { installImagePose } = await import('/web-human-pose-ui.mjs');
            const clipboard = navigator.clipboard, bitmap = window.createImageBitmap;
            // 使用真实浏览器DOM/图片解码；Human边界仅记录是否被自动启用/应用，不替换被测UI。
            window.poseFixture = {
                async file(color = 'blue', width = 32, height = 16) {
                    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
                    return new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], color + '.png', { type: 'image/png' });
                },
                mount() {
                    this.ui?.dispose(); window.createImageBitmap = bitmap;
                    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
                    document.body.innerHTML = '<section id="panel"><p data-ik-message></p></section><input id="outside">';
                    this.effects = 0;
                    this.panel = document.getElementById('panel');
                    this.ui = installImagePose(this.panel, { human: () => ({ getState: () => ({ ready: true, token: 'model-a' }),
                        applyInteractiveImagePose: () => { this.effects++; return { activeTargets: 0 }; } }),
                        ensurePhysics: async () => { this.effects++; } });
                    this.root = this.panel.querySelector('[data-pose-panel]'); this.root.open = true; this.ui.sync(true);
                },
                paste(file, target = document.body) {
                    const data = new DataTransfer(); data.items.add(file);
                    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
                    target.dispatchEvent(event); return event.defaultPrevented;
                },
                choose(file) {
                    const data = new DataTransfer(); data.items.add(file);
                    const input = this.root.querySelector('[data-pose="file"]'); input.files = data.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                },
                snapshot() { return this.root.querySelector('canvas').toDataURL(); },
                status() { return this.root.querySelector('[data-pose="status"]').textContent; }
            };
        });
        const mount = () => page.evaluate(() => window.poseFixture.mount());
        const prepared = () => page.waitForFunction(() => window.poseFixture.status().includes('图片已准备'), { timeout: 3000 });
        const seed = async () => {
            await page.evaluate(async () => window.poseFixture.choose(await window.poseFixture.file('red'))); await prepared();
            return page.evaluate(() => window.poseFixture.snapshot());
        };

        await t.test('粘贴图片进入真实预览，不自动识别或应用', async () => {
            await mount();
            assert.equal(await page.evaluate(async () => window.poseFixture.paste(await window.poseFixture.file())), true, '图片粘贴未被导入');
            await prepared();
            assert.deepEqual(await page.$eval('canvas', canvas => ({ width: canvas.width, height: canvas.height,
                pixel: [...canvas.getContext('2d').getImageData(10, 5, 1, 1).data] })), { width: 32, height: 16, pixel: [0, 0, 255, 255] });
            assert.equal(await page.$eval('[data-pose="apply"]', node => node.disabled), true);
            assert.equal(await page.evaluate(() => window.poseFixture.effects), 0);
        });
        await t.test('无头浏览器真实Clipboard API图片往返、Ctrl+V与粘贴按钮', async () => {
            await mount();
            await page.evaluate(async () => {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': await window.poseFixture.file('green') })]);
                document.body.tabIndex = -1; document.body.focus();
            });
            await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control');
            await prepared();
            assert.deepEqual(await page.$eval('canvas', canvas => [...canvas.getContext('2d').getImageData(10, 5, 1, 1).data]), [0, 128, 0, 255]);
            await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({ 'image/png': await window.poseFixture.file('blue') })]));
            await page.click('[data-pose="paste"]'); await prepared();
            assert.deepEqual(await page.$eval('canvas', canvas => [...canvas.getContext('2d').getImageData(10, 5, 1, 1).data]), [0, 0, 255, 255]);
            t.diagnostic('只读取本无头浏览器用合成PNG写入的剪贴板；系统Snipaste/手机仍需手工验收');
        });
        await t.test('关闭面板、折叠图片区与可编辑目标不拦截粘贴', async () => {
            await mount();
            const result = await page.evaluate(async () => {
                const f = window.poseFixture, image = await f.file(), out = [];
                f.panel.hidden = true; out.push(f.paste(image)); f.panel.hidden = false;
                f.root.open = false; out.push(f.paste(image)); f.root.open = true;
                for (const tag of ['input', 'textarea', 'div']) {
                    const node = document.createElement(tag); if (tag === 'div') node.contentEditable = 'true';
                    f.panel.append(node); out.push(f.paste(image, node));
                }
                out.push(f.paste(image, document.getElementById('outside'))); return out;
            });
            assert.deepEqual(result, [false, false, false, false, false, false]);
        });
        await t.test('文字粘贴保持默认，多图片只导入首张支持图片', async () => {
            await mount();
            const accepted = await page.evaluate(async () => {
                const data = new DataTransfer(); data.setData('text/plain', '普通文本');
                let event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
                document.body.dispatchEvent(event); const textPrevented = event.defaultPrevented;
                data.items.add(new File(['svg'], 'x.svg', { type: 'image/svg+xml' }));
                data.items.add(await window.poseFixture.file('blue')); data.items.add(await window.poseFixture.file('red'));
                event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
                document.body.dispatchEvent(event); return [textPrevented, event.defaultPrevented];
            });
            assert.deepEqual(accepted, [false, true]); await prepared();
            assert.deepEqual(await page.$eval('canvas', canvas => [...canvas.getContext('2d').getImageData(10, 5, 1, 1).data]), [0, 0, 255, 255]);
        });
        await t.test('损坏/超限图片保留旧预览，文件入口继续可用', async () => {
            await mount(); const previous = await seed();
            await page.evaluate(() => window.poseFixture.paste(new File(['broken'], 'broken.png', { type: 'image/png' })));
            await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled);
            assert.equal(await page.evaluate(() => window.poseFixture.snapshot()), previous);
            await page.evaluate(() => window.poseFixture.paste(new File([new Uint8Array(21 * 1024 * 1024)], 'large.png', { type: 'image/png' })));
            await page.waitForFunction(() => window.poseFixture.status().includes('20MiB'));
            assert.equal(await page.evaluate(() => window.poseFixture.snapshot()), previous);
        });
        for (const [name, expression] of [['拒绝权限', 'denied'], ['没有图片', 'empty'], ['API不可用', 'missing']]) {
            await t.test(name + '提示其他入口并保留旧图', async () => {
                await mount(); const previous = await seed();
                await page.evaluate(mode => {
                    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined : {
                        read: async () => { if (mode === 'denied') throw new DOMException('denied', 'NotAllowedError'); return []; }
                    } });
                    document.querySelector('[data-pose="paste"]').click();
                }, expression);
                await page.waitForFunction(() => /剪贴板|粘贴/u.test(window.poseFixture.status()));
                assert.equal(await page.evaluate(() => window.poseFixture.snapshot()), previous);
                assert.equal(await page.$eval('[data-pose="recognize"]', node => node.disabled), false);
            });
        }
        for (const action of ['换图', '关闭', '折叠', '销毁']) {
            await t.test('异步读取晚到不能覆盖' + action + '后的状态', async () => {
                await mount(); await seed();
                await page.evaluate(() => {
                    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: () => new Promise(resolve => { window.releasePoseRead = resolve; }) } });
                    document.querySelector('[data-pose="paste"]').click();
                });
                await page.evaluate(async action => {
                    const f = window.poseFixture;
                    if (action === '换图') f.choose(await f.file('blue'));
                    if (action === '关闭') { f.ui.cancel(); f.panel.hidden = true; }
                    if (action === '折叠') f.root.open = false;
                    if (action === '销毁') f.ui.dispose();
                }, action);
                if (action === '换图') await prepared();
                // 等待真实toggle事件，随后重新展开，证明不是仅靠最终hidden检查忽略结果。
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 10)));
                const previous = await page.evaluate(() => ({ image: window.poseFixture.snapshot(), status: window.poseFixture.status() }));
                await page.evaluate(async () => {
                    const f = window.poseFixture; f.panel.hidden = false; f.root.open = true;
                    window.releasePoseRead([new ClipboardItem({ 'image/png': await f.file('green') })]);
                });
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
                assert.deepEqual(await page.evaluate(() => ({ image: window.poseFixture.snapshot(), status: window.poseFixture.status() })), previous);
                if (action === '销毁') assert.equal(await page.evaluate(async () => window.poseFixture.paste(await window.poseFixture.file())), false, '销毁后仍监听文档粘贴');
            });
        }
        await t.test('旧图片解码晚到被丢弃并释放Bitmap', async () => {
            await mount(); await seed();
            await page.evaluate(async () => {
                const original = window.createImageBitmap; window.closedPoseBitmap = 0;
                window.createImageBitmap = async file => {
                    const value = await original(file), close = value.close.bind(value);
                    value.close = () => { window.closedPoseBitmap++; close(); };
                    return new Promise(resolve => { window.releasePoseBitmap = () => resolve(value); });
                };
                window.poseFixture.paste(await window.poseFixture.file('green')); window.createImageBitmap = original;
            });
            await page.waitForFunction(() => typeof window.releasePoseBitmap === 'function');
            await page.evaluate(async () => window.poseFixture.choose(await window.poseFixture.file('blue'))); await prepared();
            const previous = await page.evaluate(() => window.poseFixture.snapshot());
            await page.evaluate(() => window.releasePoseBitmap());
            await page.waitForFunction(() => window.closedPoseBitmap === 1);
            assert.equal(await page.evaluate(() => window.poseFixture.snapshot()), previous);
        });
        assert.ok(!requests.some(url => url.includes('worker.mjs') || url.includes('/vendor/pose/')), '导入图片不应提前识别');
        assert.deepEqual(errors, []);
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
