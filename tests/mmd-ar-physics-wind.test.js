'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { addPhysicsLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
const { addPhysicsSubsteps } = require('../3rd/mmd-ar-test/web-physics-substeps');
const { addPhysicsStability } = require('../3rd/mmd-ar-test/web-physics-stability');
const { addPhysicsWind, addWindDisplay, addWindRuntime, WIND_PANEL_JS, WIND_CONTROL_IDS } = require('../3rd/mmd-ar-test/web-physics-wind');
const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const vendor = path.join(publicRoot, 'js/vendor/three');
const windUrl = pathToFileURL(path.resolve(__dirname, '../3rd/mmd-ar-test/web-physics-wind.mjs')).href;
const encode = (s) => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const near = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} / ${b}，容差${epsilon}`);
let fixturePromise;
async function fixture() {
    if (!fixturePromise) fixturePromise = (async () => {
        const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const THREE = await import(threeUrl);
        const original = fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8');
        const baseSource = addPhysicsStability(addPhysicsSubsteps(addPhysicsLifecycle(original))).replace("from 'three'", `from '${threeUrl}'`);
        const { MMDPhysics: BaselinePhysics } = await import(encode(baseSource));
        const { MMDPhysics } = await import(encode(addPhysicsWind(baseSource, windUrl)));
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({ wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        return { THREE, MMDPhysics, BaselinePhysics, ...await import(windUrl), ...await import('../3rd/mmd-ar-test/web-physics-rate.mjs') };
    })();
    return fixturePromise;
}
const params = { shapeType: 0, width: 0.1, height: 0.1, depth: 0.1, weight: 0.001,
    position: [0, 0, 0], rotation: [0, 0, 0], friction: 0, restitution: 0,
    positionDamping: 0, rotationDamping: 0, groupIndex: 0, groupTarget: 0 };
async function create(fps = 90, Physics, customBodies) {
    const f = await fixture();
    const parent = new f.THREE.Bone();
    const bone = new f.THREE.Bone(); bone.position.y = 1; parent.add(bone);
    const mesh = new f.THREE.SkinnedMesh(new f.THREE.BoxGeometry(), new f.THREE.MeshBasicMaterial());
    mesh.add(parent); mesh.bind(new f.THREE.Skeleton([parent, bone])); mesh.updateMatrixWorld(true);
    const bodies = customBodies || [
        { ...params, type: 1, boneIndex: -1 },
        { ...params, type: 2, boneIndex: 1, position: [0, 0.3, 0] },
        { ...params, type: 0, boneIndex: 0, position: [10, 0, 0] },
        { ...params, type: 1, boneIndex: -1, weight: 0, position: [20, 0, 0] },
        { ...params, type: 2, boneIndex: -1, position: [30, 0, 0] }];
    const physics = new (Physics || f.MMDPhysics)(mesh, bodies, [], { ...f.getWebPhysicsStepOptions(fps), gravity: new f.THREE.Vector3() });
    return { ...f, physics, mesh, bone, cleanup() {
        const manager = physics.manager; physics.dispose(); physics.dispose();
        assert.equal(manager.nativeObjects.size, 0); assert.equal(physics.anchorSamples.length, 0);
        mesh.geometry.dispose(); mesh.material.dispose();
    } };
}

// 参数边界和经典脚本复用同一声明，直接运行Display，覆盖runtime尚未创建的缓存路径。
test('风参数默认关闭、经纬度与灯光一致，经典Display归一化与ESM相同', async () => {
    const { normalizeWindSettings } = await fixture();
    const context = vm.createContext({ window: {} });
    new vm.Script(addWindDisplay(fs.readFileSync(path.join(publicRoot, 'js/display-mmd.js'), 'utf8'))).runInContext(context);
    for (const value of [undefined, null, 'bad', {}, { enabled: 'false', strength: '', longitude: NaN, latitude: Infinity, gust: null },
        { enabled: true, strength: 0, longitude: -180, latitude: 90, gust: 100 },
        { enabled: true, strength: 3 }, { enabled: true, strength: 30 }, { enabled: true, strength: 31 },
        { enabled: true, strength: 999, longitude: -999, latitude: 999, gust: -1 },
        { enabled: true, strength: 0.326, longitude: 45.7, latitude: -32.4, gust: 43 }]) {
        const expected = normalizeWindSettings(value);
        assert.deepEqual(JSON.parse(JSON.stringify(context.window.DisplayMmd.setWindSettings(value))), expected);
    }
    assert.deepEqual(normalizeWindSettings(), { enabled: false, strength: 0.3, longitude: 0, latitude: 0, gust: 0 });
    for (const [input, expected] of [[3, 3], [30, 30], [31, 30], [999, 30], [-1, 0], [null, 0.3], ['', 0.3], ['bad', 0.3]]) {
        assert.equal(normalizeWindSettings({ strength: input }).strength, expected);
        assert.equal(context.window.DisplayMmd.setWindSettings({ strength: input }).strength, expected);
    }
});

test('经纬度来源转成吹向：六个基轴、极点和±180等价', async () => {
    const { windFlowDirection } = await fixture();
    for (const [longitude, latitude, expected] of [[0, 0, [0, 0, -1]], [90, 0, [-1, 0, 0]], [-90, 0, [1, 0, 0]],
        [180, 0, [0, 0, 1]], [-180, 0, [0, 0, 1]], [37, 90, [0, -1, 0]], [-58, -90, [0, 1, 0]]]) {
        const d = windFlowDirection({ longitude, latitude });
        [d.x, d.y, d.z].forEach((v, i) => near(v, expected[i], 1e-12));
        near(Math.hypot(d.x, d.y, d.z), 1, 1e-12);
    }
});

test('0.3秒强度缓动按子步平均积分，30/90/180Hz同时间阵风近似一致，暂停不推进', async () => {
    const { advanceWindState, createWindState, normalizeWindSettings } = await fixture();
    for (const gust of [0, 100]) {
        const totals = [];
        for (const fps of [30, 90, 180]) {
            const state = createWindState(); const settings = normalizeWindSettings({ enabled: true, strength: 1, gust });
            let integral = 0;
            for (let i = 0; i < fps * 4; i += 1) integral += advanceWindState(state, 1 / fps, settings) / fps;
            const before = { ...state };
            assert.equal(advanceWindState(state, 0, settings), 0); assert.deepEqual(state, before);
            near(state.time, 4); assert.ok(state.strength <= 1); totals.push(integral);
            advanceWindState(state, 1, { ...settings, enabled: false }); near(state.time, 4); assert.equal(state.strength, 0);
        }
        assert.ok(Math.max(...totals) - Math.min(...totals) < (gust ? 0.001 : 1e-10), totals.join('/'));
    }
});

test('默认风关闭和零强度真实Ammo与旧流程相同，不创建受風刚体缓存', async () => {
    const { BaselinePhysics } = await fixture();
    const baseline = await create(90, BaselinePhysics); const wind = await create();
    try {
        wind.physics.setWindSettings({ enabled: true, strength: 0 });
        for (let i = 0; i < 60; i += 1) { baseline.physics.update(1 / 60); wind.physics.update(1 / 60); }
        for (let index = 0; index < baseline.physics.bodies.length; index += 1) {
            const a = baseline.physics.bodies[index].body.getCenterOfMassTransform().getOrigin();
            const b = wind.physics.bodies[index].body.getCenterOfMassTransform().getOrigin();
            for (const axis of ['x', 'y', 'z']) near(a[axis](), b[axis](), 1e-12);
        }
        assert.equal(wind.physics.windBodies, null);
        wind.physics.setWindSettings({ enabled: false });
        const time = wind.physics.windState.time; wind.physics.update(1 / 60); near(wind.physics.windState.time, time);
    } finally { baseline.cleanup(); wind.cleanup(); }
});

test('真实Ammo连续风力含上限30按模拟秒积分，不同物理Hz/画面FPS一致，关闭保留速度', async () => {
    for (const strength of [0.3, 30]) {
        const results = [];
        for (const [fps, renderFps] of [[30, 60], [90, 60], [180, 30], [180, 144]]) {
            const f = await create(fps);
            try {
                f.physics.setWindSettings({ enabled: true, strength, longitude: 90, latitude: 0 });
                for (let i = 0; i < renderFps; i += 1) f.physics.update(1 / renderFps);
                const body = f.physics.bodies[0].body;
                near(body.getLinearVelocity().x(), -strength * 10 * (1 - 0.3 * (1 - Math.exp(-1 / 0.3))), 2e-5 * Math.max(1, strength));
                near(body.getLinearVelocity().z(), 0); near(body.getLinearVelocity().y(), 0);
                const before = body.getLinearVelocity().x(); f.physics.setWindSettings({ enabled: false });
                f.physics.update(1 / 60); near(body.getLinearVelocity().x(), before);
                results.push({ strength, fps, renderFps, velocity: before, x: body.getCenterOfMassTransform().getOrigin().x() });
            } finally { f.cleanup(); }
        }
        assert.ok(Math.max(...results.map((r) => r.x)) - Math.min(...results.map((r) => r.x)) < 0.05 * strength / 0.3);
        console.info('真实Ammo风力跨Hz/FPS', results);
    }
});

test('type0/零质量不受风，自由type2被推动；受控type2只转动并保持骨骼局部位置', async () => {
    const f = await create(180);
    try {
        f.physics.setWindSettings({ enabled: true, strength: 30, longitude: 90, latitude: 0, gust: 100 });
        const localPosition = f.bone.position.toArray();
        for (let i = 0; i < 60; i += 1) { f.mesh.updateMatrixWorld(true); f.physics.update(1 / 60); }
        const controlled = f.physics.bodies[1].body;
        near(controlled.getLinearFactor().x(), 0); near(controlled.getLinearFactor().y(), 0); near(controlled.getLinearFactor().z(), 0);
        assert.deepEqual(f.bone.position.toArray(), localPosition);
        assert.ok(Math.abs(controlled.getAngularVelocity().z()) > 0.01);
        assert.ok(Math.abs(controlled.getAngularVelocity().z()) < 12.01);
        for (const index of [2, 3]) {
            const velocity = f.physics.bodies[index].body.getLinearVelocity();
            near(velocity.x(), 0); near(velocity.y(), 0); near(velocity.z(), 0);
        }
        assert.ok(f.physics.bodies[4].body.getLinearVelocity().x() < -1);
    } finally { f.cleanup(); }
});

test('极小惯量风矩限幅且没有骨骼偏移时不制造力矩', async () => {
    for (const position of [[0, 0.3, 0], [0, 0, 0]]) {
        const f = await create(180, null, [{ ...params, type: 2, boneIndex: 1, weight: 1e-8, width: 0.01, position }]);
        try {
            f.physics.setWindSettings({ enabled: true, strength: 30, longitude: 90, gust: 100 });
            for (let i = 0; i < 90; i += 1) f.physics.update(1 / 180);
            const velocity = f.physics.bodies[0].body.getAngularVelocity();
            assert.ok(Number.isFinite(velocity.z())); assert.ok(Math.abs(velocity.z()) <= 6.01);
            if (position[1] === 0) near(velocity.z(), 0);
        } finally { f.cleanup(); }
    }
});

test('风施力抛错仍归还临时池向量，并能继续步进和重复销毁', async () => {
    const f = await create();
    try {
        f.physics.setWindSettings({ enabled: true });
        const body = f.physics.bodies[0].body; const original = body.applyCentralForce;
        body.applyCentralForce = () => { throw new Error('测试风施力失败'); };
        assert.throws(() => f.physics.update(1 / 30), /测试风施力失败/);
        body.applyCentralForce = original;
        const nativeCount = f.physics.manager.nativeObjects.size;
        for (let i = 0; i < 100; i += 1) f.physics.update(1 / 60);
        assert.equal(f.physics.manager.nativeObjects.size, nativeCount);
    } finally { f.cleanup(); }
});

test('真实Ammo开启风后连续64次创建销毁native资源不累积', async () => {
    for (let i = 0; i < 64; i += 1) {
        const f = await create();
        try {
            f.physics.setWindSettings({ enabled: true, strength: 0.3, longitude: i * 5 - 160, latitude: 20, gust: 50 });
            for (let step = 0; step < 5; step += 1) f.physics.update(1 / 60);
        } finally { f.cleanup(); assert.equal(f.physics.windBodies, null); assert.equal(f.physics.windScratch, null); }
    }
});

// 独立模拟runtime声明和首次更新入口，验证动作替换生成的新物理先补发，再进入渲染门控。
test('runtime新物理首次帧前补发风设置，同实例无变更不重复设置，销毁后弱引用不持有', async () => {
    const calls = [];
    const helper = { current: { objects: new Map() } }; const mesh = {};
    const mock = `function create() {
        let visible = true;
        const helper = globalThis.testHelper; const currentMesh = globalThis.testMesh;
        const startRendering = () => {};
        const pendingInitialMotionHelper = null;
        const setMotionPlaybackEnabled = () => {};
        function preparedSetup(prepared, mesh) {
        const physics = prepared.helper?.objects?.get(mesh)?.physics;
        }
        function frame() { const frameHelper = helper.current;
        const delayInitialMotion = frameHelper && pendingInitialMotionHelper === frameHelper;
        }
        return {
        setMotionPlaybackEnabled,
        frame };
    }`;
    const source = addWindRuntime(mock, windUrl);
    const module = await import(encode(source + '\nexport {create};'));
    globalThis.testHelper = helper; globalThis.testMesh = mesh;
    try {
        const runtime = module.create(); runtime.setWindSettings({ enabled: true, longitude: 45, latitude: 30 });
        const physics = { setWindSettings(value) { calls.push({ ...value }); } };
        helper.current.objects.set(mesh, { physics }); runtime.frame(); runtime.frame(); assert.equal(calls.length, 1);
        assert.equal(calls[0].latitude, 30);
        helper.current = { objects: new Map([[mesh, { physics: { setWindSettings(value) { calls.push({ ...value }); } } }]]) };
        runtime.frame(); assert.equal(calls.length, 2); assert.equal(calls[1].longitude, 45);
        runtime.setWindSettings({ enabled: false }); assert.equal(calls.length, 3); assert.equal(calls[2].enabled, false);
    } finally { delete globalThis.testHelper; delete globalThis.testMesh; }
});

test('风控件持久化、损坏存储、存储受限与非法值回退，恢复读数和Display调用一致', async () => {
    for (const stored of [null, '{broken', JSON.stringify({ enabled: true, longitude: 45, latitude: 30, strength: 30, gust: 50 })]) {
        const nodes = new Map(WIND_CONTROL_IDS.map((id) => [id, { value: '', textContent: '', checked: false, handlers: {},
            addEventListener(name, fn) { this.handlers[name] = fn; } }]));
        const values = new Map(); if (stored !== null) values.set('aasc.mmdArTest.wind.v1', stored);
        let result;
        const context = vm.createContext({ document: { getElementById: (id) => nodes.get(id) },
            localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
            window: { DisplayMmd: { setWindSettings: (value) => { result = JSON.parse(JSON.stringify(value)); } } } });
        new vm.Script(WIND_PANEL_JS).runInContext(context);
        assert.equal(result.enabled, stored?.startsWith('{"enabled":true') || false);
        assert.equal(result.strength, stored?.startsWith('{"enabled":true') ? 30 : 0.3);
        assert.equal(nodes.get('mmdArWindStrength').value, String(result.strength));
        nodes.get('mmdArWindEnabled').checked = true; nodes.get('mmdArWindLatitude').value = '-90';
        nodes.get('mmdArWindLatitude').handlers.change();
        assert.equal(result.latitude, -90); assert.equal(nodes.get('mmdArWindLatitudeValue').textContent, '-90°');
        assert.equal(JSON.parse(values.get('aasc.mmdArTest.wind.v1')).latitude, -90);
        context.localStorage.setItem = () => { throw new Error('存储受限'); };
        assert.doesNotThrow(() => nodes.get('mmdArWindLatitude').handlers.change());
    }
});

test('注入锚点缺失或重复时显式失败', () => {
    for (const transform of [addPhysicsWind, addWindRuntime, addWindDisplay]) assert.throws(() => transform('', windUrl), /唯一锚点/);
    const display = fs.readFileSync(path.join(publicRoot, 'js/display-mmd.js'), 'utf8');
    assert.throws(() => addWindDisplay(display + display), /唯一锚点/);
});

// 使用真实PMX的完整骨骼/183刚体/261关节，仅替换材质加载；观察实际模型有限性及开启开销。
test('真实米娅90/180Hz恒风与阵风下姿态有限、风影响动态体且销毁释放全部native资源', { timeout: 60000 }, async () => {
    const f = await fixture();
    const { MMDLoader } = await import('three/addons/loaders/MMDLoader.js');
    const { MMDParser } = await import(pathToFileURL(path.join(vendor, 'libs/mmdparser.module.js')).href);
    const bytes = fs.readFileSync(path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist/mmd/miya/miya.pmx'));
    const measurements = [];
    for (const fps of [90, 180]) {
        const positions = [];
        for (const enabled of [false, true]) {
            const data = new MMDParser.Parser().parsePmx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
            const loader = new MMDLoader();
            loader.meshBuilder.materialBuilder.build = () => data.materials.map(() => new f.THREE.MeshBasicMaterial());
            const mesh = loader.meshBuilder.build(data, ''); mesh.updateMatrixWorld(true);
            const metadata = mesh.geometry.userData.MMD;
            const physics = new f.MMDPhysics(mesh, metadata.rigidBodies, metadata.constraints, f.getWebPhysicsStepOptions(fps));
            try {
                assert.equal(physics.bodies.length, 183); assert.equal(physics.constraints.length, 261);
                physics.setWindSettings({ enabled, strength: 30, longitude: 45, latitude: 20, gust: 50 });
                const start = performance.now();
                for (let frame = 0; frame < 120; frame += 1) physics.update(1 / 60);
                measurements.push({ fps, enabled, simulationSeconds: 2, elapsedMs: Math.round(performance.now() - start) });
                positions.push(physics.bodies.map((entry) => {
                    const origin = entry.body.getCenterOfMassTransform().getOrigin();
                    const velocity = entry.body.getAngularVelocity();
                    const values = [origin.x(), origin.y(), origin.z(), velocity.x(), velocity.y(), velocity.z()];
                    assert.ok(values.every(Number.isFinite)); assert.ok(values.slice(0, 3).every((v) => Math.abs(v) < 1000));
                    return values.slice(0, 3);
                }));
            } finally {
                physics.dispose(); assert.equal(physics.manager.nativeObjects.size, 0);
                mesh.geometry.dispose(); mesh.material.forEach((material) => material.dispose());
            }
        }
        assert.ok(positions[0].some((p, i) => p.some((v, axis) => Math.abs(v - positions[1][i][axis]) > 1e-5)), '真实模型应观察到风响应');
    }
    console.info('真实米娅风开关耗时（非手机CPU结论）', measurements);
});


// 模型缩放会让vendor临时脱离父级，最终世界方向仍必须和灯光经纬度一致。
test('非单位缩放及旋转枢轴下，风保持场景来向，不随角色旋转', async () => {
    for (const angle of [0, Math.PI / 2, -Math.PI / 2]) {
        const f = await create(90, null, [{ ...params, type: 1, boneIndex: -1 }]);
        const pivot = new f.THREE.Group(); pivot.scale.setScalar(0.1); pivot.rotation.y = angle; pivot.add(f.mesh);
        pivot.updateMatrixWorld(true);
        try {
            f.physics.setWindSettings({ enabled: true, strength: 0.3, longitude: -90 });
            for (let i = 0; i < 60; i += 1) f.physics.update(1 / 60);
            const v = f.physics.bodies[0].body.getLinearVelocity();
            const worldVelocity = new f.THREE.Vector3(v.x(), v.y(), v.z()).applyQuaternion(pivot.quaternion);
            near(worldVelocity.x, 3 * (1 - 0.3 * (1 - Math.exp(-1 / 0.3))), 2e-5);
            near(worldVelocity.y, 0); near(worldVelocity.z, 0);
            assert.equal(f.mesh.parent, pivot);
        } finally { pivot.remove(f.mesh); f.cleanup(); }
    }
});
