'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const chrome = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', require('puppeteer').executablePath()]
    .find(candidate => candidate && fs.existsSync(candidate));
const root = path.resolve(__dirname, '..');

// 使用真实WebGL2软件驱动验证shader、读回和资源生命周期，不用CPU替身冒充GPU测试。
test('WebGL XPBD：数值对照、形状接触、锚点关节、释放与上下文恢复', { skip: !chrome, timeout: 240000 }, async () => {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>'); return;
        }
        const file = path.resolve(root, '.' + decodeURIComponent(pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: chrome,
            headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        page.on('console', message => { if (message.type() === 'warn') console.log(message.text()); });
        await page.goto('http://127.0.0.1:' + server.address().port);
        const result = await page.evaluate(async () => {
            const T = await import('three');
            const { createWebglPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-webgl-physics.mjs');
            const { XpbdPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-physics.mjs');
            const { advancePmxMotionFrame } = await import('/src/apps/web-mediacenter/ui/public/js/mmd-pmx-helper.mjs');
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
            // 真实GPU纹理暂停同步：CPU镜像正确仍不足以证明恢复求解不会读回旧世界姿态。
            const paused = make([{ ...p, type: 0, boneIndex: 0, position: [1, 0, 0] },
                { ...p, position: [2, 0, 0] }], [{ ...joint, position: [1.5, 0, 0] }]);
            paused.physics.gravity.set(0, 0, 0);
            const pivot = new T.Group(); pivot.add(paused.physics.mesh); pivot.updateWorldMatrix(true, true);
            gpuStep(paused);
            const initial = paused.physics.bodies.map(body => body.position.clone());
            const gate = { paused: false };
            let helperUpdates = 0;
            const helper = { enabled: { physics: true, animation: false }, update(delta) {
                helperUpdates++; if (this.enabled.physics) paused.physics.update(delta);
            } };
            for (const angle of [.4, -.3, .2, .001]) {
                advancePmxMotionFrame({ delta: 1 / 60, pivot, helper, physics: paused.physics, physicsGate: gate,
                    rotationPhysicsLimit: 180, advanceRotation() { pivot.rotation.y += angle; return Math.abs(angle); } });
                paused.physics.bodies.forEach((body, index) => {
                    ensure(body.position.distanceTo(initial[index].clone().applyMatrix4(pivot.matrixWorld)) < 2e-5,
                        'GPU暂停期间位置必须同步');
                    ensure(body.velocity.length() === 0 && body.omega.length() === 0, 'GPU暂停没有残留速度');
                });
            }
            ensure(!gate.paused && !helper.enabled.animation && helperUpdates === 4, 'GPU恢复不得推进动作两次');
            const resumePositions = paused.physics.bodies.map(body => body.position.clone());
            const resumeState = gpuStep(paused);
            ensure(resumeState.readbacks === 1, 'GPU恢复首帧一次读回');
            paused.physics.bodies.forEach((body, index) => {
                ensure(body.position.distanceTo(resumePositions[index]) < 2e-5, 'GPU恢复不能读回旧位置');
                ensure(body.velocity.length() < .01 && body.omega.length() < .01, 'GPU恢复无旋转追赶冲量');
            });
            paused.dispose();
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

// 接触位置修正之后可能已分离；直接执行真实速度shader，独立验证单边约束而非照抄CPU实现。
test('WebGL接触速度：分离不注能、法向只推不拉、反弹与摩擦', { skip: !chrome, timeout: 60000 }, async t => {
    const server = http.createServer((request, response) => {
        const relative = new URL(request.url, 'http://localhost').pathname;
        if (relative === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>'); return;
        }
        const file = path.resolve(root, '.' + decodeURIComponent(relative));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end(); return;
        }
        response.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(file).pipe(response);
    });
    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
        const page = await browser.newPage();
        await page.goto('http://127.0.0.1:' + server.address().port);
        const samples = await page.evaluate(async () => {
            const T = await import('three');
            const { createGpuState } = await import('/3rd/mmd-ar-test/web-xpbd-webgl-state.mjs');
            const { contactSolve } = await import('/3rd/mmd-ar-test/web-xpbd-webgl-collision.mjs');
            const renderer = new T.WebGLRenderer(), gpu = createGpuState(renderer);
            const material = gpu.material(contactSolve), target = gpu.target(7);
            const cases = [
                { name: '关节已推开旧接触，不产生分离能量', gap: .1, velocity: [0, 0, 0], expected: [0, 0, 0] },
                { name: '间距允许以现有速度闭合', gap: .1, velocity: [-5, 0, 0], expected: [-5, 0, 0] },
                { name: '过快闭合只限制到间距时长下界', gap: .1, velocity: [-20, 0, 0], expected: [-10, 0, 0] },
                { name: '正在离开接触面不施加拉力', gap: 0, velocity: [3, 0, 0], expected: [3, 0, 0] },
                { name: '仍穿透时消除闭合速度', gap: -.01, velocity: [-1, 0, 0], expected: [0, 0, 0] },
                { name: '有效入射反弹保留恢复系数', gap: 0, velocity: [-3, 0, 0], incoming: -3, restitution: .5, expected: [1.5, 0, 0] },
                { name: '速度级摩擦保留lambda预算', gap: 0, velocity: [0, 2, 0], friction: .5, lambda: .01, expected: [0, 1.5, 0] },
                { name: '已分离的旧接触不继续施加摩擦', gap: .1, velocity: [0, 2, 0], friction: .5, lambda: .01, expected: [0, 2, 0] }
            ];
            try {
                return cases.map(sample => {
                    const state = new Float32Array(48), metadata = new Float32Array(56);
                    for (let i = 0; i < 2; i++) {
                        state[i * 24 + 7] = state[i * 24 + 23] = 1;
                        metadata.set([i, i === 0 ? 1 : 0, 0, 0], i * 28);
                        metadata.set([.1, .1, .1, 1], i * 28 + 8);
                        metadata.set([0, 0, sample.friction || 0, sample.restitution || 0], i * 28 + 12);
                    }
                    state[24] = sample.gap; state.set(sample.velocity, 32);
                    const contacts = new Float32Array(96), previous = new Float32Array(28);
                    // 保存先前窄相生成的局部接触点；关节修正后当前有间距，速度pass仍会见到这条记录。
                    contacts[3] = 1; contacts[7] = sample.incoming ?? sample.velocity[0]; contacts[8] = 1;
                    previous[16] = sample.lambda || 0;
                    const textures = [gpu.data(state), gpu.data(metadata), gpu.data(new Float32Array([0, 1, 0, 0])),
                        gpu.data(contacts), gpu.data(previous)];
                    try {
                        const output = new Float32Array(target.width * target.height * 4);
                        gpu.scope(() => {
                            gpu.draw(material, target, { uState: textures[0], uMeta: textures[1], uPairs: textures[2],
                                uContacts: textures[3], uPreviousCorrections: textures[4], uPairCount: 1,
                                uMode: 1, uH: .01, uGravity: new T.Vector3() });
                            renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, output);
                        });
                        if (renderer.getContext().getError() !== 0) throw new Error('接触速度shader GL错误');
                        return { ...sample, actual: sample.velocity.map((value, i) => value + output[8 + i]),
                            staticChange: Array.from(output.slice(0, 3)) };
                    } finally { for (const texture of textures) texture.dispose(); }
                });
            } finally { gpu.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
        });
        for (const sample of samples) await t.test(sample.name, () => {
            assert.deepEqual(sample.staticChange, [0, 0, 0], '静态刚体速度不可更改');
            sample.expected.forEach((value, i) => assert.ok(Math.abs(sample.actual[i] - value) < 1e-5, JSON.stringify(sample)));
        });
    } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
