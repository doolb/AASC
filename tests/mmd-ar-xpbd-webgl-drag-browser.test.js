'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const CHROME = [process.env.CHROMIUM_PATH, require('puppeteer').executablePath(), '/usr/bin/chromium']
    .find(candidate => candidate && fs.existsSync(candidate));
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
// 默认逐配置验收；排查累计状态时显式设为1，保留连续切换后的姿态/速度，不用重置掩盖异常。
const ACCUMULATE = process.env.MMD_DRAG_ACCUMULATE === '1';
const SUBSTEPS = process.env.MMD_DRAG_SUBSTEPS
    ? [Number(process.env.MMD_DRAG_SUBSTEPS)] : [3, 45];
assert.ok(SUBSTEPS.every(value => value === 3 || value === 45), '拖动测试子步只能选3或45');
const DIRECT_MODES = process.env.MMD_DRAG_DIRECT_ONLY === '1' ? [true] : [true, false];
const RUN_LABEL = `${ACCUMULATE ? 'cumulative' : 'independent'}-${SUBSTEPS.join('-')}${DIRECT_MODES.length === 1 ? '-direct' : ''}`;

test(`真实PMX${ACCUMULATE ? '累计' : '独立配置'}拖动：鼠标/触摸、${SUBSTEPS.join('/')}子步、播放/暂停、${DIRECT_MODES.length === 1 ? '直连' : '直连/同步'}无飞散`, {
    skip: !CHROME || !fs.existsSync(ROOT), timeout: 900000
}, async () => {
    const failures = [], evidence = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html';
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
            '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 800, height: 700 });
        page.on('pageerror', error => failures.push(error.message));
        await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'domcontentloaded', timeout: 120000 });
        try {
            await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        } catch (error) {
            assert.fail(JSON.stringify({ failures, state: await page.evaluate(() => window.DisplayMmd?.getState()),
                text: await page.evaluate(() => document.body.innerText.slice(-1800)) }));
        }
        await page.evaluate(async () => {
            // 从正常播放姿态进入验收，避免人为从静止T Pose跳入VMD第0帧混入拖动场景。
            window.DisplayMmd.setMotionPlaybackEnabled(true);
            window.DisplayMmd.setPhysicsStabilityReference(3);
            await window.DisplayMmd.setPhysicsSolver('xpbd-webgl');
            window.DisplayMmd.getHumanInterface().setArmAvoidanceEnabled(false);
            window.DisplayMmd.setGpuPhysicsBoneTextureEnabled(true);
        });
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive, { timeout: 90000 });
        await page.evaluate(() => {
            // 仅控制实际renderFrame的调度/时钟，保留原渲染、helper、输入事件与真正GPU物理。
            // 不让SwiftShader的等待时长随机改变测试步长，也不手动调用求解器替代页面链路。
            const context = window.DisplayMmd.getEditorBridge().context;
            const nativeRequest = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
            const harness = { context, pending: null, nextId: 1000000000, now: performance.now(), reads: 0, deltas: [], updates: 0, trace: [] };
            window.__mmdDragHarness = harness;
            const physics = context.helper.objects.get(context.mesh).physics, update = physics.update.bind(physics);
            physics.update = delta => { if (delta > 0) harness.updates++; return update(delta); };
            const read = context.renderer.readRenderTargetPixels.bind(context.renderer);
            context.renderer.readRenderTargetPixels = (...args) => { harness.reads++; return read(...args); };
            window.requestAnimationFrame = callback => {
                if (callback.name !== 'renderFrame') return nativeRequest(callback);
                const id = ++harness.nextId; harness.pending = { id, callback }; return id;
            };
            window.cancelAnimationFrame = id => {
                if (harness.pending?.id === id) harness.pending = null;
                else nativeCancel(id);
            };
            harness.step = () => {
                const pending = harness.pending;
                if (!pending) throw new Error('缺少真实页面渲染帧');
                harness.pending = null; harness.now += 1000 / 60; pending.callback(harness.now);
                const physics = context.helper.objects.get(context.mesh).physics;
                harness.deltas.push(physics.frameDelta);
                // 累计异常的诊断只观察同步帧已有CPU数据，不新增物理读回。
                if (!physics.getState().directActive) {
                    let speed = 0, targetDelta = 0, targetAngle = 0;
                    for (const body of physics.bodies) {
                        speed = Math.max(speed, body.velocity.length());
                        if (body.params.type !== 0 && !body.positionDriven) continue;
                        targetDelta = Math.max(targetDelta, body.targetPosition.distanceTo(body.previousTargetPosition));
                        targetAngle = Math.max(targetAngle, body.targetQuaternion.angleTo(body.previousTargetQuaternion));
                    }
                    harness.trace.push({ speed, targetDelta, targetAngle, enabled: context.helper.enabled.physics });
                    harness.trace = harness.trace.slice(-8);
                }
            };
            harness.snapshot = () => {
                const { mesh, helper, renderer, THREE: T, currentPivot } = context;
                const physics = helper.objects.get(mesh).physics;
                // 场景诊断边界才同步一次；不能使用已缓存的SkinnedMesh boundingBox判断衣料实际顶点。
                physics.syncGpuPose(); mesh.updateWorldMatrix(true, true); mesh.skeleton.update();
                const center = currentPivot.getWorldPosition(new T.Vector3());
                const vertex = new T.Vector3(); let radius = 0;
                for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
                    mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
                    if (!vertex.toArray().every(Number.isFinite)) throw new Error('蒙皮顶点非有限');
                    radius = Math.max(radius, vertex.distanceTo(center));
                }
                let bodyRadius = 0, speed = 0;
                for (const body of physics.bodies) {
                    bodyRadius = Math.max(bodyRadius, body.position.distanceTo(center)); speed = Math.max(speed, body.velocity.length());
                }
                return { radius, bodyRadius, speed, deltas: harness.deltas.slice(-6), trace: harness.trace,
                    state: physics.getState(), glError: renderer.getContext().getError() };
            };
        });
        await page.waitForFunction(() => window.__mmdDragHarness.pending, { timeout: 30000 });
        await page.evaluate(() => { window.__mmdDragHarness.now = performance.now(); });
        const step = count => page.evaluate(value => { for (let i = 0; i < value; i++) window.__mmdDragHarness.step(); }, count);
        const checkOrdinaryFrames = async direct => {
            const result = await page.evaluate(value => {
                const harness = window.__mmdDragHarness;
                const object = harness.context.helper.objects.get(harness.context.mesh);
                const before = { reads: harness.reads, updates: harness.updates,
                    motion: object.mixer?.time, readbacks: window.DisplayMmd.getPhysicsSolverState().readbacks };
                harness.step(); harness.step();
                return { before, reads: harness.reads, updates: harness.updates,
                    motion: object.mixer?.time, animated: window.DisplayMmd.getState().motionPlaybackEnabled,
                    state: window.DisplayMmd.getPhysicsSolverState(), direct: value, deltas: harness.deltas.slice(-2) };
            }, direct);
            assert.equal(result.state.solver, 'xpbd-webgl', JSON.stringify(result));
            assert.equal(result.state.directActive, direct, JSON.stringify(result));
            assert.equal(result.updates - result.before.updates, 2, '两个普通帧均调用真实物理更新');
            assert.ok(result.state.passCount > 0);
            assert.ok(result.deltas.every(delta => Math.abs(delta - 1 / 60) < 1e-6), JSON.stringify(result.deltas));
            if (result.animated) assert.ok(result.motion > result.before.motion, '播放时真实mixer时间推进');
            else assert.equal(result.motion, result.before.motion, '暂停时真实mixer时间不变');
            assert.equal(result.reads - result.before.reads, direct ? 0 : 2, '普通帧真实读回次数');
            assert.equal(result.state.readbacks - result.before.readbacks, direct ? 0 : 2);
        };
        const snapshot = async label => {
            const result = await page.evaluate(() => window.__mmdDragHarness.snapshot());
            if (!(result.radius < 60 && result.bodyRadius < 60 && result.speed < 2500)) {
                const failureImage = path.join(os.tmpdir(), `mmd-webgl-drag-${RUN_LABEL}-failure-20261012.png`);
                await page.screenshot({ path: failureImage }); console.log('累计/拖动异常截图', failureImage);
            }
            assert.ok(result.radius < 60 && result.bodyRadius < 60 && result.speed < 2500, label + ': ' + JSON.stringify(result));
            assert.equal(result.glError, 0, label); evidence.push({ label, ...result });
            console.log('拖动检查', label, JSON.stringify({ radius: result.radius, bodyRadius: result.bodyRadius, speed: result.speed }));
        };
        const client = await page.createCDPSession();
        await snapshot('拖动前');
        const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const pose = () => page.evaluate(() => {
            const pivot = window.__mmdDragHarness.context.currentPivot;
            return { position: pivot.position.toArray(), quaternion: pivot.quaternion.toArray() };
        });
        const assertMoved = (before, after, rotation, label) => {
            const field = rotation ? 'quaternion' : 'position';
            const distance = before[field].reduce((sum, value, i) => sum + (value - after[field][i]) ** 2, 0);
            assert.ok(distance > 1e-8, label + '输入必须实际改变角色枢轴');
        };
        let direction = 1;
        for (const steps of SUBSTEPS) for (const animated of [false, true]) for (const direct of DIRECT_MODES) {
            const label = `${steps}子步/${animated ? '播放' : '暂停'}/${direct ? '直连' : '同步'}`;
            await page.evaluate(settings => {
                window.DisplayMmd.setPhysicsStabilityReference(settings.steps);
                window.DisplayMmd.setMotionPlaybackEnabled(settings.animated);
                window.DisplayMmd.setGpuPhysicsBoneTextureEnabled(settings.direct);
                // 各配置独立从当前骨姿态开始，避免上一组旋转与切换模式的残余状态混入本组拖动。
                const context = window.__mmdDragHarness.context;
                if (!settings.accumulate) context.helper.objects.get(context.mesh).physics.reset();
            }, { steps, animated, direct, accumulate: ACCUMULATE });
            await step(1);
            assert.equal(await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState().frameSubsteps), steps);
            // 鼠标右键平移、左键旋转，触摸双指平移、单指旋转均走真实输入监听。
            let beforePose = await pose();
            await page.mouse.move(380, 430); await page.mouse.down({ button: 'right' });
            for (let i = 1; i <= 3; i++) {
                await page.mouse.move(380 + direction * i * 30, 430 - direction * i * 8); await step(1);
            }
            assert.equal(await page.$eval('#displayMmdCanvas', node => node.classList.contains('is-translating')), true);
            await page.mouse.up({ button: 'right' });
            await checkOrdinaryFrames(direct); assertMoved(beforePose, await pose(), false, label + '/鼠标平移');
            await snapshot(label + '/鼠标平移');
            beforePose = await pose();
            await page.mouse.move(380, 430); await page.mouse.down();
            for (let i = 1; i <= 3; i++) {
                await page.mouse.move(380 + direction * i * 30, 430 + i * 6); await step(1);
            }
            assert.equal(await page.$eval('#displayMmdCanvas', node => node.classList.contains('is-dragging')), true);
            await page.mouse.up();
            await step(1); await checkOrdinaryFrames(direct); assertMoved(beforePose, await pose(), true, label + '/鼠标旋转');
            await snapshot(label + '/鼠标旋转');
            beforePose = await pose();
            await touch('touchStart', [{ id: 1, x: 330, y: 420 }, { id: 2, x: 410, y: 420 }]);
            for (let i = 1; i <= 3; i++) {
                await touch('touchMove', [{ id: 1, x: 330 - direction * i * 30, y: 420 + direction * i * 8 },
                    { id: 2, x: 410 - direction * i * 30, y: 420 + direction * i * 8 }]); await step(1);
            }
            await touch('touchEnd', []);
            await step(1); await checkOrdinaryFrames(direct); assertMoved(beforePose, await pose(), false, label + '/触摸平移');
            await snapshot(label + '/触摸平移');
            beforePose = await pose();
            await touch('touchStart', [{ id: 3, x: 380, y: 430 }]);
            for (let i = 1; i <= 3; i++) {
                await touch('touchMove', [{ id: 3, x: 380 - direction * i * 30, y: 430 - i * 6 }]); await step(1);
            }
            assert.equal(await page.$eval('#displayMmdCanvas', node => node.classList.contains('is-dragging')), true);
            await touch('touchEnd', []);
            await step(1); await checkOrdinaryFrames(direct); assertMoved(beforePose, await pose(), true, label + '/触摸旋转');
            await snapshot(label + '/触摸旋转');
            console.log('PMX拖动验收', label, JSON.stringify(evidence.slice(-4).map(({ label, radius, bodyRadius, speed }) => ({ label, radius, bodyRadius, speed }))));
            direction *= -1;
        }
        await step(1);
        const screenshot = path.join(os.tmpdir(), `mmd-webgl-drag-${RUN_LABEL}-20261012.png`);
        await page.screenshot({ path: screenshot }); console.log('拖动修复截图', screenshot);
        assert.deepEqual(failures, []);
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
