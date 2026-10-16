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
            window.DisplayMmd.setCameraMotionPlaybackEnabled(false);
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
        const initialPose=await page.evaluate(()=>window.DisplayMmd.getHumanInterface().getImagePoseSnapshot());
        assert.ok(initialPose.points.length>=16 && initialPose.points.every(p=>p.world.every(Number.isFinite)));
        await page.click('[data-pose-overlay="enabled"]');
        await page.waitForFunction(()=>document.querySelector('[data-pose-overlay="scale"]').disabled===false);
        assert.equal(await page.evaluate(()=>window.DisplayMmd.getHumanInterface().getInteractiveIKState().enabled),false,'只看骨架不应自动启用IK');
        await page.click('[data-pose-overlay="enabled"]');
        // 复用本机参考文件作为图片粘贴载荷，后续ONNX/骨骼应用均使用这次导入的像素。
        assert.equal(await page.evaluate(() => {
            const file = document.querySelector('[data-pose="file"]').files[0], data = new DataTransfer(); data.items.add(file);
            const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
            document.body.dispatchEvent(event); return event.defaultPrevented;
        }), true, '全身IK展开时没有导入粘贴图片');
        await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
        await page.click('[data-pose="recognize"]');
        await page.waitForFunction(() => !document.querySelector('[data-pose="apply"]').disabled || /失败|未识别|无效|不匹配/u.test(document.querySelector('[data-pose="status"]').textContent), { timeout: 120000 });
        const recognized = await page.$eval('[data-pose="status"]', element => element.textContent);
        assert.match(recognized, /识别完成/u, recognized);
        assert.ok(Number(recognized.match(/(\d+)\/17/u)[1]) >= 12, recognized);
        const points = await page.evaluate(() => window.__observedImagePose.landmarks);
        // 固定公开参考图：面向镜头、双臂水平，人物左腕在画面右侧，右膝在画面左侧。
        assert.ok(points[15].x > 0.65 && points[16].x < 0.35, '真实图片左右腕映射不符');
        assert.ok(points[26].x < 0.45, '真实图片右膝映射不符');
        assert.equal(points.filter(Boolean).length, 17);
        assert.ok(points.filter(Boolean).every(p => p.world === undefined && p.source === 'rtmpose-m' && p.dimensions === 2), '二维结果伪造了world');
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
        // Off控制点随实际骨骼运动，只比较显式启用的目标坐标，同时仍检查所有状态。
        const before = applied.controls.map(({ key, target, positionState }) => ({ key, target: positionState === 'Off' ? null : target, positionState }));
        await page.click('[data-pose-overlay="match"]');
        await page.waitForFunction(()=>document.querySelector('[data-pose-overlay="cancel"]').disabled,{timeout:30000});
        const cameraStatus=await page.$eval('[data-pose-overlay="status"]',element=>element.textContent);
        t.diagnostic('真实参考图相机：'+cameraStatus);
        if(cameraStatus.includes('已匹配')) {
            await page.click('[data-pose-overlay="restore"]');
            assert.match(await page.$eval('[data-pose-overlay="status"]',element=>element.textContent),/已恢复/u);
        } else assert.match(cameraStatus,/误差|姿态|视角|相机/u);
        // 使用真实PMX实际骨骼，Three构造可验证的参考相机，验证运行时不是只改一帧或卡住手动旋转。
        const cameraRoundtrip=await page.evaluate(async()=>{
            const api=window.DisplayMmd.getHumanInterface(), T=await import('three');
            const {fitImageCamera}=await import('/js/web-human-pose-camera.mjs');
            const snapshot=api.getImagePoseSnapshot(), state=api.getImageCameraState(), body=snapshot.points.filter(p=>Number.isInteger(p.landmark));
            const center=new T.Vector3();for(const p of body)center.add(new T.Vector3().fromArray(p.world));center.divideScalar(body.length);
            const extent=Math.max(...[0,1,2].map(i=>Math.max(...body.map(p=>p.world[i]))-Math.min(...body.map(p=>p.world[i]))));
            const camera=new T.PerspectiveCamera(snapshot.view.fov,1.3,.001,100);
            camera.position.copy(center).add(new T.Vector3(extent*.8,extent*.3,extent*2.5));camera.lookAt(center);camera.rotateZ(.08);camera.updateMatrixWorld(true);
            const landmarks=Array.from({length:33},()=>({x:.5,y:.5,world:[0,0,0],visibility:0,presence:0}));
            for(const p of body){const n=new T.Vector3().fromArray(p.world).project(camera);landmarks[p.landmark]={x:(n.x+1)/2,y:(1-n.y)/2,world:[0,0,0],visibility:1,presence:1};}
            const fit=await fitImageCamera(snapshot,{landmarks,confidence:1},{aspect:1.3,maxPitch:state.maxPitch});
            api.applyImageCamera(fit.view,state.revision,snapshot.token);
            for(let i=0;i<10;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
            const matched=api.getImagePoseSnapshot().view.viewMatrix;
            const error=Math.max(...matched.map((v,i)=>Math.abs(v-fit.referenceView.viewMatrix[i])));
            window.DisplayMmd.setCameraViewRotation(fit.view.yaw+.1,fit.view.pitch);
            for(let i=0;i<25;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
            const moved=api.getImagePoseSnapshot().view.viewMatrix;
            api.restoreImageCamera();await new Promise(resolve=>requestAnimationFrame(resolve));
            const restored=api.getImagePoseSnapshot().view.viewMatrix;
            return {error,manualChanged:Math.max(...moved.map((v,i)=>Math.abs(v-matched[i]))),
                restoreError:Math.max(...restored.map((v,i)=>Math.abs(v-snapshot.view.viewMatrix[i]))),fitError:fit.error};
        });
        assert.ok(cameraRoundtrip.error<.001,JSON.stringify(cameraRoundtrip));
        assert.ok(cameraRoundtrip.manualChanged>.01,JSON.stringify(cameraRoundtrip));
        assert.ok(cameraRoundtrip.restoreError<.001,JSON.stringify(cameraRoundtrip));
        assert.deepEqual(await page.evaluate(()=>window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(({key,target,positionState})=>({key,target:positionState==='Off'?null:target,positionState}))),before,'相机匹配/恢复改变了人体目标');
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
        const after = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(({ key, target, positionState }) => ({ key, target: positionState === 'Off' ? null : target, positionState })));
        assert.deepEqual(after, before);
        // 用户图片只从本机环境变量指定的位置读取，不放入仓库或发送到外部服务。
        if (process.env.AASC_MMD_POSE_ANIME_IMAGE) {
            assert.ok(fs.existsSync(process.env.AASC_MMD_POSE_ANIME_IMAGE));
            await (await page.$('[data-pose="file"]')).uploadFile(process.env.AASC_MMD_POSE_ANIME_IMAGE);
            await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
            await page.click('[data-pose="recognize"]');
            await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled, { timeout: 90000 });
            const anime = await page.evaluate(() => window.__observedImagePose);
            assert.equal(anime.candidates.length, 1, '默认取景应明确为单人全图');
            assert.equal(anime.framing, 'full-image');
            assert.ok(anime.landmarks[0].x * 450 > 180 && anime.landmarks[0].x * 450 < 260
                && anime.landmarks[0].y * 407 > 75 && anime.landmarks[0].y * 407 < 160, '鼻点未回到女孩脸上');
            assert.ok(anime.landmarks[11].y < .5 && anime.landmarks[12].y < .5, '肩点落在裙摆');
            assert.equal(await page.$eval('[data-pose="candidate-row"]', element => element.hidden), true);
            const switched = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState().controls.map(({ key, target, positionState }) => ({ key, target: positionState === 'Off' ? null : target, positionState })));
            assert.deepEqual(switched, before, '仅识别预览不应立即改变身体目标');
            assert.match(await page.$eval('[data-pose="status"]', element => element.textContent), /低可信/u);
            await page.click('[data-pose="apply"]');
            await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('已应用'), { timeout: 20000 });
            const animeApplied = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getInteractiveIKState());
            assert.ok(animeApplied.activeTargets >= 6 && animeApplied.controls.every(control => control.target.every(Number.isFinite)));
            if (process.env.AASC_MMD_POSE_ANIME_SCREENSHOT) await page.screenshot({ path: process.env.AASC_MMD_POSE_ANIME_SCREENSHOT });
            t.diagnostic(`二次元图：${anime.candidates.length}候选，默认鼻点[${(anime.landmarks[0].x * 450).toFixed(1)},${(anime.landmarks[0].y * 407).toFixed(1)}]，身体${anime.quality.visible}/12；识别保持旧目标，应用${animeApplied.activeTargets}目标`);
        }
        const captureViews = async index => {
            const prefix = process.env.AASC_MMD_POSE_VIEWS_PREFIX;
            if (!prefix) return;
            const saved = await page.evaluate(() => {
                const panel = document.querySelector('#mmdArIKPanel'), state = JSON.parse(window.DisplayMmd.getHumanInterface().getImageCameraState().revision).state;
                const visibility = panel.style.visibility; panel.style.visibility = 'hidden'; return { state, visibility };
            });
            try {
                await page.screenshot({ path: prefix + index + '-front.png' });
                await page.evaluate(async state => {
                    window.DisplayMmd.setCameraViewRotation(state.yaw + Math.PI / 2, state.pitch);
                    for (let i = 0; i < 35; i++) await new Promise(resolve => requestAnimationFrame(resolve));
                }, saved.state);
                await page.screenshot({ path: prefix + index + '-side.png' });
            } finally {
                await page.evaluate(async saved => {
                    window.DisplayMmd.setCameraViewRotation(saved.state.yaw, saved.state.pitch);
                    document.querySelector('#mmdArIKPanel').style.visibility = saved.visibility;
                    for (let i = 0; i < 35; i++) await new Promise(resolve => requestAnimationFrame(resolve));
                }, saved);
            }
        };
        // 可选本机用户样本：检查真正应用后的骨架，不能只验证Worker预览或目标坐标。
        for (const [index, file] of JSON.parse(process.env.AASC_MMD_POSE_EXTRA_IMAGES || '[]').entries()) {
            assert.ok(fs.existsSync(file));
            await page.evaluate(() => window.DisplayMmd.getHumanInterface().resetInteractiveIK());
            await (await page.$('[data-pose="file"]')).uploadFile(file);
            await page.waitForFunction(() => document.querySelector('[data-pose="status"]').textContent.includes('图片已准备'));
            await page.click('[data-pose="recognize"]');
            await page.waitForFunction(() => !document.querySelector('[data-pose="recognize"]').disabled, { timeout: 90000 });
            assert.match(await page.$eval('[data-pose="status"]', el => el.textContent), /RTMPose-m/u);
            const original = await page.evaluate(() => window.DisplayMmd.getHumanInterface().getImagePoseSnapshot());
            await page.click('[data-pose="apply"]');
            await page.waitForFunction(() => document.querySelector('[data-pose="cancel"]').disabled, { timeout: 20000 });
            assert.match(await page.$eval('[data-pose="status"]', el => el.textContent), /已应用/u);
            const outcome = await page.evaluate(async original => {
                const api = window.DisplayMmd.getHumanInterface(), T = await import('three');
                let steps = 0;
                while (steps < 270) { await new Promise(resolve => requestAnimationFrame(resolve)); steps += api.getInteractiveIKState().physics.substeps; }
                const pose = window.__observedImagePose, actual = api.getImagePoseSnapshot();
                const length = (snapshot, a, b) => new T.Vector3().fromArray(snapshot.points.find(p => p.key === a).world)
                    .distanceTo(new T.Vector3().fromArray(snapshot.points.find(p => p.key === b).world));
                let boneError = 0;
                for (const side of ['left', 'right']) for (const [a, b] of [['Arm', 'Elbow'], ['Elbow', 'Wrist'], ['Leg', 'Knee'], ['Knee', 'Ankle']]) {
                    boneError = Math.max(boneError, Math.abs(length(actual, side + a, side + b) / length(original, side + a, side + b) - 1));
                }
                // 独立计算实际骨架的弱透视对齐残差，仅作诊断，不将模型分数当精度。
                const residual = snapshot => {
                    const view = new T.Matrix4().fromArray(snapshot.view.viewMatrix);
                    const pairs = snapshot.points.filter(p => Number.isInteger(p.landmark) && pose.landmarks[p.landmark]?.visibility >= .3).map(p => {
                        const v = new T.Vector3().fromArray(p.world).applyMatrix4(view), q = pose.landmarks[p.landmark];
                        return { x: v.x, y: v.y, u: (q.x - .5) * pose.imageAspect, v: .5 - q.y };
                    });
                    const mean = key => pairs.reduce((sum, p) => sum + p[key], 0) / pairs.length;
                    const x = mean('x'), y = mean('y'), u = mean('u'), v = mean('v');
                    const scale = pairs.reduce((sum, p) => sum + (p.x - x) * (p.u - u) + (p.y - y) * (p.v - v), 0)
                        / pairs.reduce((sum, p) => sum + (p.x - x) ** 2 + (p.y - y) ** 2, 0);
                    return Math.sqrt(pairs.reduce((sum, p) => sum + (scale * (p.x - x) + u - p.u) ** 2 + (scale * (p.y - y) + v - p.v) ** 2, 0) / pairs.length);
                };
                const controls = api.getInteractiveIKState().controls;
                const targetErrorsWorldUnits = controls.filter(c => c.positionState !== 'Off').map(c => ({ key: c.key,
                    error: new T.Vector3().fromArray(c.target).distanceTo(new T.Vector3().fromArray(c.achieved)) }));
                return { visible: pose.quality.visible, targets: api.getInteractiveIKState().activeTargets, boneError, targetErrorsWorldUnits,
                    actual, finite: actual.points.every(p => p.world.every(Number.isFinite)), before: residual(original), after: residual(actual) };
            }, original);
            assert.ok(outcome.finite && outcome.boneError < 1e-5, JSON.stringify(outcome));
            assert.ok(outcome.after < outcome.before, '实际求解骨架未改善投影：' + JSON.stringify(outcome));
            if (process.env.AASC_MMD_POSE_EXTRA_SCREENSHOT_PREFIX) {
                const data = await page.$eval('[data-pose="preview"]', canvas => canvas.toDataURL('image/png').split(',')[1]);
                fs.writeFileSync(process.env.AASC_MMD_POSE_EXTRA_SCREENSHOT_PREFIX + index + '.png', Buffer.from(data, 'base64'));
                fs.writeFileSync(process.env.AASC_MMD_POSE_EXTRA_SCREENSHOT_PREFIX + index + '.json', JSON.stringify(outcome, null, 2));
            }
            await captureViews(index);
            const { actual, ...summary } = outcome;
            t.diagnostic(`用户样本${index + 1}：${JSON.stringify(summary)}`);
        }
        assert.ok(requests.filter(request => request.url.includes('/vendor/pose/')).length >= 4);
        assert.ok(requests.every(request => request.method === 'GET'), '图片不应以POST或其他写请求上传');
        assert.deepEqual(errors, []);
        t.diagnostic(recognized + `；应用${applied.activeTargets}个目标；取消与无人图保持旧目标`);
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
