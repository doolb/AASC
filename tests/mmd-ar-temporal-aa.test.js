'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');

test('异步重播同一动作在提交后再次清历史，失败也清等待期间旧帧', async () => {
    const { runTemporalAction } = await import('../3rd/mmd-ar-test/web-temporal-aa.mjs');
    let invalidated = 0, resolve;
    const pending = new Promise(done => { resolve = done; });
    const result = runTemporalAction(() => { invalidated += 1; }, () => pending);
    assert.equal(invalidated, 1);
    resolve(true); assert.equal(await result, true); assert.equal(invalidated, 2);
    await assert.rejects(runTemporalAction(() => { invalidated += 1; }, async () => { throw new Error('动作失败'); }), /动作失败/u);
    assert.equal(invalidated, 4);
});

test('编辑器姿态/动作跳转清TAA历史，图片捕获绕过并恢复绘制尺寸', async () => {
    const { createEditorBridge } = await import('../3rd/mmd-ar-test/web-editor-bridge.mjs');
    let invalidated = 0, time = 0, ratio = 2;
    const calls = [], sizes = []; const size = new THREE.Vector2(320, 400);
    const camera = new THREE.PerspectiveCamera(45, .8, 1, 100);
    const renderer = { capabilities: { maxTextureSize: 4096 }, getSize: out => out.copy(size), getPixelRatio: () => ratio,
        setPixelRatio: value => { ratio = value; }, setSize: (w, h) => size.set(w, h),
        getClearColor: value => value.set(0), getClearAlpha: () => 0, setClearColor() {},
        domElement: { toBlob: callback => callback({ png: true }) } };
    const mesh = { isSkinnedMesh: true, pose() {}, updateMatrixWorld() {} };
    const bridge = createEditorBridge({ THREE, renderer, camera, scene: new THREE.Scene(), mesh,
        ambientOcclusion: { invalidateTemporal: () => { invalidated += 1; }, render: value => calls.push(value), resize: (w, h) => sizes.push([w, h]) },
        helper: { objects: new Map([[mesh, { mixer: { setTime: value => { time = value; } } }]]) } });
    bridge.rest(); bridge.seek(4); assert.equal(time, 4); assert.equal(invalidated, 2);
    await bridge.capture(100, 120, true);
    assert.deepEqual(calls, [{ bypassTemporal: true }]);
    assert.deepEqual(sizes, [[100, 120], [640, 800]]);
    assert.deepEqual(size.toArray(), [320, 400]); assert.equal(ratio, 2);
    assert.equal(camera.userData.mmdArTaaBypass, undefined, 'PNG完成后应恢复相机旁路标记');
});

test('渲染设置规范化，倍率以自动DPR为基准并按设备上限等比限制', async () => {
    const { normalizeRenderSettings: normalize, calculateCanvasSize: size } = await import('../3rd/mmd-ar-test/web-render-settings.mjs');
    assert.deepEqual(normalize({}), { taaEnabled: false, aaMode: 'taa', fsr2Scale: .67, taaHistoryWeight: .9, canvasScale: 1, taaJitterScale: 1, taaJitterSamples: 8 });
    assert.deepEqual(normalize({ taaEnabled: true, taaHistoryWeight: 9, canvasScale: .61 }),
        { taaEnabled: true, aaMode: 'taa', fsr2Scale: .67, taaHistoryWeight: .95, canvasScale: .5, taaJitterScale: 1, taaJitterSamples: 8 });
    assert.equal(normalize({ canvasScale: -1 }).canvasScale, .25);
    assert.equal(normalize({ canvasScale: '', taaHistoryWeight: 'bad' }).canvasScale, 1);
    assert.equal(normalize({ aaMode: 'fsr2', fsr2Scale: .734 }).fsr2Scale, .73);
    assert.equal(normalize({ aaMode: 'fsr2', fsr2Scale: 8 }).fsr2Scale, 1);
    assert.equal(normalize({ aaMode: 'bad', fsr2Scale: .11 }).aaMode, 'taa');
    assert.equal(normalize({ taaEnabled: true }).aaMode, 'taa', '旧TAA存储应迁移为TAA模式');
    for (const dpr of [1, 2]) for (const scale of [.25, .5, 1, 1.5, 2]) {
        const result = size(480, 640, dpr, scale, 8192);
        assert.deepEqual([result.width, result.height], [480 * dpr * scale, 640 * dpr * scale]);
        assert.equal(result.limited, false);
    }
    const limited = size(1000, 500, 2, 2, 1024);
    assert.deepEqual([limited.width, limited.height], [1024, 512]);
    assert.equal(limited.limited, true);
});

test('抖动参数兼容旧存储，强度夹取且周期只接受4/8/16/32', async () => {
    const { normalizeRenderSettings: normalize } = await import('../3rd/mmd-ar-test/web-render-settings.mjs');
    for (const count of [4, 8, 16, 32]) assert.equal(normalize({ taaJitterSamples: String(count) }).taaJitterSamples, count);
    for (const count of [0, 2, 6, 8.1, 64, true, '', null, 'bad']) assert.equal(normalize({ taaJitterSamples: count }).taaJitterSamples, 8);
    assert.equal(normalize({ taaJitterScale: 0 }).taaJitterScale, 0);
    assert.equal(normalize({ taaJitterScale: '0.35' }).taaJitterScale, .35);
    assert.equal(normalize({ taaJitterScale: 20 }).taaJitterScale, 2);
    assert.equal(normalize({ taaJitterScale: -1 }).taaJitterScale, 0);
    for (const scale of [NaN, Infinity, true, '', null, 'bad']) assert.equal(normalize({ taaJitterScale: scale }).taaJitterScale, 1);
});

test('TAA周期实际循环、强度0/1/2作用于像素偏移且仅绘制一次场景', async () => {
    const { createTemporalAA } = await import('../3rd/mmd-ar-test/web-temporal-aa.mjs');
    // 手工保留变更前的默认八相位，不能使用生产生成器计算期望值。
    const jitterSamples = [[0,-1/6],[-1/4,1/6],[1/4,-7/18],[-3/8,-1/18],
        [1/8,5/18],[-1/8,-5/18],[3/8,1/18],[-7/16,7/18]];
    for (const orthographic of [false, true]) {
        const camera = orthographic ? new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 100) : new THREE.PerspectiveCamera(45, 1, .1, 100);
        camera.setViewOffset(128, 128, 8, 12, 100, 104); camera.position.z = 8; camera.updateMatrixWorld();
        const base = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
        let target = null, passes = 0;
        const renderer = { capabilities: { isWebGL2: true }, extensions: { has: () => false }, domElement: new EventTarget(),
            getRenderTarget: () => target, setRenderTarget(value) { target = value; },
            getDrawingBufferSize(out) { return out.set(65, 97); }, clear() {}, render() { passes += 1; } };
        const config = { taaEnabled: true, taaHistoryWeight: .9, taaJitterSamples: 8, taaJitterScale: 1 };
        const taa = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
        const depth = new THREE.DepthTexture(65, 97); let drawings = 0, observed;
        const draw = () => { drawings += 1; observed = { projection: camera.projectionMatrix.toArray(), phase: camera.userData.mmdArTaaPhase }; };
        const frame = () => { taa.render(draw, () => depth); assert.deepEqual(camera.projectionMatrix.elements, base.elements);
            assert.deepEqual(camera.projectionMatrixInverse.elements, inverse.elements); return observed; };
        for (const count of [4, 8, 16, 32]) {
            config.taaJitterSamples = count; taa.invalidate();
            const frames = Array.from({ length: count + 1 }, frame);
            assert.deepEqual(frames[count], frames[0], '真实投影与接触相位按所选周期循环');
            assert.equal(new Set(frames.slice(0, count).map(value => JSON.stringify(value.projection))).size, count);
            for (let index = 0; index < count; index += 1) assert.equal(frames[index].phase, index);
            if (count === 8) for (let index = 0; index < count; index += 1) {
                const expected = base.clone();
                for (let column = 0; column < 4; column += 1) {
                    expected.elements[column * 4] += 2 * jitterSamples[index][0] / 65 * base.elements[column * 4 + 3];
                    expected.elements[column * 4 + 1] += 2 * jitterSamples[index][1] / 97 * base.elements[column * 4 + 3];
                }
                assert.deepEqual(frames[index].projection, expected.elements, '默认八相位必须逐值兼容');
            }
        }
        config.taaJitterSamples = 8;
        const first = [];
        for (const scale of [0, 1, 2]) { config.taaJitterScale = scale; taa.invalidate(); first.push(frame().projection); }
        assert.deepEqual(first[0], base.elements);
        for (let index = 0; index < 16; index += 1) assert.ok(Math.abs((first[2][index] - base.elements[index]) - 2 * (first[1][index] - base.elements[index])) < 1e-14);
        frame(); assert.equal(taa.getState().lastHistoryUsed, true);
        config.taaJitterSamples = 16; frame(); assert.equal(taa.getState().lastHistoryUsed, false, '直接改周期也清历史');
        frame(); config.taaJitterScale = .5; frame(); assert.equal(taa.getState().lastHistoryUsed, false, '直接改强度也清历史');
        assert.equal(passes, drawings * 3, '每次提交只有resolve/depth/present三次全屏pass');
        const before = drawings; config.taaEnabled = false; taa.render(() => { drawings += 1; }, () => depth);
        assert.equal(drawings, before + 1); assert.equal(taa.getState().targetCount, 0);
        taa.dispose(); depth.dispose();
    }
});

test('TAA真实矩阵抖动与恢复、历史失效、资源关闭和异常恢复', async () => {
    const { createTemporalAA } = await import('../3rd/mmd-ar-test/web-temporal-aa.mjs');
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
    camera.setViewOffset(128, 128, 8, 12, 100, 104);
    camera.position.z = 8; camera.updateMatrixWorld();
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
    let target = null; const draws = [];
    const renderer = { capabilities: { isWebGL2: true }, extensions: { has: () => false },
        domElement: new EventTarget(), getRenderTarget: () => target, setRenderTarget(value) { target = value; },
        getDrawingBufferSize(value) { return value.set(64, 64); }, clear() {},
        render(scene) {
            const uniforms = scene.children[0].material.uniforms;
            for (const uniform of Object.values(uniforms)) assert.notEqual(uniform.value, target?.texture, '不能读写同一纹理');
            draws.push({ historyValid: uniforms.historyValid?.value });
        } };
    const config = { taaEnabled: true, taaHistoryWeight: .9, canvasScale: 1 };
    const temporal = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
    const depth = new THREE.DepthTexture(64, 64);
    const jitter = [];
    const draw = () => { jitter.push(camera.projectionMatrix.elements.slice()); assert.ok(camera.userData.mmdArTaaBaseProjection); };
    temporal.render(draw, () => depth);
    assert.equal(temporal.getState().historyValid, true);
    assert.equal(draws.find(d => d.historyValid !== undefined).historyValid, false);
    temporal.render(draw, () => depth);
    assert.equal(draws.filter(d => d.historyValid !== undefined).at(-1).historyValid, true);
    assert.notDeepEqual(jitter[0], jitter[1]);
    assert.deepEqual(camera.projectionMatrix.elements, projection.elements);
    assert.deepEqual(camera.projectionMatrixInverse.elements, inverse.elements);
    assert.equal(camera.userData.mmdArTaaBaseProjection, undefined);
    temporal.invalidate(); temporal.render(draw, () => depth);
    assert.equal(draws.filter(d => d.historyValid !== undefined).at(-1).historyValid, false);
    renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    assert.equal(temporal.getState().historyValid, false);
    renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    temporal.render(draw, () => depth);
    assert.equal(draws.filter(d => d.historyValid !== undefined).at(-1).historyValid, false);
    assert.throws(() => temporal.render(() => { throw new Error('场景异常'); }, () => depth), /场景异常/u);
    assert.equal(target, null); assert.equal(temporal.getState().historyValid, false);
    assert.deepEqual(camera.projectionMatrix.elements, projection.elements);
    assert.deepEqual(camera.projectionMatrixInverse.elements, inverse.elements);
    config.taaEnabled = false; temporal.render(() => {}, () => depth);
    assert.equal(temporal.getState().targetCount, 0);
    temporal.dispose();
});

test('FSR2模式低分辨率场景输入、全分辨率历史与TAA互斥切换', async () => {
    const { createTemporalAA } = await import('../3rd/mmd-ar-test/web-temporal-aa.mjs');
    const camera = new THREE.PerspectiveCamera(45, 65 / 97, .1, 100); camera.position.z = 8; camera.updateMatrixWorld();
    const base = camera.projectionMatrix.clone(); let target = null, draws = 0, resolveTarget;
    const renderer = { capabilities: { isWebGL2: true }, extensions: { has: () => false }, domElement: new EventTarget(),
        getRenderTarget: () => target, setRenderTarget(value) { target = value; }, getDrawingBufferSize(out) { return out.set(65, 97); }, clear() {},
        render(scene) {
            const uniforms = scene.children[0].material.uniforms;
            if (uniforms.upscaleEnabled?.value) {
                resolveTarget = [target.width, target.height, uniforms.inputSize.value.toArray(), uniforms.outputSize.value.toArray()];
                assert.notEqual(uniforms.tCurrent.value, target.texture, 'resolve读写不能别名');
            }
        } };
    const config = { taaEnabled: true, aaMode: 'fsr2', fsr2Scale: .5, taaHistoryWeight: .9, taaJitterScale: 1, taaJitterSamples: 8 };
    const temporal = createTemporalAA({ THREE, renderer, camera, getSettings: () => config });
    const lowDepth = new THREE.DepthTexture(32, 48), fullDepth = new THREE.DepthTexture(65, 97), projected = [];
    temporal.render(() => { draws += 1; assert.deepEqual([target.width, target.height], [32, 48]); projected.push(camera.projectionMatrix.clone()); }, () => lowDepth);
    assert.deepEqual(resolveTarget, [65, 97, [32, 48], [65, 97]]);
    assert.deepEqual([temporal.getState().width, temporal.getState().height, temporal.getState().inputWidth, temporal.getState().inputHeight], [65, 97, 32, 48]);
    const expected = base.clone(), sample = [0, -1 / 6];
    for (let column = 0; column < 4; column += 1) {
        expected.elements[column * 4] += 2 * sample[0] / 32 * base.elements[column * 4 + 3];
        expected.elements[column * 4 + 1] += 2 * sample[1] / 48 * base.elements[column * 4 + 3];
    }
    assert.deepEqual(projected[0].elements, expected.elements, 'FSR2 jitter按内部像素尺寸计算');
    camera.userData.mmdArTaaUpscaleActive = true; let bypassUpscale = true;
    temporal.render(() => { draws += 1; bypassUpscale = camera.userData.mmdArTaaUpscaleActive; }, () => lowDepth, { bypass: true });
    assert.equal(bypassUpscale, false, '旁路绘制不能使用FSR2内部比例');
    assert.equal(camera.userData.mmdArTaaUpscaleActive, true, '旁路后恢复调用方camera状态');
    delete camera.userData.mmdArTaaUpscaleActive;
    config.aaMode = 'taa'; resolveTarget = null;
    temporal.render(() => { draws += 1; assert.deepEqual([target.width, target.height], [65, 97]); }, () => fullDepth);
    assert.equal(resolveTarget, null, '普通TAA保持非升采样resolve');
    assert.deepEqual([temporal.getState().inputWidth, temporal.getState().inputHeight], [65, 97]);
    assert.equal(temporal.getState().lastHistoryUsed, false, '模式切换清空上一模式历史');
    config.taaEnabled = false; temporal.render(() => { draws += 1; }, () => fullDepth);
    assert.equal(draws, 4); assert.equal(temporal.getState().targetCount, 0);
    temporal.dispose(); lowDepth.dispose(); fullDepth.dispose();
});

test('WebGL2不支持时TAA旁路，不申请离屏目标', async () => {
    const { createTemporalAA } = await import('../3rd/mmd-ar-test/web-temporal-aa.mjs');
    let draws = 0;
    const temporal = createTemporalAA({ THREE, camera: new THREE.PerspectiveCamera(),
        renderer: { capabilities: { isWebGL2: false }, domElement: new EventTarget() }, getSettings: () => ({ taaEnabled: true, aaMode: 'fsr2' }) });
    temporal.render(() => { draws += 1; }, () => null);
    assert.equal(draws, 1); assert.equal(temporal.getState().supported, false); assert.equal(temporal.getState().targetCount, 0);
    temporal.dispose();
});
