'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const cheerio = require('cheerio');
const { normalizeShadowMapSize, normalizeShadowCameraScale, addShadowMapControls, addShadowMapRuntime, PANEL_JS } = require('../3rd/mmd-ar-test/web-shadow-map-size');

test('阴影尺寸限定四档，拒绝隐式空值，按真实设备上限降档', () => {
    for (const size of [512, 1024, 2048, 4096]) assert.equal(normalizeShadowMapSize(size), size);
    for (const value of ['', 'bad', null, true, {}, 8192, 1000, NaN]) assert.equal(normalizeShadowMapSize(value), 1024);
    assert.equal(normalizeShadowMapSize('4096', 3000), 2048);
    assert.equal(normalizeShadowMapSize(4096, 1024), 1024);
    assert.equal(normalizeShadowMapSize(4096, 256), 256);
    assert.equal(normalizeShadowMapSize(512, 8192), 512);
});

test('阴影相机倍率0.1–2按0.01归一，旧偏好和非法值回1', () => {
    for (const value of [undefined, null, '', 'bad', true, [], {}, NaN, Infinity]) assert.equal(normalizeShadowCameraScale(value), 1);
    for (const value of [0.1, 0.5, 1, 2]) assert.equal(normalizeShadowCameraScale(value), value);
    assert.equal(normalizeShadowCameraScale('0.75'), 0.75);
    assert.equal(normalizeShadowCameraScale(0), 0.1);
    assert.equal(normalizeShadowCameraScale(3), 2);
    assert.equal(normalizeShadowCameraScale(1.236), 1.24);
});

test('真实注入拟合等比更新两灯投影，往返/灯光重新拟合不累乘、不改变近远裁面', async () => {
    const THREE = await import('three');
    const source = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js', 'utf8');
    const injected = addShadowMapRuntime(source, './preview');
    const start = injected.indexOf('    const fitShadowCamera = (root) => {');
    const end = injected.indexOf('    const applyShadowMode = () => {', start);
    const lights = [new THREE.DirectionalLight(), new THREE.DirectionalLight()];
    lights[0].position.set(1, 3, 2); lights[1].position.set(-1, 2, -3);
    const settings = { cameraScale: 1 };
    const bounds = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.2), new THREE.Vector3(0.5, 1.75, 0.2));
    const fit = vm.runInNewContext(normalizeShadowCameraScale.toString() + '\nlet shadowFitCount = 0;\n' + injected.slice(start, end) + '\nfitShadowCamera;', {
        THREE, TARGET_MODEL_HEIGHT: 1.75, SHADOW_FRUSTUM_MARGIN: 1.18,
        getModelBounds: () => bounds, applyKeyLightPosition: () => {},
        keyLight: lights[0], fillLight: lights[1], shadowPlane: new THREE.Object3D(),
        window: { MmdArTestShadowMapSettings: settings }, captureTestShadowRoot: () => {}
    });
    fit(null);
    const expectedExtent = Math.max(1.75 * 0.65, bounds.getSize(new THREE.Vector3()).length() * 0.5) * 1.18 * 0.5;
    assert.ok(Math.abs(lights[0].shadow.camera.right - expectedExtent) < 1e-12, '默认倍率仍1，基准半幅减半');
    const originals = lights.map(light => ({ extent: light.shadow.camera.right,
        near: light.shadow.camera.near, far: light.shadow.camera.far,
        matrixX: light.shadow.camera.projectionMatrix.elements[0] }));
    for (const scale of [0.1, 0.5, 2, 0.5, 1, 1]) {
        settings.cameraScale = scale; fit(null);
        for (let index = 0; index < lights.length; index += 1) {
            const camera = lights[index].shadow.camera; const original = originals[index];
            assert.ok(Math.abs(camera.right - original.extent * scale) < 1e-12);
            assert.equal(camera.left, -camera.right); assert.equal(camera.top, camera.right); assert.equal(camera.bottom, -camera.right);
            assert.equal(camera.near, original.near); assert.equal(camera.far, original.far);
            assert.ok(Math.abs(camera.projectionMatrix.elements[0] - original.matrixX / scale) < 1e-12);
        }
    }
});

test('两灯按真实贴图对齐整像素，宽高/光向/NF保持且连续小位移不累积抵消跟随', async () => {
    const THREE = await import('three');
    const { createShadowCameraAlignment } = await import('../3rd/mmd-ar-test/web-shadow-map-preview.mjs');
    const align = createShadowCameraAlignment(THREE);
    const origin = new THREE.Vector3();
    const cameraCenter = camera => new THREE.Vector3((camera.left + camera.right) / 2,
        (camera.bottom + camera.top) / 2, 0).applyMatrix4(camera.matrixWorld);
    for (const position of [[1, 3, 2], [-2, 2, -3]]) {
        const light = new THREE.DirectionalLight();
        light.position.set(...position); light.target.position.set(0.23, 0.9, -0.13);
        const camera = light.shadow.camera;
        camera.left = -3.7; camera.right = 3.7; camera.bottom = -2.1; camera.top = 2.1;
        camera.near = 0.1; camera.far = 20;
        const direction = light.target.position.clone().sub(light.position).normalize();
        const check = () => {
            origin.set(0, 0, 0).project(camera);
            const pixel = [(origin.x * 0.5 + 0.5) * light.shadow.map.width,
                (origin.y * 0.5 + 0.5) * light.shadow.map.height];
            for (const value of pixel) assert.ok(Math.abs(value - Math.round(value)) < 1e-8, JSON.stringify(pixel));
            assert.ok(Math.abs(camera.right - camera.left - 7.4) < 1e-10);
            assert.ok(Math.abs(camera.top - camera.bottom - 4.2) < 1e-10);
            assert.ok(Math.abs((camera.left + camera.right) / 2) <= 7.4 / light.shadow.map.width / 2 + 1e-10);
            assert.ok(Math.abs((camera.top + camera.bottom) / 2) <= 4.2 / light.shadow.map.height / 2 + 1e-10);
            assert.equal(camera.near, 0.1); assert.equal(camera.far, 20);
            assert.ok(light.target.position.clone().sub(light.position).normalize().distanceTo(direction) < 1e-10);
        };
        for (const size of [512, 1024, 2048, 4096, 512]) {
            // 实际目标尺寸优先于配置：设备限幅或目标重新创建后按本帧真实尺寸计算。
            light.shadow.mapSize.set(8192, 8192);
            light.shadow.map = { width: size, height: size / 2 };
            assert.equal(align(light), true); check();
            const edges = [camera.left, camera.right, camera.bottom, camera.top];
            for (let repeat = 0; repeat < 10; repeat += 1) { align(light); check(); }
            for (const [index, edge] of [camera.left, camera.right, camera.bottom, camera.top].entries()) {
                assert.ok(Math.abs(edge - edges[index]) < 1e-10);
            }
        }
        const start = cameraCenter(camera);
        const axis = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        const step = axis.clone().multiplyScalar(7.4 / 512 * 0.15);
        for (let frame = 0; frame < 100; frame += 1) {
            light.position.add(step); light.target.position.add(step); align(light); check();
        }
        const displacement = cameraCenter(camera).sub(start).dot(axis);
        assert.ok(Math.abs(displacement - 7.4 / 512 * 15) <= 7.4 / 512, '连续小移动应推进阴影网格，不得冻结在原位');
        // 渲染器再次更新阴影矩阵后仍对齐，不依赖即将被Three覆盖的相机position。
        light.shadow.updateMatrices(light); check();
    }
});

test('真实注入跟随拖动/定位/复位及缩放，纯平移和静止不重算模型包围范围', async () => {
    const THREE = await import('three');
    const source = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js', 'utf8');
    const injected = addShadowMapRuntime(source, './preview');
    const followStart = injected.indexOf('    let shadowFollowRoot = null;');
    const followEnd = injected.indexOf('    const shadowMapLimit =', followStart);
    const fitStart = injected.indexOf('    const fitShadowCamera = (root) => {');
    const fitEnd = injected.indexOf('    const applyShadowMode = () => {', fitStart);
    const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)));
    const lights = [new THREE.DirectionalLight(), new THREE.DirectionalLight()];
    const plane = new THREE.Object3D();
    let boundsReads = 0;
    const context = vm.createContext({ THREE, TARGET_MODEL_HEIGHT: 1.75, SHADOW_FRUSTUM_MARGIN: 1.18,
        currentRotationPivot: root, currentMesh: null, keyLight: lights[0], fillLight: lights[1], shadowPlane: plane,
        window: { MmdArTestShadowMapSettings: { cameraScale: 1 } },
        getModelBounds: node => { boundsReads += 1; node.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(node); },
        applyKeyLightPosition: bounds => {
            const center = bounds.getCenter(new THREE.Vector3());
            lights[0].position.copy(center).add(new THREE.Vector3(1, 3, 2));
            lights[1].position.copy(center).add(new THREE.Vector3(-1, 2, -3));
        }
    });
    const runtime = vm.runInContext(normalizeShadowCameraScale.toString() + '\n' + injected.slice(followStart, followEnd)
        + injected.slice(fitStart, fitEnd) + '\n({ fit: fitShadowCamera, follow: followTestShadowRoot, state: () => ({ fits: shadowFitCount, moves: shadowTranslationCount, root: shadowFollowRoot }) });', context);
    runtime.fit(root);
    const widths = lights.map(light => light.shadow.camera.right - light.shadow.camera.left);
    const previous = lights.map(light => ({ position: light.position.clone(), target: light.target.position.clone() }));
    const planePosition = plane.position.clone();
    const delta = new THREE.Vector3(0.35, 0.2, -0.15);
    root.position.add(delta); runtime.follow();
    for (const [index, light] of lights.entries()) {
        assert.ok(light.position.clone().sub(previous[index].position).distanceTo(delta) < 1e-12);
        assert.ok(light.target.position.clone().sub(previous[index].target).distanceTo(delta) < 1e-12);
        assert.equal(light.shadow.camera.right - light.shadow.camera.left, widths[index]);
    }
    assert.ok(plane.position.clone().sub(planePosition).distanceTo(delta) < 1e-12);
    for (let frame = 0; frame < 10; frame += 1) runtime.follow();
    assert.equal(boundsReads, 1); assert.equal(runtime.state().fits, 1); assert.equal(runtime.state().moves, 1);
    root.position.set(0, 0, 0); runtime.follow();
    assert.ok(lights[0].position.distanceTo(previous[0].position) < 1e-12);
    assert.equal(boundsReads, 1);
    root.scale.setScalar(2); runtime.follow();
    assert.equal(boundsReads, 2);
    assert.ok(Math.abs(lights[0].shadow.camera.right - lights[0].shadow.camera.left - widths[0] * 2) < 1e-12);
    root.scale.setScalar(1); runtime.follow(); assert.equal(boundsReads, 3);
    context.currentRotationPivot = root.clone(); runtime.follow(); assert.equal(boundsReads, 4);
    context.currentRotationPivot = null; runtime.follow(); assert.equal(runtime.state().root, null);
});

test('释放阴影map/mapPass并清空引用，重复目标与重复调用只释放一次', async () => {
    const { releaseShadowTargets } = await import('../3rd/mmd-ar-test/web-shadow-map-preview.mjs');
    let releases = 0;
    const target = { dispose: () => { releases += 1; } };
    const shadow = { map: target, mapPass: target };
    releaseShadowTargets(shadow);
    releaseShadowTargets(shadow);
    assert.deepEqual(shadow, { map: null, mapPass: null });
    assert.equal(releases, 1);
    shadow.map = target; shadow.mapPass = { dispose: () => { releases += 1; } };
    releaseShadowTargets(shadow);
    assert.equal(releases, 3);
});

test('完整阴影预览正确翻转Y，独立掩码统计覆盖，不把灰度接近白色的角色误作空白', async () => {
    const { copyShadowPreviewPixels } = await import('../3rd/mmd-ar-test/web-shadow-map-preview.mjs');
    const source = new Uint8Array([254, 255, 0, 255, 255, 0, 0, 255, 80, 255, 0, 255, 255, 0, 0, 255]);
    const destination = new Uint8Array(16);
    assert.equal(copyShadowPreviewPixels(source, destination, 2, 2), 0.5);
    assert.deepEqual([...destination], [80, 80, 80, 255, 255, 255, 255, 255, 254, 254, 254, 255, 255, 255, 255, 255]);
});

async function previewFixture() {
    const THREE = await import('three');
    const { createShadowMapPreview } = await import('../3rd/mmd-ar-test/web-shadow-map-preview.mjs');
    const elements = new Map();
    const contexts = [];
    const container = { hidden: false, shown: true, top: 10,
        getClientRects() { return this.shown ? [{}] : []; },
        getBoundingClientRect() { return { top: this.top, bottom: this.top + 500 }; } };
    elements.set('mmdArShadowMapPreviewRows', container);
    for (const name of ['Key', 'Fill']) {
        const context = { clears: 0, writes: 0, createImageData: (w, h) => ({ data: new Uint8Array(w * h * 4) }),
            clearRect() { this.clears += 1; }, putImageData() { this.writes += 1; } };
        contexts.push(context);
        elements.set(`mmdArShadowMap${name}Canvas`, { getContext: () => context });
        elements.set(`mmdArShadowMap${name}Status`, { textContent: '' });
    }
    const original = { name: '原目标' };
    const renderer = { target: original, autoClear: false, scissorTest: true,
        viewport: new THREE.Vector4(2, 3, 80, 90), scissor: new THREE.Vector4(4, 5, 60, 70),
        shadowMap: { enabled: true }, targets: [], throws: false,
        getRenderTarget() { return this.target; }, getActiveCubeFace: () => 3, getActiveMipmapLevel: () => 2,
        getScissorTest() { return this.scissorTest; },
        getViewport(out) { return out.copy(this.viewport); }, getScissor(out) { return out.copy(this.scissor); },
        setViewport(value) { this.viewport.copy(value); }, setScissor(value) { this.scissor.copy(value); },
        setScissorTest(value) { this.scissorTest = value; },
        setRenderTarget(value, face, mip) { this.target = value; this.face = face; this.mip = mip;
            if (value?.isWebGLRenderTarget && !this.targets.includes(value)) this.targets.push(value); },
        render() { if (this.throws) throw new Error('诊断绘制失败'); },
        readRenderTargetPixels(target, x, y, w, h, buffer) {
            for (let i = 0; i < buffer.length; i += 4) { buffer[i] = 90; buffer[i + 1] = i % 16 === 0 ? 255 : 0; }
        }
    };
    const lights = [new THREE.DirectionalLight(), new THREE.DirectionalLight()];
    for (const light of lights) { light.castShadow = true; light.shadow.map = { width: 2048, height: 2048, texture: new THREE.Texture() }; }
    const statuses = ['', ''];
    const root = { document: { getElementById: id => elements.get(id) }, innerHeight: 800 };
    const preview = createShadowMapPreview({ THREE, renderer, lights, root,
        getStatus: (index, enabled) => { assert.equal(enabled, true); return statuses[index]; } });
    return { preview, renderer, container, contexts, elements, statuses, lights, original };
}

test('关闭/折叠/屏幕外不分配和读回；4Hz复用小目标，独立补光/复用状态正确', async () => {
    const { preview, renderer, container, contexts, elements, statuses, original } = await previewFixture();
    assert.equal(preview.update(0), false);
    preview.setEnabled(true); container.shown = false;
    assert.equal(preview.update(0), false);
    container.shown = true; container.top = 900;
    assert.equal(preview.update(0), false);
    assert.equal(preview.getState().allocated, false);
    container.top = 10;
    assert.equal(preview.update(0), true);
    assert.equal(preview.getState().reads, 2);
    assert.equal(preview.update(100), false);
    assert.match(elements.get('mmdArShadowMapKeyStatus').textContent, /2048 × 2048.*25.0%/u);
    statuses[1] = '沿用主光阴影（复用上图）';
    assert.equal(preview.update(250), true);
    assert.equal(preview.getState().reads, 3);
    assert.equal(contexts[1].clears, 1);
    assert.match(elements.get('mmdArShadowMapFillStatus').textContent, /复用上图/u);
    assert.equal(renderer.targets.length, 1);
    assert.equal(renderer.target, original);
    assert.equal(renderer.face, 3); assert.equal(renderer.mip, 2);
    assert.equal(renderer.autoClear, false); assert.equal(renderer.scissorTest, true);
    assert.equal(renderer.shadowMap.enabled, true);
    assert.deepEqual(renderer.viewport.toArray(), [2, 3, 80, 90]);
    assert.deepEqual(renderer.scissor.toArray(), [4, 5, 60, 70]);
    let releases = 0; renderer.targets[0].addEventListener('dispose', () => { releases += 1; });
    preview.setEnabled(false); preview.dispose(); preview.dispose();
    assert.equal(releases, 1); assert.equal(preview.getState().allocated, false);
});

test('GPU预览异常仍恢复原目标/视口/阴影/清屏状态，关闭后释放目标', async () => {
    const { preview, renderer, original } = await previewFixture();
    preview.setEnabled(true); renderer.throws = true;
    assert.equal(preview.update(0), false);
    assert.equal(renderer.target, original); assert.equal(renderer.shadowMap.enabled, true);
    assert.equal(renderer.autoClear, false); assert.equal(renderer.scissorTest, true);
    assert.deepEqual(renderer.viewport.toArray(), [2, 3, 80, 90]);
    assert.match(preview.getState().error, /诊断绘制失败/u);
    preview.dispose(); assert.equal(preview.getState().allocated, false);
});

test('面板生成四档和两张完整预览，注入唯一锚点/清理；锚点变化立即失败', () => {
    const $ = cheerio.load('<div id="panel"><div class="mmd-ar-panel-group"><button data-group-title="主光"></button><div class="mmd-ar-panel-group-body"></div></div></div>');
    addShadowMapControls($, $('#panel'));
    assert.deepEqual($('#mmdArShadowMapSize option').map((_, node) => node.attribs.value).get(), ['512', '1024', '2048', '4096']);
    assert.equal($('#mmdArShadowMapPreviewRows[hidden]').length, 1);
    assert.equal($('#panel canvas[width="256"][height="256"]').length, 2);
    assert.equal($('#mmdArShadowCameraScale').attr('min'), '0.1');
    assert.equal($('#mmdArShadowCameraScale').attr('max'), '2');
    assert.equal($('#mmdArShadowCameraScale').attr('step'), '0.01');
    assert.equal($('#mmdArShadowCameraScale').attr('value'), '1');
    assert.match($('#panel').text(), /自动范围基准已缩至原来的0.5/u);
    assert.doesNotThrow(() => new vm.Script(PANEL_JS));
    const source = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js', 'utf8');
    const output = addShadowMapRuntime(source, './web-shadow-map-preview.mjs?v=test');
    assert.match(output, /shadowMapPreview.update\(now\)/u);
    assert.match(output, /shadowMapPreview.dispose\(\)/u);
    assert.throws(() => addShadowMapRuntime(source.replace('        ambientOcclusion.dispose();', ''), './preview'), /锚点缺失/u);
    assert.throws(() => addShadowMapRuntime(source + '\n        ambientOcclusion.dispose();', './preview'), /锚点缺失/u);
});
