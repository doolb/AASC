'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const SOURCE = path.resolve(__dirname, '../3rd/mmd-ar-test');
const BUILT = path.join(SOURCE, 'web-dist');
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEPTH_MODEL = path.join(BUILT, 'js/vendor/depth/model_quantized.onnx');
const REQUIRED = [DEPTH_MODEL, path.join(BUILT, 'js/vendor/depth/models.json'),
    path.join(BUILT, 'js/vendor/pose/ort.wasm.min.mjs'), path.join(BUILT, 'js/vendor/pose/ort-wasm-simd-threaded.wasm'),
    path.join(BUILT, 'js/vendor/three/three.module.js')];
const missing = !fs.existsSync(CHROME) ? '缺少指定Chrome' : REQUIRED.some(file => !fs.existsSync(file)) ? '缺少已构建Depth/ORT资源' : false;
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm',
    '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const SESSION_TOKEN = 'synthetic-session-token-ui-test';
const NAMES = ['nose', 'neck', 'right_shoulder', 'right_elbow', 'right_wrist', 'left_shoulder',
    'left_elbow', 'left_wrist', 'mid_hip', 'right_hip', 'right_knee', 'right_ankle', 'left_hip',
    'left_knee', 'left_ankle', 'right_eye', 'left_eye', 'right_ear', 'left_ear', 'left_big_toe',
    'left_small_toe', 'left_heel', 'right_big_toe', 'right_small_toe', 'right_heel'];
const EDGES = [[1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [10, 11],
    [8, 12], [12, 13], [13, 14], [0, 1], [0, 15], [0, 16], [15, 17], [16, 18],
    [11, 22], [22, 23], [11, 24], [14, 19], [19, 20], [14, 21]];
const XY = [[.5, .12], [.5, .24], [.38, .25], [.28, .4], [.23, .55], [.62, .25], [.72, .4], [.77, .55],
    [.5, .52], [.44, .53], [.43, .7], [.42, .88], [.56, .53], [.57, .7], [.58, .88],
    [.47, .1], [.53, .1], [.43, .13], [.57, .13], [.61, .92], [.64, .91], [.57, .9],
    [.39, .92], [.36, .91], [.43, .9]];
const HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HMR2/Depth独立集成自测</title>
<script type="importmap">{"imports":{"three":"./js/vendor/three/three.module.js"}}</script>
<style>body{font:15px system-ui;margin:16px;color:#ddd;background:#171a20}main{max-width:900px;margin:auto}
label{display:block;margin:8px 0}[hidden]{display:none!important}input,button,select{max-width:100%;box-sizing:border-box}button{margin:4px;padding:6px}
p{line-height:1.55}canvas{background:#111}#boundary{border:1px solid #ffbd46;padding:12px;color:#ffdd8a}</style>
<main><h2>HMR2 / Depth Anything 独立浏览器自测</h2><p id="boundary">测试边界：HMR HTTP为同源mock，Human为UI stub（不代表GPU/PMX精度）；Depth Worker + ORT + ONNX均为真实推理。源码模块来自当前工作区，资产来自web-dist。</p>
<section id="panel"><p data-ik-message>此壳只测试真实图片UI与任务生命周期。</p></section></main></html>`;

function deferred() {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
}
function mockResult(width, height, bbox) {
    const cameraTranslation = [0, 0, 5], focal = Math.max(width, height);
    const xy = XY.map(([x, y]) => [x * width, y * height]);
    const xyz = xy.map(([x, y]) => [(x - width / 2) * 5 / focal, (y - height / 2) * 5 / focal, 0]);
    return { type: 'hmr2.result', schemaVersion: 1, model: 'HMR2.0b',
        source: 'official 4D-Humans checkpoint; embedded SMPL buffers via smplx.lbs',
        device: 'cuda:0', gpu: { index: 0, name: 'MOCK GPU — not actual inference' }, precision: 'fp32',
        imageSize: [width, height], boxXYXY: bbox || [0, 0, width, height], bboxSource: bbox ? 'supplied' : 'full_image_fallback',
        names: [...NAMES], edges: structuredClone(EDGES), xyz, xy, cameraDepth: Array(25).fill(5),
        rotations24: Array.from({ length: 24 }, () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), betas10: Array(10).fill(0),
        predCam: [1, 0, 0], cameraTranslation, projection: { focalLengthPx: focal, principalPointPx: [width / 2, height / 2] },
        camera: { translation: [...cameraTranslation], focalLengthPx: focal, principalPoint: [width / 2, height / 2] },
        inputTensorSha256: 'a'.repeat(64), modelLoadMs: 100, inferenceMs: 30,
        timingMs: { preprocess: 1, hostToDevice: 1, network: 25, lbs: 5, projection: 1, deviceToHost: 1, total: 34, modelLoad: 100 },
        memory: { allocatedMiB: 1, reservedMiB: 1, peakAllocatedMiB: 1, peakReservedMiB: 1, deviceFreeMiB: 1, deviceTotalMiB: 2 } };
}
function json(res, payload, status = 200) {
    if (res.destroyed || res.writableEnded) return;
    const bytes = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes);
}
function makeFixtureServer() {
    const calls = [], staticRequests = [], failures = [], waiting = new Set();
    let nextPlan = null;
    function plan(options = {}) {
        const started = deferred();
        nextPlan = { ...options, started, response: null, released: false };
        const value = nextPlan;
        return { started: started.promise, release() { value.released = true; value.response?.(); } };
    }
    const server = http.createServer(async (req, res) => {
        try {
            const pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
            if (pathname === '/hmr/health' || pathname === '/hmr/infer') {
                const current = nextPlan; nextPlan = null;
                const chunks = []; let size = 0;
                for await (const chunk of req) {
                    size += chunk.length; if (size > 24 * 1024 * 1024) throw new Error('mock请求超出24MiB'); chunks.push(chunk);
                }
                const body = Buffer.concat(chunks), payload = body.length ? JSON.parse(body.toString('utf8')) : null;
                const call = { method: req.method, pathname, bodyLength: body.length, authorization: req.headers.authorization,
                    headers: { ...req.headers }, payload, pngSize: null, width: null, height: null, closedBeforeResponse: false };
                calls.push(call);
                const closed = deferred(); call.closed = closed.promise;
                res.on('close', () => { if (!res.writableEnded) call.closedBeforeResponse = true; closed.resolve(); });
                let output;
                if (pathname.endsWith('/health')) {
                    output = { type: 'hmr2.health', ready: true, model: 'HMR2.0b', device: 'cuda:0', precision: 'fp32', busy: false };
                } else {
                    assert.equal(req.method, 'POST'); assert.match(req.headers['content-type'], /^application\/json/u);
                    assert.deepEqual(Object.keys(payload).sort(), payload.bbox_xyxy === undefined ? ['image_base64'] : ['bbox_xyxy', 'image_base64']);
                    const png = Buffer.from(payload.image_base64, 'base64');
                    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
                    assert.equal(png.subarray(12, 16).toString(), 'IHDR'); assert.ok(png.length <= 16 * 1024 * 1024);
                    call.pngSize = png.length; call.width = png.readUInt32BE(16); call.height = png.readUInt32BE(20);
                    output = mockResult(call.width, call.height, payload.bbox_xyxy);
                }
                const respond = () => {
                    waiting.delete(res);
                    json(res, current?.error ? { error: { status: 503, code: 'gpu_busy', message: 'MOCK GPU正在推理，请稍后重试' } } : output, current?.error ? 503 : 200);
                };
                if (current) { current.response = respond; current.started.resolve(call); }
                if (current?.hold && !current.released) waiting.add(res); else respond();
                return;
            }
            if (pathname === '/') {
                const bytes = Buffer.from(HTML); res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': bytes.length }); res.end(bytes); return;
            }
            if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
            // 仅这一测试server映射最新Human源码，避免父构建过程中覆盖同一web-dist目录。
            let file;
            if (/^\/js\/web-human-[a-z0-9-]+\.mjs$/u.test(pathname)) file = path.join(SOURCE, path.basename(pathname));
            else if (pathname.startsWith('/js/vendor/')) file = path.resolve(BUILT, '.' + pathname);
            if (!file || (!file.startsWith(SOURCE + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                res.writeHead(404).end(); return;
            }
            const stat = fs.statSync(file), record = { pathname, size: stat.size };
            staticRequests.push(record);
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size,
                'Cache-Control': 'no-store' });
            const digest = crypto.createHash('sha256'), stream = fs.createReadStream(file);
            stream.on('data', bytes => digest.update(bytes)); stream.on('end', () => { record.sha256 = digest.digest('hex'); });
            stream.on('error', error => { failures.push(error.message); res.destroy(); }).pipe(res);
        } catch (error) {
            failures.push(error.message); json(res, { error: { status: 500, code: 'fixture_error', message: '独立HTTP fixture失败' } }, 500);
        }
    });
    return { server, calls, staticRequests, failures, plan, releaseAll() { for (const res of waiting) res.destroy(); waiting.clear(); } };
}

async function setField(page, kind, key, value, event = 'input') {
    await page.evaluate(({ kind, key, value, event }) => {
        const field = document.querySelector(`[data-${kind}="${key}"]`);
        if (field.type === 'checkbox') field.checked = value; else field.value = value;
        field.dispatchEvent(new Event(event, { bubbles: true }));
    }, { kind, key, value, event });
}
const status = async page => await page.$eval('[data-pose="status"]', element => element.textContent);
const depthStatus = async page => await page.$eval('[data-depth="status"]', element => element.textContent);
const idle = async page => await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled);
const prepared = async page => await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
async function chooseImage(page, width = 640, height = 360, variant = 0) {
    await page.evaluate(async ({ width, height, variant }) => window.fixture.choose(await window.fixture.file(width, height, variant)), { width, height, variant });
    await prepared(page);
}
async function hmrMode(page, baseUrl) {
    await page.select('[data-pose="source"]', 'hmr2-api');
    await setField(page, 'depth', 'with-recognition', false, 'change');
    await setField(page, 'pose', 'api-url', baseUrl);
    await setField(page, 'pose', 'api-token', SESSION_TOKEN);
}
async function recognize(page) {
    await page.click('[data-pose="recognize"]'); await idle(page);
    assert.match(await status(page), /识别完成.*BODY25/u);
}

// 临时loopback server与无头Chrome都只属于该测试；从不启动/关闭用户服务器或连接真实GPU。
test('HMR2图片UI真实Chrome/HTTP mock边界与DA真实Worker-ORT-ONNX整图推理', { skip: missing, timeout: 360000 }, async t => {
    const fixture = makeFixtureServer(), errors = [], consoleErrors = [], observations = { checks: [] };
    const check = async (name, run) => await t.test(name, async () => {
        try { await run(); observations.checks.push({ name, passed: true }); }
        catch (error) { observations.checks.push({ name, passed: false, error: error.message }); throw error; }
    });
    const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
    const output = path.resolve(__dirname, '../tmp/mmd-pose/hmr2-depth-integration', runId);
    fs.mkdirSync(output, { recursive: true });
    let browser, page;
    const shot = async name => { await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };
    try {
        await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${fixture.server.address().port}`, baseUrl = origin + '/hmr';
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        observations.browser = await browser.version(); observations.fixtureUrl = origin;
        page = await browser.newPage(); page.setDefaultTimeout(10000); await page.setViewport({ width: 900, height: 1100 });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        await page.evaluateOnNewDocument(() => {
            // 只监听真正Worker输出并统计terminate；不改ORT导入、模型数据、推理消息或传回结果。
            const nativeFetch = window.fetch.bind(window);
            window.httpObservations = [];
            window.fetch = async (url, options = {}) => {
                const pathname = new URL(String(url), location.href).pathname;
                if (!pathname.startsWith('/hmr/')) return await nativeFetch(url, options);
                const record = { pathname, method: options.method || 'GET', signalAborted: options.signal?.aborted === true, rejectedName: null, fulfilled: false };
                window.httpObservations.push(record);
                const onAbort = () => { record.signalAborted = true; };
                options.signal?.addEventListener('abort', onAbort, { once: true });
                try { const result = await nativeFetch(url, options); record.fulfilled = true; return result; }
                catch (error) { record.rejectedName = error.name; throw error; }
                finally { options.signal?.removeEventListener('abort', onAbort); }
            };
            const NativeWorker = window.Worker;
            window.depthObservations = { results: [], progress: [], created: 0, terminated: 0 };
            window.Worker = class extends NativeWorker {
                constructor(url, options) {
                    super(url, options); this.observedDepth = String(url).includes('web-human-depth-worker.mjs');
                    if (this.observedDepth) {
                        window.depthObservations.created++;
                        this.addEventListener('message', ({ data }) => {
                            if (data.type === 'result') window.depthObservations.results.push(data.result);
                            if (data.type === 'progress') window.depthObservations.progress.push(data.message);
                        });
                    }
                }
                terminate() { if (this.observedDepth) window.depthObservations.terminated++; return super.terminate(); }
            };
        });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.evaluate(async () => {
            const { installImagePose } = await import('/js/web-human-pose-ui.mjs');
            const { createHmr2PoseClient } = await import('/js/web-human-hmr2-client.mjs');
            const { getPoseReference } = await import('/js/web-human-pose-semantic.mjs');
            window.fixture = {
                effects: [], modelToken: 'ui-stub-model-a', pose: null, lastHmr: null,
                async file(width, height, variant = 0) {
                    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d'), background = ctx.createLinearGradient(0, 0, width, height);
                    background.addColorStop(0, variant ? '#87a671' : '#96b9d6'); background.addColorStop(1, '#232c38');
                    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
                    ctx.fillStyle = '#bbb4a3'; ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(width * .38, height * .38);
                    ctx.lineTo(width * .66, height * .38); ctx.lineTo(width, height); ctx.fill();
                    ctx.fillStyle = '#ddd6bf'; ctx.fillRect(width * .06, height * .1, width * .22, height * .48);
                    ctx.fillStyle = variant ? '#955271' : '#d17842'; ctx.fillRect(width * .68, height * .44, width * .19, height * .48);
                    ctx.fillStyle = '#e3c6a8'; ctx.beginPath(); ctx.ellipse(width * .5, height * .17, width * .035, height * .075, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#243c58'; ctx.fillRect(width * .455, height * .245, width * .09, height * .29);
                    ctx.strokeStyle = '#243c58'; ctx.lineWidth = width * .025; ctx.lineCap = 'round';
                    for (const values of [[.45, .27, .29, .5], [.55, .27, .7, .5], [.48, .53, .45, .9], [.52, .53, .57, .9]]) {
                        ctx.beginPath(); ctx.moveTo(values[0] * width, values[1] * height); ctx.lineTo(values[2] * width, values[3] * height); ctx.stroke();
                    }
                    return new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], `generated-${width}x${height}-${variant}.png`, { type: 'image/png' });
                },
                choose(file) {
                    const data = new DataTransfer(); data.items.add(file);
                    const input = document.querySelector('[data-pose="file"]'); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
                },
                mount() {
                    this.ui?.dispose(); this.effects = []; this.pose = this.lastHmr = null;
                    const hmrClient = createHmr2PoseClient(), nativeInfer = hmrClient.infer;
                    hmrClient.infer = async (...args) => { const result = await nativeInfer(...args); this.lastHmr = result; return result; };
                    this.ui = installImagePose(document.querySelector('#panel'), {
                        hmrClient,
                        human: () => ({ getState: () => ({ ready: true, token: this.modelToken }),
                            getImageCameraState: () => ({ available: false, canRestore: false, reason: 'Human stub不测试相机或PMX' }),
                            applyInteractiveImagePose: async (pose, token, options) => {
                                if (!options.isCurrent() || token !== this.modelToken) throw new Error('UI stub过期应用');
                                this.effects.push({ kind: 'apply', source: pose.source, depthEnabled: options.depthEnabled, hintCount: options.depthHints?.length || 0 });
                                this.pose = structuredClone(pose); return { activeTargets: 12 };
                            } }),
                        ensurePhysics: async options => { if (!options.isCurrent()) throw new Error('UI stub过期物理初始化'); this.effects.push({ kind: 'ensurePhysics' }); },
                    });
                    this.ui.sync(true); document.querySelector('[data-pose-panel]').open = true;
                },
                reference() { return getPoseReference(this.lastHmr?.candidates?.[0]); },
                capture() {
                    const canvas = document.querySelector('[data-pose="preview"]');
                    return { data: canvas.toDataURL(), width: canvas.width, height: canvas.height,
                        effects: structuredClone(this.effects), pose: this.pose ? JSON.stringify(this.pose) : null };
                },
            };
            window.fixture.mount();
        });

        await check('真实浏览器模块导入、方式/地址/会话token与health不上传', async () => {
            assert.deepEqual(await page.$$eval('[data-pose="source"] option', elements => elements.map(element => element.value)), ['mediapipe-pose', 'hmr2-api']);
            assert.equal(await page.$eval('[data-pose="api-controls"]', element => element.hidden), true);
            assert.equal(await page.$eval('[data-depth="assist"]', element => element.checked), false);
            assert.ok(!fixture.staticRequests.some(request => request.pathname.includes('/vendor/depth/')), '默认不应加载深度模型');
            await hmrMode(page, baseUrl + '/');
            assert.match(await page.$eval('[data-pose="privacy"]', element => element.textContent), /上传.*API.*隐私/u);
            await page.click('[data-pose="test-api"]');
            await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('连接成功'));
            assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].method, 'GET');
            assert.equal(fixture.calls[0].bodyLength, 0); assert.equal(fixture.calls[0].payload, null);
            assert.equal(fixture.calls[0].authorization, 'Bearer ' + SESSION_TOKEN);
            const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
            assert.equal(storage['mmdAr.hmr2ApiBaseUrl'], baseUrl);
            assert.ok(!JSON.stringify(storage).includes(SESSION_TOKEN)); assert.ok(!Object.keys(storage).some(key => /token/u.test(key)));
            assert.equal(await page.$eval('[data-pose="api-token"]', element => element.type), 'password');
            assert.ok(!fixture.staticRequests.some(request => request.pathname.includes('/vendor/depth/')), 'health不能顺带触发深度推理');
        });

        await check('真实Canvas PNG HTTP上传严格wire/xyxy与BODY25参考预览，应用仍需用户点击', async () => {
            await chooseImage(page); const before = await page.evaluate(() => window.fixture.capture());
            await setField(page, 'pose', 'bbox-enabled', true, 'change');
            for (const [key, value] of [['bbox-x1', 20], ['bbox-y1', 10], ['bbox-x2', 620], ['bbox-y2', 350]]) await setField(page, 'pose', key, value);
            await recognize(page);
            const call = fixture.calls.at(-1);
            assert.equal(call.pathname, '/hmr/infer'); assert.equal(call.method, 'POST'); assert.ok(call.pngSize > 0);
            assert.equal(call.width, 640); assert.equal(call.height, 360); assert.deepEqual(call.payload.bbox_xyxy, [20, 10, 620, 350]);
            assert.equal(call.authorization, 'Bearer ' + SESSION_TOKEN); assert.ok(!Object.hasOwn(call.payload, 'token'));
            // Content-Length由真实Chrome网络栈生成是正常行为；客户端不手工设置该禁用头，纯客户端测试另有覆盖。
            assert.equal(Number(call.headers['content-length']), call.bodyLength);
            const observed = await page.evaluate(() => {
                const pose = window.fixture.lastHmr.candidates[0], reference = window.fixture.reference(), canvas = document.querySelector('[data-pose="preview"]');
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let yellow = 0, green = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    if (pixels[i] > 230 && pixels[i + 1] > 175 && pixels[i + 2] < 125) yellow++;
                    if (pixels[i] < 95 && pixels[i + 1] > 190 && pixels[i + 2] > 125) green++;
                }
                return { points: reference.points.length, edges: reference.edges, nativeNames: pose.raw.names,
                    body: Object.keys(pose.joints).length, landmarks: pose.landmarks, quality: pose.quality,
                    yellow, green, effectCount: window.fixture.effects.length, preview: canvas.toDataURL() };
            });
            assert.equal(observed.points, 25); assert.equal(observed.body, 15); assert.deepEqual(observed.edges, EDGES); assert.deepEqual(observed.nativeNames, NAMES);
            assert.equal(observed.landmarks, undefined); assert.equal(observed.quality.visible, 12); assert.equal(observed.effectCount, 0);
            assert.ok(observed.yellow > 25 && observed.green > 20, JSON.stringify({ yellow: observed.yellow, green: observed.green }));
            assert.notEqual(observed.preview, before.data); assert.match(await status(page), /25\/25.*几何可用/u);
            assert.match(await status(page), /不提供逐点置信度/u);
            await page.click('[data-pose="apply"]'); await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('已应用'));
            assert.deepEqual(await page.evaluate(() => window.fixture.effects), [{ kind: 'ensurePhysics' }, { kind: 'apply', source: 'hmr2-api', depthEnabled: false, hintCount: 0 }]);
            observations.hmrWire = { dimensions: [call.width, call.height], bbox: call.payload.bbox_xyxy, pngBytes: call.pngSize,
                requestFields: Object.keys(call.payload).sort(), referencePoints: observed.points, referenceEdges: observed.edges.length };
            await shot('hmr-body25-http-mock-ui-stub');
        });

        await check('503 gpu_busy与非法框不改变已应用Human stub，失败无静默算法回退', async () => {
            const before = await page.evaluate(() => window.fixture.capture()), count = fixture.calls.length;
            await setField(page, 'pose', 'bbox-x2', 0); await page.click('[data-pose="recognize"]'); await idle(page);
            assert.match(await status(page), /人物框/u); assert.equal(fixture.calls.length, count);
            await setField(page, 'pose', 'bbox-x2', 620); fixture.plan({ error: true });
            await page.click('[data-pose="recognize"]'); await idle(page);
            assert.match(await status(page), /MOCK GPU正在推理/u);
            const after = await page.evaluate(() => window.fixture.capture()); assert.deepEqual(after.effects, before.effects); assert.equal(after.pose, before.pose);
            assert.equal(await page.$eval('[data-pose="apply"]', element => element.disabled), true);
            assert.ok(!fixture.staticRequests.some(request => request.pathname.includes('pose_estimation_mediapipe')), 'HMR失败不能静默回退本地MP');
        });

        await check('真实Abort取消/换图/方式/API/token/框/折叠/PMX代次拒绝旧HTTP结果', async () => {
            const variants = [
                ['cancel', async () => { await page.click('[data-pose="cancel"]'); }],
                ['image', async () => { await chooseImage(page, 480, 320, 1); }],
                ['source', async () => { await page.select('[data-pose="source"]', 'mediapipe-pose'); }],
                ['api', async () => { await setField(page, 'pose', 'api-url', baseUrl + '/'); }],
                ['token', async () => { await setField(page, 'pose', 'api-token', SESSION_TOKEN + '-changed'); }],
                ['bbox', async () => { await setField(page, 'pose', 'bbox-x1', 21); }],
                ['collapse', async () => { await page.$eval('[data-pose-panel]', element => { element.open = false; }); }],
                ['model', async () => { await page.evaluate(() => { window.fixture.modelToken += '-new'; window.fixture.ui.sync(true); }); }],
            ];
            observations.httpRaceVariants = [];
            for (const [name, invalidate] of variants) {
                await page.$eval('[data-pose-panel]', element => { element.open = true; });
                await hmrMode(page, baseUrl); await chooseImage(page);
                await setField(page, 'pose', 'bbox-enabled', false, 'change');
                const before = await page.evaluate(() => window.fixture.capture());
                const browserIndex = await page.evaluate(() => window.httpObservations.length);
                const held = fixture.plan({ hold: true }); await page.click('[data-pose="recognize"]'); const call = await held.started;
                await invalidate(); await page.waitForFunction(() => document.querySelector('[data-pose="apply"]').disabled);
                // 原测试先释放回复使res.writableEnded变true，再读close标记，造成取消观测竞态。
                // 现在先要求真正fetch收到signal并以AbortError拒绝，再等Node真实close；不跳过任何取消断言。
                await page.waitForFunction(index => window.httpObservations[index]?.signalAborted
                    && window.httpObservations[index]?.rejectedName === 'AbortError', { timeout: 3000 }, browserIndex);
                let closeTimer;
                try {
                    await Promise.race([call.closed, new Promise((resolve, reject) => {
                        closeTimer = setTimeout(() => reject(new Error(`${name}原生fetch已AbortError，但3秒内HTTP响应尚未close`)), 3000);
                    })]);
                } finally { clearTimeout(closeTimer); }
                const settled = await status(page); held.release();
                await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 80)));
                assert.equal(await status(page), settled, `${name}迟到HTTP改变状态`);
                const after = await page.evaluate(() => window.fixture.capture()); assert.deepEqual(after.effects, before.effects, name); assert.equal(after.pose, before.pose, name);
                assert.equal(call.closedBeforeResponse, true, `${name}未真正Abort HTTP等待`);
                assert.equal(await page.$eval('[data-pose="apply"]', element => element.disabled), true, name);
                observations.httpRaceVariants.push(name);
            }
            await page.$eval('[data-pose-panel]', element => { element.open = true; }); await hmrMode(page, baseUrl); await chooseImage(page);
        });

        await check('真实DA整图Worker/ORT/WASM量化ONNX：16:9、有限浮点、P5/P95黄近蓝远与UI预览', async () => {
            await chooseImage(page, 1600, 900);
            const limits = await page.evaluate(async () => (await import('/js/web-human-depth-core.mjs')).DEPTH_LIMITS);
            assert.equal(limits.inputLongest, 1024); assert.equal(limits.inputPixels, 518 * 1024, '父代理须先完成常规16:9输入预算修正');
            assert.equal(await page.$eval('[data-depth="assist"]', element => element.checked), false);
            const beforeCalls = fixture.calls.length, beforeResults = await page.evaluate(() => window.depthObservations.results.length);
            await page.click('[data-depth="compute"]');
            await page.waitForFunction(() => !document.querySelector('[data-depth="cancel"]').disabled);
            await page.waitForFunction(() => /整图相对深度完成|深度推理失败/u.test(document.querySelector('[data-depth="status"]').textContent), { timeout: 180000 });
            assert.match(await depthStatus(page), /整图相对深度完成/u, await depthStatus(page));
            assert.equal(fixture.calls.length, beforeCalls, '浏览器本地DA不得上传图片');
            const real = await page.evaluate(async ({ beforeResults }) => {
                const { depthHeatmap } = await import('/js/web-human-depth-core.mjs');
                const result = window.depthObservations.results.at(-1); if (!result) throw new Error('没有真实Worker推理结果');
                let min = Infinity, max = -Infinity, finite = true, minIndex = 0, maxIndex = 0;
                for (let i = 0; i < result.data.length; i++) {
                    const value = result.data[i]; finite = finite && Number.isFinite(value);
                    if (value < min) { min = value; minIndex = i; } if (value > max) { max = value; maxIndex = i; }
                }
                const pixels = depthHeatmap(result), canvas = document.querySelector('[data-depth="preview"]');
                const preview = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let yellow = 0, blue = 0;
                for (let i = 0; i < preview.length; i += 4) {
                    if (preview[i] > 220 && preview[i + 1] > 160 && preview[i + 2] < 55) yellow++;
                    if (preview[i] < 55 && preview[i + 1] < 70 && preview[i + 2] > 220) blue++;
                }
                return { source: result.source, width: result.width, height: result.height, inputWidth: result.inputWidth, inputHeight: result.inputHeight,
                    length: result.data.length, float32: result.data instanceof Float32Array, finite, min, max, low: result.low, high: result.high,
                    inferenceMs: result.inferenceMs, lowPixel: [...pixels.subarray(minIndex * 4, minIndex * 4 + 4)],
                    highPixel: [...pixels.subarray(maxIndex * 4, maxIndex * 4 + 4)], resultDelta: window.depthObservations.results.length - beforeResults,
                    preview: { width: canvas.width, height: canvas.height, hidden: canvas.hidden, yellow, blue }, progress: [...window.depthObservations.progress] };
            }, { beforeResults });
            assert.equal(real.source, 'depth-anything-v2-small'); assert.equal(real.resultDelta, 1);
            assert.equal(real.width, 924); assert.equal(real.height, 518); assert.equal(real.length, real.width * real.height);
            assert.equal(real.float32, true); assert.equal(real.finite, true); assert.ok(real.max > real.min && real.high > real.low);
            assert.equal(real.inputWidth, real.width); assert.equal(real.inputHeight, real.height);
            assert.deepEqual(real.lowPixel, [0, 0, 255, 255]); assert.deepEqual(real.highPixel, [255, 200, 0, 255]);
            assert.deepEqual([real.preview.width, real.preview.height, real.preview.hidden], [400, 225, false]);
            assert.ok(real.preview.yellow > 10 && real.preview.blue > 10, JSON.stringify(real.preview));
            assert.ok(real.progress.some(value => value.includes('WASM单线程')));
            assert.ok(fixture.staticRequests.some(request => request.pathname.endsWith('/vendor/depth/model_quantized.onnx') && request.size === 27258801));
            assert.ok(fixture.staticRequests.some(request => request.pathname.endsWith('/vendor/pose/ort-wasm-simd-threaded.wasm')));
            observations.realDepth = real;
            observations.depthModelSha256 = crypto.createHash('sha256').update(fs.readFileSync(DEPTH_MODEL)).digest('hex');
            assert.equal(observations.depthModelSha256, 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d');
            await recognize(page);
            await page.setViewport({ width: 390, height: 1000 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '独立UI壳390px溢出');
            await shot('real-da-depth-hmr-mock-390px'); await page.setViewport({ width: 900, height: 1100 });
            assert.equal(await page.$eval('[data-depth="assist"]', element => element.checked), false);
            await page.click('[data-pose="apply"]'); await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('已应用'));
            assert.equal(await page.evaluate(() => window.fixture.effects.at(-1).depthEnabled), false, '只计算深度不应暗中开启辅助');
        });

        await check('真实DA运行阶段取消终止专用Worker，换图清热图且旧结果不能进入新图', async () => {
            const before = await page.evaluate(() => ({ progress: window.depthObservations.progress.length, terminated: window.depthObservations.terminated,
                results: window.depthObservations.results.length, effects: structuredClone(window.fixture.effects), pose: JSON.stringify(window.fixture.pose) }));
            await page.click('[data-depth="compute"]');
            await page.waitForFunction(index => window.depthObservations.progress.slice(index).some(value => value.includes('计算当前整图相对深度')), { timeout: 180000, polling: 20 }, before.progress);
            await page.click('[data-depth="cancel"]');
            assert.match(await depthStatus(page), /取消/u);
            assert.equal(await page.evaluate(() => window.depthObservations.terminated), before.terminated + 1);
            await chooseImage(page, 480, 320, 1);
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
            assert.equal(await page.$eval('[data-depth="preview"]', element => element.hidden), true);
            assert.equal(await page.$eval('[data-depth="preview"]', element => element.width), 0);
            assert.equal(await page.evaluate(() => window.depthObservations.results.length), before.results);
            assert.deepEqual(await page.evaluate(() => window.fixture.effects), before.effects); assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.pose)), before.pose);
            observations.depthCancellation = { workerTerminated: true, stage: 'session.run实际计算进度之后', staleResultRejected: true };
        });

        await check('assist默认关闭及开关应用门禁；开启随识别计算真实深度，失败/取消互不冒充姿态', async () => {
            assert.equal(await page.$eval('[data-depth="assist"]', element => element.checked), false);
            await setField(page, 'depth', 'assist', true, 'change'); await recognize(page);
            assert.equal(await page.$eval('[data-pose="apply"]', element => element.disabled), true, '开启assist却无当前深度时不得应用');
            await setField(page, 'depth', 'assist', false, 'change');
            assert.equal(await page.$eval('[data-pose="apply"]', element => element.disabled), false, '关闭assist恢复主路径，不要求DA数据');
            await setField(page, 'depth', 'with-recognition', true, 'change');
            const beforeResults = await page.evaluate(() => window.depthObservations.results.length);
            await page.click('[data-pose="recognize"]');
            await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled, { timeout: 180000 });
            assert.match(await status(page), /识别完成.*BODY25/u);
            assert.match(await depthStatus(page), /整图相对深度完成/u);
            assert.equal(await page.evaluate(() => window.depthObservations.results.length), beforeResults + 1);
            await setField(page, 'depth', 'assist', true, 'change');
            assert.equal(await page.$eval('[data-pose="apply"]', element => element.disabled), false);
            await page.click('[data-pose="apply"]'); await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('已应用'));
            assert.equal(await page.evaluate(() => window.fixture.effects.at(-1).depthEnabled), true);
            observations.assist = { defaultOff: true, requiresCurrentDepth: true, actualWithRecognitionDepth: true,
                finalHintCount: await page.evaluate(() => window.fixture.effects.at(-1).hintCount) };
            await shot('real-depth-assist-gated-ui-stub');
        });

        await check('dispose清会话token，localStorage仅地址；资源与页面无错误、无公网请求', async () => {
            const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
            assert.ok(!JSON.stringify(storage).includes(SESSION_TOKEN));
            const before = await page.evaluate(() => window.depthObservations.terminated);
            await page.evaluate(() => window.fixture.ui.dispose());
            assert.equal(await page.$eval('[data-pose="api-token"]', element => element.value), '');
            assert.ok(await page.evaluate(() => window.depthObservations.terminated) > before);
            assert.deepEqual(errors, []); assert.deepEqual(fixture.failures, []);
            observations.storageKeys = Object.keys(storage); observations.consoleErrors = consoleErrors;
            observations.browserHttp = await page.evaluate(() => [...window.httpObservations]);
            // DevTools静态记录与HTTP fixture均仅允许当前loopback。Worker资产另由server记录，不用伪造网络响应。
            const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
            assert.ok(resources.every(url => new URL(url).origin === origin), JSON.stringify(resources));
        });
    } catch (error) {
        observations.failure = { message: error.message, stack: error.stack };
        if (page && !page.isClosed()) {
            try { observations.poseStatus = await status(page); observations.depthStatus = await depthStatus(page); await shot('failure'); }
            catch (captureError) { observations.captureFailure = captureError.message; }
        }
        throw error;
    } finally {
        const summarizedCalls = fixture.calls.map(call => ({ method: call.method, pathname: call.pathname, bodyLength: call.bodyLength,
            fields: call.payload ? Object.keys(call.payload).sort() : [], pngSize: call.pngSize, imageSize: [call.width, call.height],
            bbox: call.payload?.bbox_xyxy, closedBeforeResponse: call.closedBeforeResponse }));
        const hashes = Object.fromEntries(['web-human-pose-ui.mjs', 'web-human-depth-ui.mjs', 'web-human-hmr2-client.mjs',
            'web-human-pose-semantic.mjs', 'web-human-depth-core.mjs', 'web-human-depth-worker.mjs', 'web-human-depth-client.mjs']
            .map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(SOURCE, name))).digest('hex')]));
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ boundary: { human: 'UI stub，不代表真实PMX/FK',
            hmr: '同源HTTP mock，不代表GPU实推或生产Origin/CORS', depth: '真实源码Worker + ORT/WASM + 固定量化ONNX',
            server: '仅测试创建的临时127.0.0.1静态fixture；不操作用户服务器' }, observations, sourceHashes: hashes,
            httpCalls: summarizedCalls, staticRequests: fixture.staticRequests, pageErrors: errors, fixtureErrors: fixture.failures }, null, 2));
        t.diagnostic('独立UIstub/HTTPmock + 真实DA证据：' + path.relative(path.resolve(__dirname, '..'), output));
        await browser?.close(); fixture.releaseAll(); fixture.server.closeAllConnections(); await new Promise(resolve => fixture.server.close(resolve));
    }
});
