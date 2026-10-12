'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const puppeteer = require('puppeteer-core');
const CHROME = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', require('puppeteer').executablePath()]
    .find(candidate => candidate && fs.existsSync(candidate));
const ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');

test('真实PMX GPU骨骼直连：开关、播放暂停、诊断、编辑、上下文与生命周期', {
    skip: !CHROME || !fs.existsSync(ROOT), timeout: 300000
}, async () => {
    const failures = [];
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1) || 'index.html';
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        const mime = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
            '.html': 'text/html', '.wasm': 'application/wasm' };
        response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage(); await page.setViewport({ width: 640, height: 640 });
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
        // 页面加载失败时直接输出现有错误/状态，而不把“文件有函数名”当运行时修复成功。
        try {
            await page.waitForFunction(() => window.DisplayMmd?.getState().modelReady, { timeout: 90000 });
        } catch (error) {
            assert.fail(JSON.stringify({ failures, state: await page.evaluate(() => window.DisplayMmd?.getState()),
                text: await page.evaluate(() => document.body.innerText.slice(-1800)) }));
        }
        console.log('PMX已加载，开始切换WebGL');
        assert.equal(await page.$eval('#mmdArGpuBoneTexture', node => node.checked), false, '默认关闭');
        await page.evaluate(async () => {
            window.DisplayMmd.setMotionPlaybackEnabled(false);
            window.DisplayMmd.setPhysicsStabilityReference(3);
            await window.DisplayMmd.setPhysicsSolver('xpbd-webgl');
        });
        console.log('切换返回', await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState()));
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState()?.readbacks >= 2 || window.DisplayMmd.getPhysicsSolverState()?.fallbackReason, { timeout: 90000 });
        const state = await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState());
        assert.equal(state.solver, 'xpbd-webgl', JSON.stringify(state));
        assert.equal(state.computeBackend, 'webgl2'); assert.equal(state.fallbackReason, '');
        assert.ok(state.bodyCount > 10); assert.ok(state.candidates > 0); assert.ok(state.jointColors > 0);
        console.log('真实PMX WebGL状态', JSON.stringify(state));
        await page.evaluate(() => {
            document.getElementById('mmdArMotionPanel').hidden = false;
            document.getElementById('mmdArGpuBoneTexture').click();
        });
        await page.waitForFunction(() => /手部防穿模/.test(document.getElementById('mmdArGpuBoneTextureStatus').textContent));
        const compatibility = await page.evaluate(() => ({
            state: window.DisplayMmd.getPhysicsSolverState(),
            avoidance: window.DisplayMmd.getHumanInterface().getArmAvoidanceState().enabled,
            saved: localStorage.getItem('aasc.mmdArTest.gpuPhysicsBoneTexture.v1')
        }));
        assert.equal(compatibility.avoidance, true, '手部防穿模默认开启');
        assert.equal(compatibility.state.directActive, false);
        assert.equal(compatibility.saved, 'true');
        assert.match(compatibility.state.directCompatibilityReason, /手部防穿模/);
        await page.evaluate(() => {
            window.DisplayMmd.getHumanInterface?.()?.setArmAvoidanceEnabled(false);
            window.DisplayMmd.setGpuPhysicsBoneTextureEnabled(true);
        });
        await page.waitForFunction(() => {
            const state = window.DisplayMmd.getPhysicsSolverState();
            return state?.directActive || state?.directReason || state?.fallbackReason;
        }, { timeout: 90000 });
        const direct = await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState());
        assert.equal(direct.directActive, true, JSON.stringify(direct));
        const readbacks = direct.readbacks;
        await page.evaluate(() => window.DisplayMmd.setMotionPlaybackEnabled(false));
        await page.waitForFunction(count => {
            const state = window.DisplayMmd.getPhysicsSolverState();
            return state?.directActive && state.readbacks === count && state.passCount > 0;
        }, { timeout: 90000 }, readbacks);
        const stopped = await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState());
        assert.equal(stopped.readbacks, readbacks, '动作暂停后不应逐帧完整回读');
        // 计数真正发生的物理帧，同时观测renderer读回调用；不以瞬时状态当作连续帧验证。
        await page.evaluate(() => {
            const context = window.DisplayMmd.getEditorBridge().context;
            const physics = context.helper.objects.get(context.mesh).physics;
            const evidence = { context, physics, frames: 0, reads: 0 };
            const update = physics.update.bind(physics), read = context.renderer.readRenderTargetPixels.bind(context.renderer);
            physics.update = (...args) => { evidence.frames++; return update(...args); };
            context.renderer.readRenderTargetPixels = (...args) => { evidence.reads++; return read(...args); };
            window.__directAcceptance = evidence;
        });
        for (const animated of [true, false]) {
            const continuous = await page.evaluate(async value => {
                const api = window.DisplayMmd, evidence = window.__directAcceptance;
                api.setMotionPlaybackEnabled(value);
                const before = { frames: evidence.frames, reads: evidence.reads, readbacks: api.getPhysicsSolverState().readbacks };
                for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve));
                return { before, frames: evidence.frames, reads: evidence.reads, state: api.getPhysicsSolverState() };
            }, animated);
            assert.ok(continuous.frames >= continuous.before.frames + 3, JSON.stringify(continuous));
            assert.equal(continuous.state.directActive, true);
            assert.equal(continuous.state.readbacks, continuous.before.readbacks, '播放/暂停连续帧不完整回读');
            assert.equal(continuous.reads, continuous.before.reads, '真实renderer读回调用保持不变');
        }
        // 使用公开诊断API，不改复选框；CPU Overlay也必须得到本帧姿态。
        const apiDiagnostic = await page.evaluate(() => {
            const before = window.DisplayMmd.getPhysicsSolverState().readbacks;
            window.DisplayMmd.setSkeletonVisible(true);
            return { before, after: window.DisplayMmd.getPhysicsSolverState() };
        });
        assert.equal(apiDiagnostic.after.directActive, false, '诊断API应立即同步并解除直连');
        assert.equal(apiDiagnostic.after.readbacks, apiDiagnostic.before + 1);
        await page.waitForFunction(count => {
            const state = window.DisplayMmd.getPhysicsSolverState();
            return !state.directActive && state.readbacks >= count + 2 && /诊断/.test(state.directCompatibilityReason);
        }, {}, apiDiagnostic.after.readbacks);
        await page.evaluate(() => window.DisplayMmd.setSkeletonVisible(false));
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        for (const id of ['mmdArSkeletonEnabled', 'mmdArRigidBodyEnabled']) {
            await page.evaluate(control => document.getElementById(control).click(), id);
            await page.waitForFunction(() => !window.DisplayMmd.getPhysicsSolverState().directActive);
            await page.evaluate(control => document.getElementById(control).click(), id);
            await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        }
        const editorRead = await page.evaluate(() => {
            const before = window.DisplayMmd.getPhysicsSolverState().readbacks;
            window.DisplayMmd.getEditorBridge().read();
            return { before, after: window.DisplayMmd.getPhysicsSolverState() };
        });
        assert.equal(editorRead.after.readbacks, editorRead.before + 1, '编辑读取需单次同步CPU骨树');
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        const reset = await page.evaluate(() => {
            window.DisplayMmd.getEditorBridge().rest();
            const evidence = window.__directAcceptance;
            return { state: window.DisplayMmd.getPhysicsSolverState(),
                bound: evidence.context.mesh.skeleton.boneTexture?.isRenderTargetTexture === true,
                velocities: evidence.physics.bodies.every(body => body.velocity.lengthSq() === 0 && body.omega.lengthSq() === 0) };
        });
        assert.equal(reset.bound, false, 'T Pose解绑GPU调色板');
        assert.equal(reset.velocities, true);
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        const explicit = await page.evaluate(() => {
            const before = window.DisplayMmd.getPhysicsSolverState().readbacks;
            const { context, physics } = window.__directAcceptance;
            const target = physics.solver.getDirectBoneTarget();
            const palette = new Float32Array(target.width * target.height * 4);
            // 验收专用读取调色板，不属于普通预览物理读回；随后与同一时刻CPU回写比较。
            context.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, palette);
            const synced = window.DisplayMmd.syncGpuPhysicsPose();
            context.mesh.updateWorldMatrix(true, true); context.mesh.skeleton.update();
            let maximum = 0;
            for (let i = 0; i < context.mesh.skeleton.bones.length * 16; i++) {
                maximum = Math.max(maximum, Math.abs(palette[i] - context.mesh.skeleton.boneMatrices[i]));
            }
            return { before, synced, maximum, after: window.DisplayMmd.getPhysicsSolverState() };
        });
        assert.equal(explicit.synced, true);
        assert.equal(explicit.after.readbacks, explicit.before + 1);
        assert.ok(explicit.maximum < .001, '真实PMX GPU/CPU骨骼矩阵差异：' + explicit.maximum);
        console.log('真实PMX骨骼矩阵最大误差', explicit.maximum);
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        await page.evaluate(() => {
            window.DisplayMmd.setVisible(false);
            window.__directAcceptance.context.renderer.forceContextLoss();
        });
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().contextLost);
        assert.equal(await page.evaluate(() => window.__directAcceptance.context.mesh.skeleton.boneTexture?.isRenderTargetTexture === true), false);
        await page.evaluate(() => window.__directAcceptance.context.renderer.forceContextRestore());
        await page.waitForFunction(() => !window.DisplayMmd.getPhysicsSolverState().contextLost);
        const restored = await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState());
        assert.equal(restored.fallbackReason, '', JSON.stringify(restored));
        assert.equal(restored.readbacks, 0, '无法读取丢失GPU姿态时显式重置');
        await page.evaluate(() => window.DisplayMmd.setVisible(true));
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        console.log('真实PMX直连恢复', JSON.stringify(await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState())));
        const synchronized = await page.evaluate(() => {
            const before = window.DisplayMmd.getPhysicsSolverState().readbacks;
            window.DisplayMmd.setGpuPhysicsBoneTextureEnabled(false);
            return { before, after: window.DisplayMmd.getPhysicsSolverState() };
        });
        assert.equal(synchronized.after.directActive, false);
        assert.equal(synchronized.after.readbacks, synchronized.before + 1, '关闭开关需单次同步');
        await page.evaluate(() => window.DisplayMmd.setGpuPhysicsBoneTextureEnabled(true));
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        for (let i = 0; i < 2; i++) {
            await page.evaluate(() => {
                const context = window.DisplayMmd.getEditorBridge().context;
                window.__oldDirectPhysics = context.helper.objects.get(context.mesh).physics;
                window.__oldDirectMesh = context.mesh;
            });
            await page.evaluate(() => window.DisplayMmd.setPhysicsSolver('xpbd'));
            assert.equal(await page.evaluate(() => window.__oldDirectPhysics.disposed), true, '旧物理实例释放');
            assert.equal(await page.evaluate(() => window.__oldDirectMesh.skeleton.boneTexture?.isRenderTargetTexture === true), false);
            await page.evaluate(() => window.DisplayMmd.setPhysicsSolver('xpbd-webgl'));
            await page.evaluate(() => window.DisplayMmd.getHumanInterface().setArmAvoidanceEnabled(false));
            await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
            assert.equal(await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState().fallbackReason), '');
        }
        await page.evaluate(() => window.DisplayMmd.setPhysicsEnabled(false));
        assert.equal(await page.evaluate(() => window.DisplayMmd.getPhysicsSolverState().active), false);
        await page.evaluate(() => window.DisplayMmd.setPhysicsEnabled(true));
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        assert.equal(await page.evaluate(() => window.DisplayMmd.restoreDefaultMotion()), true);
        await page.waitForFunction(() => window.DisplayMmd.getPhysicsSolverState().directActive);
        const screenshot = path.join(os.tmpdir(), 'mmd-webgl-direct-lifecycle-20261012.png');
        await page.screenshot({ path: screenshot });
        console.log('直连生命周期截图', screenshot);
        await page.evaluate(() => window.DisplayMmd.setPhysicsSolver('xpbd'));
        assert.equal(await page.evaluate(() => window.DisplayMmd.getPhysicsSolver()), 'xpbd');
        assert.deepEqual(failures, []);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
