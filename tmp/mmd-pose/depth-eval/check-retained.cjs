// 清理后的定向自检：只启动测试自己的临时HTTP服务，不接管用户服务器，不改推理结果。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { start } = require('./hmr2-sam3d/custom-report-server.cjs');
const root = __dirname;
const project = path.resolve(root, '../../..');
const hmr = path.join(root, 'hmr2-sam3d');
const rigid = path.join(root, 'rigid-projection');
const seg = path.join(rigid, 'person-seg');
let checks = 0;
function check(ok, description) { assert(ok, description); checks++; }
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
    const status = json(path.join(hmr, 'status.json'));
    const manifest = json(path.join(rigid, 'manifest.json'));
    for (const sample of status.samples) {
        check(fs.existsSync(sample.name ? json(path.join(hmr, 'sample-config.json')).samples.find((item) => item.name === sample.name).image : ''), '原图存在');
        check(manifest.images.some((item) => item.sha256 === sample.sha256), 'HMR与深度原图SHA对应');
    }
    for (const name of ['seated', 'anime', 'diagram', 'anime-wide', 'anime-shift-left', 'anime-shift-right', 'anime-mirror']) {
        const result = json(path.join(hmr, `results/hmr2-${name}.json`));
        check(result.xyz.length === 25 && result.xy.length === 25 && result.names.length === 25, '七份HMR BODY25结果完整');
        check(result.xyz.flat().every(Number.isFinite) && result.xy.flat().every(Number.isFinite), 'HMR原始坐标有限');
    }
    for (const file of ['inference.json', 'physics.json', 'leg-physics.json']) {
        const record = json(path.join(seg, file));
        for (const [protectedFile, digest] of Object.entries(record.protectedHashes || {})) {
            check(hash(fs.readFileSync(protectedFile)) === digest, '人物分割的历史输入摘要保持');
        }
    }
    const model = json(path.join(seg, 'model-manifest.json'));
    check(fs.statSync(path.join(seg, 'human_segmentation_pphumanseg_2023mar.onnx')).size === 6163938, 'PPHumanSeg权重保留');
    check(Boolean(model), '人物分割模型来源清单存在');
    const sources = [path.join(root, 'server.cjs'), path.join(root, 'serve-report.cjs'),
        ...fs.readdirSync(hmr).filter((name) => /\.(?:cjs|mjs)$/.test(name)).map((name) => path.join(hmr, name)),
        ...fs.readdirSync(seg).filter((name) => /\.(?:cjs|mjs)$/.test(name)).map((name) => path.join(seg, name)),
        ...['original-rig.mjs', 'rigid-pose-rig.mjs', 'rigid-pose-drive.mjs', 'projection-force.mjs', 'depth-inference.mjs'].map((name) => path.join(rigid, name)),
        ...['torso-depth.mjs', 'torso-drive.mjs', 'eval-torso.mjs'].map((name) => path.join(rigid, 'torso-depth', name))];
    for (const source of sources) {
        const text = fs.readFileSync(source, 'utf8');
        const references = [...text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)];
        for (const [, reference] of references) check(fs.existsSync(path.resolve(path.dirname(source), reference)), `相对模块存在：${reference}`);
    }
    for (const page of ['report.html', 'report-before-leg-correspondence.html']) {
        const text = fs.readFileSync(path.join(seg, page), 'utf8');
        check(!text.includes('../torso-depth/report.html'), '分割页没有已删除报告链接');
        check(text.includes('../../hmr2-sam3d/report.html'), '分割页链接保留HMR');
    }
    check(typeof require('./serve-report.cjs').startReport === 'function', '默认完整服务入口可载入且不自动启动');
    // 测试自身临时服务；HMR接口使用注入结果，数据完整性独立检查，不声称重新运行Python推理。
    const service = await start({ inferCustom: async () => ({ model: 'HMR2.0b', testOnly: true }) });
    let workerResult = null;
    try {
        const paths = ['/_depth/hmr2-sam3d/report.html', '/_depth/hmr2-sam3d/report.mjs', '/_depth/hmr2-sam3d/custom-depth.mjs',
            '/_depth/rigid-projection/person-seg/report.html', '/_depth/rigid-projection/person-seg/leg-report.html',
            '/_depth/rigid-projection/person-seg/report-before-leg-correspondence.html', '/_depth/rigid-projection/preprocessor_config.json',
            '/ort/ort.wasm.min.mjs', '/js/vendor/three/three.module.js', '/infer',
            ...['seated', 'anime', 'diagram'].flatMap((name) => [`/sample/${name}`, `/_depth/rigid-projection/${name}-depth.png`, `/_depth/hmr2-sam3d/results/hmr2-${name}.json`])];
        for (const pathname of paths) {
            const response = await fetch(service.url + pathname);
            check(response.status === 200, `保留资源HTTP200：${pathname}`);
            check((await response.arrayBuffer()).byteLength > 0, '保留资源非空');
        }
        const pose = await fetch(`${service.url}/js/vendor/pose/rtmpose-m-body7-384x288.onnx`);
        check(pose.status === 200, '人物分割RTMPose缓存路由200');
        check(hash(Buffer.from(await pose.arrayBuffer())) === hash(fs.readFileSync(path.join(project, '3rd/mmd-ar-test/model-cache/pose-onnx/rtmpose-m-body7-384x288.onnx'))), 'RTMPose响应与既有缓存一致');
        for (const pathname of ['/_depth/report.html', '/_depth/xyz-report.html', '/_depth/nlf-s/report.html', '/_depth/nlf-l/report.html',
            '/_depth/rigid-projection/report.html', '/_depth/rigid-projection/torso-depth/report.html', '/_depth/hmr2-sam3d/run-sam3d.py', '/mp-pose.onnx', '/mp-detector.onnx']) {
            const response = await fetch(service.url + pathname);
            check(response.status === 404, `旧独立入口已移除：${pathname}`); await response.arrayBuffer();
        }
        const bad = await fetch(`${service.url}/api/hmr2-custom`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Person-Box': '[0,0,0,1]' }, body: fs.readFileSync(path.join(rigid, 'seated-depth.png')) });
        check(bad.status === 400, '自选HMR接口仍校验非法人物框'); await bad.arrayBuffer();
        if (process.argv.includes('--worker')) {
            const puppeteer = require('puppeteer-core');
            let browser;
            try {
                browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, protocolTimeout: 180000 });
                const page = await browser.newPage(), errors = [], requests = [];
                page.on('pageerror', (error) => errors.push(error.message));
                page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
                await page.goto(`${service.url}/infer`);
                const items = json(path.join(root, 'inference-wasm.json')).samples.map((item) => ({ name: item.name, width: item.width, height: item.height, rtmpose: item.rtmpose }));
                workerResult = await page.evaluate((items) => new Promise((resolve, reject) => {
                    const worker = new Worker('/_depth/rigid-projection/person-seg/seg-worker.mjs', { type: 'module' });
                    worker.onerror = (error) => { worker.terminate(); reject(Error(error.message)); };
                    worker.onmessage = (event) => {
                        const message = event.data;
                        if (message.type === 'progress') return;
                        worker.terminate();
                        if (message.type !== 'result') { reject(Error(message.message)); return; }
                        const result = message.result;
                        resolve({ lifecycle: result.lifecycle, samples: result.samples.map((sample) => ({ name: sample.name, width: sample.width, height: sample.height,
                            maskPixels: sample.segmentation.mask.length, fraction: sample.analysis.fraction, structuralPass: sample.analysis.structuralPass,
                            variants: sample.variants.map((variant) => ({ id: variant.id, error: variant.error || null, baselineDifference: variant.baselineDifference,
                                finite: variant.pose?.landmarks.filter(Boolean).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) })) })) });
                    };
                    worker.postMessage({ type: 'run', id: 1, items });
                }), items);
                check(workerResult.samples.length === 3, '真实人物分割Worker三图完成');
                check(workerResult.lifecycle.sessionsCreated === 2 && workerResult.lifecycle.sessionsReleased === 2, '真实两模型session均释放');
                for (const sample of workerResult.samples) {
                    check(sample.maskPixels === sample.width * sample.height && sample.variants.length === 3, '真实原尺寸mask及三输入齐全');
                    check(sample.variants.every((variant) => !variant.error && variant.finite), '真实RTMPose九输入坐标有限');
                    check(sample.variants.find((variant) => variant.id === 'original').baselineDifference === 0, '真实原图RTMPose与保留缓存逐点一致');
                }
                const cancelled = await page.evaluate(() => new Promise((resolve, reject) => {
                    const worker = new Worker('/_depth/rigid-projection/person-seg/seg-worker.mjs', { type: 'module' });
                    worker.onerror = (error) => { worker.terminate(); reject(Error(error.message)); };
                    worker.onmessage = (event) => { if (event.data.type === 'progress') return; worker.terminate(); resolve(event.data.type); };
                    worker.postMessage({ type: 'run', id: 2, items: [] }); worker.postMessage({ type: 'cancel', id: 2 });
                }));
                check(cancelled === 'cancelled', '真实Worker仍支持运行中取消');
                check(errors.length === 0, '真实分割无页面异常');
                check(requests.every((request) => request.method === 'GET' && request.url.startsWith(service.url)), '真实分割仅请求本机GET，无图片上传');
            } finally { await browser?.close(); }
        }
    } finally {
        service.server.closeAllConnections(); service.upstream.closeAllConnections();
        await Promise.all([new Promise((resolve) => service.server.close(resolve)), new Promise((resolve) => service.upstream.close(resolve))]);
    }
    const result = { time: new Date().toISOString(), checks, pass: true, hmrPythonRerun: false, segmentationWorkerRerun: Boolean(workerResult), workerResult, originalResultsUnchanged: true };
    fs.writeFileSync(path.join(root, 'retained-check.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
