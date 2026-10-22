const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const project = path.resolve(__dirname, '..'), source = path.join(project, '3rd/mmd-ar-test');

test('真实浏览器HMR网页选项缺模型禁用，普通页面不加载模型或启动Worker', async () => {
    const calls = [], errors = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost'); calls.push(url.pathname);
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script type="importmap">{"imports":{"three":"/three.mjs"}}</script><section id="panel"><p data-ik-message></p></section>'); return; }
        if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
        if (url.pathname === '/js/vendor/hmr2/models.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ schemaVersion: 1, source: 'hmr2-web', available: false })); return; }
        const file = url.pathname === '/three.mjs' ? path.join(project, 'node_modules/three/build/three.module.js')
            : /^\/js\/[a-z0-9-]+\.mjs$/.test(url.pathname) ? path.join(source, path.basename(url.pathname)) : null;
        if (!file || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(file).pipe(res);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async () => {
            const { installImagePose } = await import('/js/web-human-pose-ui.mjs');
            window.workerCount = 0;
            const Original = window.Worker;
            window.Worker = class extends Original { constructor(...args) { super(...args); window.workerCount++; } };
            const human = { getState: () => ({ token: 'model' }) };
            window.poseUi = installImagePose(document.querySelector('#panel'), { human: () => human, ensurePhysics: async () => {} });
        });
        const values = await page.$$eval('[data-pose="source"] option', nodes => nodes.map(node => node.value));
        assert.deepEqual(values, ['mediapipe-pose', 'hmr2-api', 'hmr2-web', 'hmr2-web-cpu']);
        await page.waitForFunction(() => document.querySelector('[data-pose="web-status"]')?.textContent.includes('模型未准备'));
        assert.equal(await page.$eval('option[value="hmr2-web"]', node => node.disabled), true);
        assert.equal(await page.$eval('option[value="hmr2-web-cpu"]', node => node.disabled), true);
        assert.equal(await page.$eval('[data-pose="source"]', node => node.value), 'mediapipe-pose');
        assert.equal(await page.evaluate(() => window.workerCount), 0);
        assert.equal(calls.some(url => /model\.onnx|ort\.|opencv/.test(url)), false);
        await page.evaluate(() => window.poseUi.dispose()); assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
