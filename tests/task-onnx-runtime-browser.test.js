'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');
const puppeteer = require('puppeteer');
const { TaskDependencyManager } = require('../src/apps/server/modules/aasc/task-dependency-manager');

test('真实Chromium按任务加载本机ORT WebGPU入口，首屏不请求ORT且同页只加载一次', async t => {
    const projectRoot = path.resolve(__dirname, '..');
    const executablePath = process.env.CHROME_BIN || puppeteer.executablePath();
    if (!fs.existsSync(executablePath)) { t.skip('本机未安装Chromium'); return; }
    const manager = new TaskDependencyManager({ projectRoot });
    const assets = manager.assetDirectory('onnxruntime-web');
    if (!assets) { t.skip('本机未安装可选ORT包'); return; }
    const requests = [];
    const app = express();
    app.get('/', (req, res) => res.send('<!doctype html><script src="/task-onnx-runtime.js"></script>'));
    app.get('/task-onnx-runtime.js', (req, res) => res.sendFile(path.join(projectRoot, 'src/apps/web-mediacenter/ui/public/js/task-onnx-runtime.js')));
    app.use('/js/lib', (req, res, next) => { requests.push(req.url); next(); }, express.static(assets));
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle0' });
    assert.equal(requests.length, 0);
    const result = await page.evaluate(async () => {
        const [first, second] = await Promise.all([window.TaskOnnxRuntime.load(), window.TaskOnnxRuntime.load()]);
        return { same: first === second, create: typeof first.InferenceSession.create,
            wasmPaths: first.env.wasm.wasmPaths, expectedPaths: `${window.location.origin}/js/lib/` };
    });
    assert.equal(result.same, true); assert.equal(result.create, 'function');
    assert.equal(result.wasmPaths, result.expectedPaths);
    assert.deepEqual(requests, ['/ort.webgpu.min.js']);
});
