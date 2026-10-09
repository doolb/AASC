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
});

test('渲染设置规范化，倍率以自动DPR为基准并按设备上限等比限制', async () => {
    const { normalizeRenderSettings: normalize, calculateCanvasSize: size } = await import('../3rd/mmd-ar-test/web-render-settings.mjs');
    assert.deepEqual(normalize({}), { taaEnabled: false, taaHistoryWeight: .9, canvasScale: 1 });
    assert.deepEqual(normalize({ taaEnabled: true, taaHistoryWeight: 9, canvasScale: .61 }),
        { taaEnabled: true, taaHistoryWeight: .95, canvasScale: .5 });
    assert.equal(normalize({ canvasScale: -1 }).canvasScale, .25);
    assert.equal(normalize({ canvasScale: '', taaHistoryWeight: 'bad' }).canvasScale, 1);
    for (const dpr of [1, 2]) for (const scale of [.25, .5, 1, 1.5, 2]) {
        const result = size(480, 640, dpr, scale, 8192);
        assert.deepEqual([result.width, result.height], [480 * dpr * scale, 640 * dpr * scale]);
        assert.equal(result.limited, false);
    }
    const limited = size(1000, 500, 2, 2, 1024);
    assert.deepEqual([limited.width, limited.height], [1024, 512]);
    assert.equal(limited.limited, true);
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

test('WebGL2不支持时TAA旁路，不申请离屏目标', async () => {
    const { createTemporalAA } = await import('../3rd/mmd-ar-test/web-temporal-aa.mjs');
    let draws = 0;
    const temporal = createTemporalAA({ THREE, camera: new THREE.PerspectiveCamera(),
        renderer: { capabilities: { isWebGL2: false }, domElement: new EventTarget() }, getSettings: () => ({ taaEnabled: true }) });
    temporal.render(() => { draws += 1; }, () => null);
    assert.equal(draws, 1); assert.equal(temporal.getState().supported, false); assert.equal(temporal.getState().targetCount, 0);
    temporal.dispose();
});
