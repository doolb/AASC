'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer');
const THREE = require('three');
const root = path.resolve(__dirname, '..');
const chrome = puppeteer.executablePath();

const params = (type, boneIndex, position = [0, 0, 0]) => ({ type, boneIndex, shapeType: 0,
    width: .1, height: .2, depth: .3, weight: 1, position, rotation: [0, 0, 0],
    positionDamping: 0, rotationDamping: 0, friction: .5, restitution: 0, groupIndex: 0, groupTarget: 0 });

// 拓扑回退是可见功能：不支持的同骨写入和父后子先不能静默简化为“最后一个刚体覆盖”。
test('GPU直连骨骼拓扑明确拒绝多刚体/逆序及额外缩放', async () => {
    const { inspectDirectBoneTopology } = await import('../3rd/mmd-ar-test/web-xpbd-webgl-bones.mjs');
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const parent = new THREE.Bone(), child = new THREE.Bone(); mesh.add(parent); parent.add(child);
    mesh.bind(new THREE.Skeleton([parent, child]));
    const body = (type, boneIndex) => ({ params: { type, boneIndex } });
    assert.equal(inspectDirectBoneTopology(mesh, [body(1, 0), body(2, 1)]).reason, undefined);
    assert.match(inspectDirectBoneTopology(mesh, [body(1, 1), body(2, 1)]).reason, /多个/);
    assert.match(inspectDirectBoneTopology(mesh, [body(1, 1), body(2, 0)]).reason, /先写子骨/);
    child.scale.set(1, 2, 1);
    assert.match(inspectDirectBoneTopology(mesh, [body(1, 0)]).reason, /缩放骨骼/);
    mesh.skeleton.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('真实WebGL2直连骨骼纹理：type1/type2、暂停/模型缩放与切换逐帧读回',
    { skip: !fs.existsSync(chrome), timeout: 180000 }, async () => {
        const server = http.createServer((request, response) => {
            const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
            if (pathname === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
                return;
            }
            const file = path.resolve(root, '.' + decodeURIComponent(pathname));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                response.writeHead(404).end(); return;
            }
            response.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream');
            fs.createReadStream(file).pipe(response);
        });
        let browser;
        try {
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            browser = await puppeteer.launch({ executablePath: chrome, headless: true,
                args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.stack || error.message));
            await page.goto('http://127.0.0.1:' + server.address().port);
            const result = await page.evaluate(async () => {
                const T = await import('three');
                const { createWebglPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-webgl-physics.mjs');
                const { XpbdPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-physics.mjs');
                const renderer = new T.WebGLRenderer({ antialias: false });
                let allReads = 0;
                const actualRead = renderer.readRenderTargetPixels.bind(renderer);
                renderer.readRenderTargetPixels = (...args) => { allReads++; return actualRead(...args); };
                const base = (type, boneIndex) => ({ type, boneIndex, shapeType: 0, width: .1, height: .2, depth: .3,
                    weight: 1, position: [0, 0, 0], rotation: [0, 0, 0], positionDamping: 0,
                    rotationDamping: 0, friction: .5, restitution: 0, groupIndex: 0, groupTarget: 0 });
                const make = (cpu, withType2 = false, scaled = false, followerType = 2) => {
                    const mesh = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
                    const bones = [new T.Bone(), new T.Bone(), new T.Bone()];
                    mesh.add(bones[0]); bones[0].add(bones[1]); bones[1].add(bones[2]);
                    bones[1].position.y = 1; bones[2].position.y = .4;
                    mesh.bind(new T.Skeleton(bones));
                    const pivot = new T.Group(); if (scaled) pivot.scale.set(1.3, 1.3, 1.3); pivot.add(mesh);
                    const bodyParams = [base(1, 1)]; if (withType2) bodyParams.push(base(followerType, 2));
                    const options = { renderer, gravity: new T.Vector3(0, -9.8, 0), stabilityReferenceHz: 3 };
                    const physics = cpu ? new XpbdPmxPhysics(mesh, bodyParams, [], options)
                        : createWebglPmxPhysics(mesh, bodyParams, [], options);
                    return { mesh, bones, pivot, physics, dispose() { physics.dispose(); mesh.skeleton.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); } };
                };
                const run = (withType2, scaled) => {
                    const cpu = make(true, withType2, scaled), gpu = make(false, withType2, scaled);
                    gpu.physics.setDirectBoneTexture(true);
                    gpu.physics.setDirectPoseAnimated(false);
                    const samples = [];
                    try {
                        for (let i = 0; i < 7; i++) {
                            if (i === 3) {
                                cpu.pivot.rotation.y = .15; gpu.pivot.rotation.y = .15;
                                cpu.pivot.updateWorldMatrix(true, true); gpu.pivot.updateWorldMatrix(true, true);
                            }
                            if (i === 4) { cpu.physics.resetAnchorInterpolation(); gpu.physics.resetAnchorInterpolation(); }
                            const before = allReads;
                            cpu.physics.update(1 / 60); gpu.physics.update(1 / 60);
                            const state = gpu.physics.getState();
                            if (state.solver !== 'xpbd-webgl' || !state.directActive) throw new Error('未进入直连：' + JSON.stringify(state));
                            if (allReads !== before || state.readbacks !== 0) throw new Error('直连帧仍整批读回');
                            const target = gpu.physics.solver.getDirectBoneTarget();
                            if (!target || gpu.mesh.skeleton.boneTexture !== target.texture) throw new Error('GPU骨骼纹理未绑定');
                            const palette = new Float32Array(target.width * target.height * 4);
                            actualRead(target, 0, 0, target.width, target.height, palette);
                            cpu.mesh.updateWorldMatrix(true, true); cpu.mesh.skeleton.update();
                            let maximum = 0;
                            for (let k = 0; k < cpu.mesh.skeleton.bones.length * 16; k++) {
                                maximum = Math.max(maximum, Math.abs(cpu.mesh.skeleton.boneMatrices[k] - palette[k]));
                            }
                            samples.push(maximum);
                            if (maximum > .02) throw new Error('GPU与CPU骨骼矩阵差异过大：' + JSON.stringify({ i, maximum, scaled, withType2 }));
                            if (renderer.getContext().getError() !== 0) throw new Error('GPU骨骼直连GL错误');
                        }
                        const before = gpu.physics.getState().readbacks;
                        gpu.physics.setDirectBoneTexture(false);
                        if (gpu.physics.getState().directActive || gpu.physics.getState().readbacks !== before + 1) {
                            throw new Error('关闭开关未单次同步');
                        }
                        if (gpu.physics.bodies[0].position.distanceTo(cpu.physics.bodies[0].position) > 1e-4) {
                            throw new Error('关闭直连丢失最新刚体姿态');
                        }
                    } finally { gpu.dispose(); cpu.dispose(); }
                    return samples;
                };
                const ordinary = run(false, false), type2 = run(true, false), scale = run(true, true);
                for (const followerType of [0, 2]) {
                    const phaseCpu = make(true, true, false, followerType), phaseGpu = make(false, true, false, followerType);
                    try {
                        phaseGpu.physics.setDirectBoneTexture(true); phaseGpu.physics.setDirectPoseAnimated(false);
                        for (let i = 0; i < 6; i++) {
                            for (const fixture of [phaseCpu, phaseGpu]) {
                                fixture.pivot.position.x = i * .04; fixture.pivot.rotation.z = i * .02;
                                fixture.pivot.updateWorldMatrix(true, true);
                            }
                            phaseCpu.physics.update(1 / 60); phaseGpu.physics.update(1 / 60);
                            // 点击拾取/诊断等单次同步后，下次直连type0/type2的端点相位和线速度必须连续。
                            if (i >= 2) {
                                phaseGpu.physics.syncGpuPose();
                                const actual = phaseGpu.physics.bodies[1], expected = phaseCpu.physics.bodies[1];
                                if (actual.targetPosition.distanceTo(actual.position) > 1e-5
                                    || actual.previousTargetPosition.distanceTo(actual.position) > 1e-5
                                    || (followerType === 0 && (actual.targetQuaternion.angleTo(actual.quaternion) > 1e-5
                                        || actual.previousTargetQuaternion.angleTo(actual.quaternion) > 1e-5))) {
                                    throw new Error('同步没有刷新GPU锚点的CPU端点缓存：' + followerType);
                                }
                                if (actual.velocity.distanceTo(expected.velocity) > 1e-4) {
                                    throw new Error('同步后重开直连产生旧目标反向冲量：' + JSON.stringify({ i,
                                        actual: actual.velocity.toArray(), expected: expected.velocity.toArray() }));
                                }
                            }
                        }
                    } finally { phaseGpu.dispose(); phaseCpu.dispose(); }
                }
                const pausedCpu = make(true, true), pausedGpu = make(false, true);
                try {
                    pausedCpu.physics.gravity.set(0, 0, 0); pausedGpu.physics.gravity.set(0, 0, 0);
                    pausedGpu.physics.setDirectBoneTexture(true); pausedGpu.physics.setDirectPoseAnimated(false);
                    pausedCpu.physics.update(1 / 60); pausedGpu.physics.update(1 / 60);
                    for (const fixture of [pausedCpu, pausedGpu]) {
                        fixture.pivot.rotation.z = .3; fixture.pivot.position.set(1, 2, 3);
                        fixture.pivot.updateWorldMatrix(true, true); fixture.physics.syncPausedTransform();
                    }
                    pausedGpu.physics.bodies.forEach((body, i) => {
                        if (body.position.distanceTo(pausedCpu.physics.bodies[i].position) > 1e-5) {
                            throw new Error('直连旋转门控暂停吞掉根变换：' + i);
                        }
                        if (body.quaternion.angleTo(pausedCpu.physics.bodies[i].quaternion) > 1e-5) {
                            throw new Error('直连旋转门控暂停四元数未跟随根：' + i);
                        }
                    });
                } finally { pausedGpu.dispose(); pausedCpu.dispose(); }
                const resumedCpu = make(true), resumedGpu = make(false);
                try {
                    // type0子骨的锚点依赖动态父骨；同步兼容后重开不能复用旧局部姿态。
                    // 重新建带type0锚点的物理，以现有真实骨架而非mock验证恢复时序。
                    const { createWebglPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-webgl-physics.mjs');
                    const { XpbdPmxPhysics } = await import('/3rd/mmd-ar-test/web-xpbd-physics.mjs');
                    for (const [fixture, cpu] of [[resumedCpu, true], [resumedGpu, false]]) {
                        fixture.physics.dispose();
                        const params = [base(1, 1), base(0, 2)];
                        const options = { renderer, gravity: new T.Vector3(0, -9.8, 0), stabilityReferenceHz: 3 };
                        fixture.physics = cpu ? new XpbdPmxPhysics(fixture.mesh, params, [], options)
                            : createWebglPmxPhysics(fixture.mesh, params, [], options);
                    }
                    resumedGpu.physics.setDirectBoneTexture(true); resumedGpu.physics.setDirectPoseAnimated(false);
                    for (let i = 0; i < 3; i++) { resumedCpu.physics.update(1 / 60); resumedGpu.physics.update(1 / 60); }
                    resumedGpu.physics.setDirectBoneTexture(false);
                    for (let i = 0; i < 10; i++) { resumedCpu.physics.update(1 / 60); resumedGpu.physics.update(1 / 60); }
                    resumedGpu.physics.setDirectBoneTexture(true);
                    resumedCpu.physics.update(1 / 60); resumedGpu.physics.update(1 / 60); resumedGpu.physics.syncGpuPose();
                    resumedGpu.physics.bodies.forEach((body, i) => {
                        const error = body.position.distanceTo(resumedCpu.physics.bodies[i].position);
                        if (error > 1e-4) throw new Error('恢复直连复用过期父骨锚点：' + JSON.stringify({ i, error }));
                    });
                } finally {
                    resumedGpu.physics.dispose(); resumedCpu.physics.dispose(); resumedGpu.dispose(); resumedCpu.dispose();
                }
                // 同一renderer上50次创建/直连/关闭/重置/释放，检验GPU纹理与几何没有持续增长。
                const resources = () => ({ ...renderer.info.memory, programs: renderer.info.programs.length });
                const beforeResources = resources();
                for (let i = 0; i < 50; i++) {
                    const fixture = make(false, true, true);
                    fixture.physics.setDirectBoneTexture(true);
                    fixture.physics.setDirectPoseAnimated(false);
                    fixture.physics.update(1 / 60);
                    if (!fixture.physics.getState().directActive) throw new Error('生命周期循环未直连：' + i);
                    const texture = fixture.mesh.skeleton.boneTexture;
                    fixture.physics.setDirectBoneTexture(false);
                    if (fixture.mesh.skeleton.boneTexture === texture) throw new Error('旧GPU骨骼纹理仍绑定');
                    fixture.physics.reset();
                    fixture.dispose();
                    fixture.physics.dispose();
                    if (JSON.stringify(resources()) !== JSON.stringify(beforeResources)) {
                        throw new Error('GPU资源持续增长：' + JSON.stringify({ i, beforeResources, after: resources() }));
                    }
                }
                const afterResources = resources();
                renderer.dispose(); renderer.forceContextLoss();
                return { ordinary, type2, scale, allReads, beforeResources, afterResources };
            });
            assert.ok(result.ordinary.every(error => error < .02), JSON.stringify(result));
            assert.ok(result.type2.every(error => error < .02), JSON.stringify(result));
            assert.ok(result.scale.every(error => error < .02), JSON.stringify(result));
            assert.deepEqual(result.afterResources, result.beforeResources);
            console.log('GPU骨骼纹理实测', JSON.stringify(result));
            assert.deepEqual(errors, []);
        } finally {
            if (browser) await browser.close();
            await new Promise(resolve => server.close(resolve));
        }
    });
