'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');

// 使用真实WebGL2软件驱动验证shader、读回和资源生命周期，不用CPU替身冒充GPU测试。
test('WebGL XPBD：数值对照、形状接触、锚点关节、释放与上下文恢复', { timeout: 240000 }, async () => {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>'); return;
        }
        const file = path.resolve(root, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
            headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        page.on('console', message => { if (message.type() === 'warn') console.log(message.text()); });
        await page.goto('http://127.0.0.1:' + server.address().port);
        const result = await page.evaluate(async () => {
            const T = await import('three');
            const { createWebglPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-webgl-physics.mjs');
            const { XpbdPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-physics.mjs');
            const renderer = new T.WebGLRenderer(); document.body.append(renderer.domElement);
            const p = { type: 1, boneIndex: -1, shapeType: 0, width: .1, height: .2, depth: .3, weight: 1,
                position: [0, 0, 0], rotation: [0, 0, 0], positionDamping: 0, rotationDamping: 0,
                friction: .5, restitution: 0, groupIndex: 0, groupTarget: 0 };
            const joint = { rigidBodyIndex1: 0, rigidBodyIndex2: 1, position: [0, 0, 0], rotation: [0, 0, 0],
                translationLimitation1: [0, 0, 0], translationLimitation2: [0, 0, 0],
                rotationLimitation1: [-.5, -.5, -.5], rotationLimitation2: [.5, .5, .5],
                springPosition: [1, 1, 1], springRotation: [1, 1, 1] };
            const make = (params = [p], joints = [], cpu = false) => {
                const mesh = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
                const bone = new T.Bone(); mesh.add(bone); mesh.bind(new T.Skeleton([bone]));
                const options = { renderer, gravity: new T.Vector3(0, -9.8, 0), stabilityReferenceHz: 3 };
                const physics = cpu ? new XpbdPmxPhysics(mesh, params, joints, options) : createWebglPmxPhysics(mesh, params, joints, options);
                return { physics, bone, dispose() { physics.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.skeleton.dispose(); } };
            };
            const ensure = (value, message) => { if (!value) throw new Error(message); };
            const gpuStep = (fixture, count = 1) => {
                for (let i = 0; i < count; i++) fixture.physics.update(1 / 60);
                const state = fixture.physics.getState();
                ensure(renderer.getContext().getError() === 0, 'GPU步进出现GL错误');
                ensure(state.solver === 'xpbd-webgl', '意外回退：' + state.fallbackReason);
                return state;
            };
            const cpu = make([p], [], true), gpu = make();
            cpu.physics.setWindSettings({ enabled: true, strength: 30, longitude: -90 });
            gpu.physics.setWindSettings({ enabled: true, strength: 30, longitude: -90 });
            for (let i = 0; i < 10; i++) { cpu.physics.update(1 / 60); gpuStep(gpu); }
            const error = gpu.physics.bodies[0].position.distanceTo(cpu.physics.bodies[0].position);
            ensure(error < 1e-4, '重力与风CPU对照误差：' + error);
            ensure(gpu.physics.getState().readbacks === 10, '每帧只能读回一次');
            gpu.physics.resetMotion(); ensure(gpu.physics.bodies[0].velocity.length() === 0, 'reset清速度');
            gpu.physics.setWindSettings({ enabled: false }); gpu.physics.gravity.set(0, 0, 0);
            const resetPosition = gpu.physics.bodies[0].position.clone(); gpuStep(gpu);
            ensure(gpu.physics.bodies[0].position.distanceTo(resetPosition) < 1e-6, 'GPU旧速度不能在reset后复活');
            const target = new T.WebGLRenderTarget(20, 20);
            renderer.setRenderTarget(target); renderer.setViewport(2, 3, 7, 8); renderer.setScissor(1, 2, 6, 9); renderer.setScissorTest(true);
            gpuStep(gpu);
            ensure(renderer.getRenderTarget() === target && renderer.getScissorTest(), '物理破坏渲染目标/裁剪');
            ensure(renderer.getViewport(new T.Vector4()).equals(new T.Vector4(2, 3, 7, 8)), '物理破坏视口');
            renderer.setRenderTarget(null); renderer.setScissorTest(false); target.dispose();
            gpu.dispose(); cpu.dispose();
            const shapeResults = [];
            for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
                const fixture = make([{ ...p, shapeType: a, groupTarget: 1 },
                    { ...p, type: 0, shapeType: b, groupTarget: 1, position: [.15, 0, 0] }]);
                const state = gpuStep(fixture);
                ensure(state.contacts > 0, '缺少形状接触：' + a + '/' + b);
                ensure(fixture.physics.bodies[0].position.x < -.001, '穿透未修正：' + a + '/' + b);
                shapeResults.push([a, b, state.contacts]); fixture.dispose();
            }
            const fixture = make([{ ...p, type: 0, boneIndex: 0 }, { ...p, position: [0, -.5, 0] }], [joint]);
            fixture.bone.position.x = .1; const jointState = gpuStep(fixture, 5);
            ensure(jointState.jointColors === 1, '关节着色未生效');
            ensure(Math.abs(fixture.physics.bodies[1].position.x) > .001, '锚点没有驱动关节'); fixture.dispose();
            const driven = make([{ ...p, type: 2, boneIndex: 0, position: [0, -.1, 0] }]);
            driven.bone.position.set(.2, .3, .4); gpuStep(driven);
            ensure(driven.physics.bodies[0].position.distanceTo(new T.Vector3(.2, .2, .4)) < 1e-5, 'type2位置必须跟随骨骼'); driven.dispose();
            const locked = make([{ ...p, type: 0, boneIndex: 0 }, { ...p, position: [0, -.5, 0] }],
                [{ ...joint, rotationLimitation1: [0, .2, 0], rotationLimitation2: [0, .2, 0] }]);
            locked.bone.position.x = .4;
            ensure(gpuStep(locked).anchoredBodyCount === 1, '全锁绑定未生效');
            ensure(Math.abs(locked.physics.bodies[1].quaternion.y - Math.sin(.1)) < 1e-5, '非零锁角错误'); locked.dispose();
            const before = { ...renderer.info.memory, programs: renderer.info.programs.length };
            for (let i = 0; i < 50; i++) { const item = make(); gpuStep(item); item.dispose(); }
            const after = { ...renderer.info.memory, programs: renderer.info.programs.length };
            ensure(JSON.stringify(before) === JSON.stringify(after), '50次切换资源增长：' + JSON.stringify({ before, after }));
            const fallback = createWebglPmxPhysics(new T.SkinnedMesh(), [], [], {});
            ensure(fallback.getState().solver === 'xpbd' && fallback.getState().fallbackReason, '无renderer必须明确CPU回退'); fallback.dispose();
            const recovered = make(); gpuStep(recovered);
            renderer.forceContextLoss(); await new Promise(resolve => setTimeout(resolve, 100));
            ensure(recovered.physics.getState().contextLost, '丢失上下文没有暂停');
            renderer.forceContextRestore(); await new Promise(resolve => setTimeout(resolve, 300));
            gpuStep(recovered); ensure(!recovered.physics.getState().contextLost, '恢复后仍暂停'); recovered.dispose();
            const glError = renderer.getContext().getError(); renderer.dispose();
            ensure(glError === 0, 'WebGL错误：' + glError);
            return { error, shapeResults, before, after, jointState };
        });
        assert.equal(result.shapeResults.length, 6);
        console.log('WebGL XPBD实测', JSON.stringify(result));
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
