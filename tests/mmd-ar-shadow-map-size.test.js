'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const cheerio = require('cheerio');
const { normalizeShadowMapSize, addShadowMapControls, addShadowMapRuntime, PANEL_JS } = require('../3rd/mmd-ar-test/web-shadow-map-size');

test('阴影尺寸限定四档，拒绝隐式空值，按真实设备上限降档', () => {
    for (const size of [512, 1024, 2048, 4096]) assert.equal(normalizeShadowMapSize(size), size);
    for (const value of ['', 'bad', null, true, {}, 8192, 1000, NaN]) assert.equal(normalizeShadowMapSize(value), 1024);
    assert.equal(normalizeShadowMapSize('4096', 3000), 2048);
    assert.equal(normalizeShadowMapSize(4096, 1024), 1024);
    assert.equal(normalizeShadowMapSize(4096, 256), 256);
    assert.equal(normalizeShadowMapSize(512, 8192), 512);
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
    assert.doesNotThrow(() => new vm.Script(PANEL_JS));
    const source = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js', 'utf8');
    const output = addShadowMapRuntime(source, './web-shadow-map-preview.mjs?v=test');
    assert.match(output, /shadowMapPreview.update\(now\)/u);
    assert.match(output, /shadowMapPreview.dispose\(\)/u);
    assert.throws(() => addShadowMapRuntime(source.replace('        ambientOcclusion.dispose();', ''), './preview'), /锚点缺失/u);
    assert.throws(() => addShadowMapRuntime(source + '\n        ambientOcclusion.dispose();', './preview'), /锚点缺失/u);
});
