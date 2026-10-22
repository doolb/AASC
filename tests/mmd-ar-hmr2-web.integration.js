const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');
const root = path.resolve(__dirname, '..'), built = path.join(root, '3rd/mmd-ar-test/web-dist');

// 专用显式命令才运行完整2.7GB模型；CPU参考释放后才开启浏览器，避免两套模型同时占GPU。
test('实际WebGPU Worker单图推理、热次复用及UI结果与Node CPU同像素对照', { timeout: 600000 }, async () => {
    const outputDir = path.join(root, 'tmp/hmr2-web-proof'); await fsp.mkdir(outputDir, { recursive: true });
    const { Hmr2Engine } = await import('../3rd/hmr2-node-onnx/framework/engine.mjs');
    const sharp = require(require.resolve('sharp', { paths: [path.join(root, '3rd/hmr2-node-onnx')] }));
    const width = 160, height = 240, pixels = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 17 + (i >>> 9)) % 256);
    const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const engine = new Hmr2Engine({ provider: 'cpu' }); let expected;
    try { await engine.load(); expected = await engine.predictBytes(png); } finally { await engine.close(); }
    console.log('Node CPU参考完成');
    const requests = [], errors = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost'); requests.push({ path: url.pathname, method: req.method });
        if (url.pathname === '/') {
            res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/js/vendor/three/three.module.js"}}</script><style>body{font:15px system-ui;max-width:780px;margin:24px}label{display:block;margin:6px}[hidden]{display:none!important}input{max-width:100%}</style><h1>HMR纯网页实测</h1><p>真实WebGPU/模型；合成图片和Human界面壳，不表示识图精度或PMX视觉验收。</p><section id="panel"><p data-ik-message></p></section>'); return;
        }
        if (url.pathname === '/fixture.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return; }
        if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
        const file = path.resolve(built, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(built + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
        const stat = fs.statSync(file);
        res.setHeader('Content-Type', /\.(mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = fs.createReadStream(file); res.on('close', () => stream.destroy()); stream.pipe(res);
    });
    let browser;
    const report = { date: new Date().toISOString(), boundary: '真实完整模型/Worker；合成RGBA图片，非识图精度验收', expected };
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ headless: true, protocolTimeout: 600000 });
        const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 1100 });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.text().startsWith('HMRTEST')) console.log(message.text()); });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async () => {
            const { installImagePose } = await import('/js/web-human-pose-ui.mjs');
            const { createHmrWebClient } = await import('/js/web-human-hmr2-web-client.mjs');
            window.client = createHmrWebClient(); const infer = window.client.infer;
            window.client.infer = async (...args) => { const result = await infer(...args); window.lastInference = result; return result; };
            const human = { getState: () => ({ ready: true, token: 'fixture' }),
                getImageCameraState: () => ({ available: false, canRestore: false, reason: 'UI验证壳' }) };
            window.ui = installImagePose(document.querySelector('#panel'), { human: () => human, hmrWebClient: window.client, ensurePhysics: async () => {} });
            window.ui.sync(true); document.querySelector('[data-pose-panel]').open = true;
        });
        await page.waitForFunction(() => !document.querySelector('option[value="hmr2-web"]').disabled, { timeout: 30000 });
        assert.equal(requests.some(r => r.method === 'GET' && r.path.endsWith('model.onnx.data')), false);
        await page.select('[data-pose="source"]', 'hmr2-web');
        assert.equal(await page.$eval('[data-depth="with-recognition"]', node => node.checked), true);
        await page.evaluate(async () => {
            const file = new File([await (await fetch('/fixture.png')).blob()], 'fixture.png', { type: 'image/png' });
            const transfer = new DataTransfer(); transfer.items.add(file);
            const input = document.querySelector('[data-pose="file"]'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
        });
        await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled);
        await page.click('[data-pose="recognize"]');
        // 输出页面进度以便定位实际Worker失败阶段，不用UI mock代替模型执行。
        const interval = setInterval(async () => {
            try { console.log('progress', await page.$eval('[data-pose="status"]', node => node.textContent)); } catch { /* 页面关闭后的读操作可忽略。 */ }
        }, 15000);
        try {
            await page.waitForFunction(() => window.lastInference || document.querySelector('[data-pose="status"]').textContent.includes('失败'), { timeout: 480000 });
        } finally { clearInterval(interval); }
        report.status = await page.$eval('[data-pose="status"]', node => node.textContent);
        report.actual = await page.evaluate(() => window.lastInference?.raw);
        assert.ok(report.actual, report.status);
        await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled);
        report.depthStatus = await page.$eval('[data-depth="status"]', node => node.textContent);
        assert.match(report.depthStatus, /整图相对深度完成/);
        assert.equal(report.actual.source, 'hmr2-web');
        report.differences = {};
        for (const name of ['xyz', 'xy', 'rotations24', 'betas10', 'predCam', 'cameraTranslation', 'cameraDepth']) {
            const a = report.actual[name].flat(Infinity), b = expected[name].flat(Infinity);
            report.differences[name] = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
        }
        console.log('DIFFERENCES', JSON.stringify(report.differences));
        assert.ok(report.differences.xyz < .002, '三维坐标差超过2毫米');
        assert.ok(report.differences.xy < .5, '原图投影差超过0.5像素');
        assert.ok(report.differences.rotations24 < .002, '旋转矩阵元素差超过0.002');
        const loaded = requests.filter(r => r.method === 'GET' && r.path.endsWith('model.onnx.data')).length;
        report.warm = await page.evaluate(async () => {
            const image = await createImageBitmap(await (await fetch('/fixture.png')).blob());
            const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
            const data = context.getImageData(0, 0, canvas.width, canvas.height);
            return (await window.client.infer(data)).raw;
        });
        assert.equal(requests.filter(r => r.method === 'GET' && r.path.endsWith('model.onnx.data')).length, loaded, '热次不可重复加载模型');
        await page.screenshot({ path: path.join(outputDir, 'webgpu-result.png'), fullPage: true });
        await page.evaluate(() => window.ui.dispose()); assert.deepEqual(errors, []);
        console.log('WebGPU真实图片通过', JSON.stringify({ coldLoadMs: report.actual.modelLoadMs, firstRunMs: report.actual.inferenceMs, warmRunMs: report.warm.inferenceMs }));
    } finally {
        await fsp.writeFile(path.join(outputDir, 'integration-report.json'), JSON.stringify(report, null, 2));
        if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
});
