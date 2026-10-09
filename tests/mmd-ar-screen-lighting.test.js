'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const cheerio = require('cheerio');
const { panel: addScreenLightingPanel } = require('../3rd/mmd-ar-test/web-screen-lighting-build');

function makeControl(name, type = 'range', value = '') {
    return { type, value: String(value), checked: false, disabled: false,
        dataset: { screenLighting: name }, listeners: {},
        addEventListener(eventName, callback) { this.listeners[eventName] = callback; } };
}

class FakeVector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
}
class FakeVector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    sub(value) { this.x -= value.x; this.y -= value.y; this.z -= value.z; return this; }
    normalize() { const length = Math.hypot(this.x, this.y, this.z) || 1; this.x /= length; this.y /= length; this.z /= length; return this; }
    transformDirection() { return this; }
}
class FakeMatrix4 {
    constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    copy(other) { this.elements = [...other.elements]; return this; }
}
class FakeRenderTarget {
    static created = [];
    constructor(width, height) { this.width = width; this.height = height; this.texture = { id: `render-target-${FakeRenderTarget.created.length}` }; this.disposed = false; FakeRenderTarget.created.push(this); }
    setSize(width, height) { this.width = width; this.height = height; }
    dispose() { this.disposed = true; }
}
class FakeShaderMaterial {
    constructor(options) { Object.assign(this, options); this.disposed = false; }
    dispose() { this.disposed = true; }
}
class FakeScene { constructor() { this.children = []; } add(child) { this.children.push(child); } }
class FakeMesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
class FakeCamera {
    constructor() { this.matrixWorld = new FakeMatrix4(); this.matrixWorldInverse = new FakeMatrix4(); this.projectionMatrix = new FakeMatrix4(); this.projectionMatrixInverse = new FakeMatrix4(); }
    updateMatrixWorld() {}
}
class FakeGeometry { dispose() { this.disposed = true; } }
function createRuntimeFixture() {
    FakeRenderTarget.created = [];
    const draws = [];
    let currentTarget = null;
    const renderer = {
        extensions: { has: () => true }, getRenderTarget: () => currentTarget,
        setRenderTarget(target) { currentTarget = target; }, setViewport() {}, clear() {},
        render(scene) {
            const material = scene.children[0].material, output = currentTarget?.texture;
            const inputs = Object.entries(material.uniforms || {}).filter(([name]) =>
                name === 'tInput' || name === 'tDepthInput' || name === 'tDepth' || name === 'tContactDepth' || name === 'tColor' || name === 'tHistoryColor' || /^tHistoryDepth\d+$/u.test(name))
                .map(([name, uniform]) => [name, uniform.value]);
            const alias = inputs.find(([, texture]) => texture === output);
            assert.ok(!alias, `pass ${alias?.[0]} 不得对同一纹理读写：${output?.id}`);
            draws.push({ material, output, inputs, historyValid: material.uniforms?.historyValid?.value,
                contactStepCount: material.uniforms?.contactStepCount?.value, stepCount: material.uniforms?.stepCount?.value,
                filterContact: material.uniforms?.filterContact?.value });
        }
    };
    const THREE = {
        WebGLRenderTarget: FakeRenderTarget, ShaderMaterial: FakeShaderMaterial, Vector2: FakeVector2,
        Vector3: FakeVector3, Matrix4: FakeMatrix4, Scene: FakeScene, Mesh: FakeMesh,
        PlaneGeometry: FakeGeometry, OrthographicCamera: FakeCamera,
        NearestFilter: 1, LinearFilter: 2, RGBAFormat: 3, HalfFloatType: 4, UnsignedByteType: 5, NoBlending: 0
    };
    return { THREE, renderer, draws };
}

function createPanelFixture() {
    const names = ['contactEnabled', 'contactStrength', 'contactDistance', 'contactStepCount', 'giEnabled', 'giStrength', 'giRadius',
        'giBlurPassCount', 'giBlurRadius1', 'giBlurRadius2', 'giBlurRadius3', 'quality',
        'contactBlurPassCount', 'contactBlurRadius1', 'contactBlurRadius2', 'contactBlurRadius3'];
    const inputs = names.map(name => makeControl(name,
        ['contactEnabled', 'giEnabled'].includes(name) ? 'checkbox' : ['giBlurPassCount', 'contactBlurPassCount', 'quality'].includes(name) ? 'select-one' : 'range',
        name === 'quality' ? 'low' : name === 'giBlurPassCount' ? '1' : ''));
    const outputs = new Map(names.filter(name => !['contactEnabled', 'giEnabled', 'quality'].includes(name))
        .map(name => [name, { textContent: '' }]));
    const rounds = [1, 2, 3].map(index => [String(index), { hidden: index > 1 }]);
    const contactRounds = [1, 2, 3].map(index => [String(index), { hidden: index > 1 }]);
    const status = { textContent: '' };
    const panel = {
        querySelector(selector) {
            const setting = selector.match(/^\[data-screen-lighting="([^"]+)"\]$/u);
            if (setting) return inputs.find(input => input.dataset.screenLighting === setting[1]) || null;
            const output = selector.match(/^\[data-screen-value="([^"]+)"\]$/u);
            if (output) return outputs.get(output[1]) || null;
            const round = selector.match(/^\[data-screen-blur-round="([1-3])"\]$/u);
            if (round) return rounds.find(([index]) => index === round[1])?.[1] || null;
            const contactRound = selector.match(/^\[data-contact-blur-round="([1-3])"\]$/u);
            if (contactRound) return contactRounds.find(([index]) => index === contactRound[1])?.[1] || null;
            return selector === '[data-screen-status]' ? status : null;
        },
        querySelectorAll(selector) {
            if (selector === '[data-screen-lighting]' || selector === 'input,select') return inputs;
            return [];
        }
    };
    const reset = { listeners: {}, addEventListener(eventName, callback) { this.listeners[eventName] = callback; } };
    return { panel, inputs, outputs, rounds, contactRounds, status, reset };
}

test('SSGI模糊设置兼容旧值并限制轮数和逐轮半径', async () => {
    const { defaults, normalizeScreenLightingSettings } = await import('../3rd/mmd-ar-test/web-screen-lighting-panel.mjs');
    assert.equal(defaults.giBlurPassCount, 1);
    assert.deepEqual([...defaults.giBlurRadii], [3, 3, 3]);
    const legacy = normalizeScreenLightingSettings({ giEnabled: true, quality: 'high' });
    assert.equal(legacy.giBlurPassCount, 1);
    assert.deepEqual(legacy.giBlurRadii, [3, 3, 3]);
    assert.equal(legacy.giEnabled, true);
    const clamped = normalizeScreenLightingSettings({ giBlurPassCount: 8, giBlurRadii: [0, 2.6, 'bad'] });
    assert.equal(clamped.giBlurPassCount, 3);
    assert.deepEqual(clamped.giBlurRadii, [1, 3, 3]);
    assert.equal(normalizeScreenLightingSettings({ giBlurPassCount: -1 }).giBlurPassCount, 0);
});

test('接触保边模糊默认一轮，独立于SSGI，并连续读取前一个pass结果', async () => {
    const { normalizeScreenLightingSettings: normalize } = await import('../3rd/mmd-ar-test/web-screen-lighting-panel.mjs');
    const { createScreenLightingBlurPassPlan } = await import('../3rd/mmd-ar-test/web-screen-lighting.mjs');
    assert.equal(normalize({}).contactBlurPassCount, 1);
    assert.deepEqual(normalize({}).contactBlurRadii, [3, 3, 3]);
    const settings = normalize({ contactEnabled: true, giEnabled: true, contactBlurPassCount: 7,
        contactBlurRadii: [0, 2.6, 9], giBlurPassCount: 1, giBlurRadii: [4, 4, 4] });
    assert.equal(settings.contactBlurPassCount, 3);
    assert.deepEqual(settings.contactBlurRadii, [1, 3, 5]);
    const plan = createScreenLightingBlurPassPlan(settings);
    assert.deepEqual(plan.steps.map(step => step.channel), ['gi', 'gi', 'contact', 'contact', 'contact', 'contact', 'contact', 'contact']);
    assert.deepEqual(plan.steps.map(step => step.radius), [4, 4, 1, 1, 3, 3, 5, 5]);
    let previous = 0;
    for (const step of plan.steps) {
        assert.equal(step.inputIndex, previous);
        assert.notEqual(step.outputIndex, previous);
        previous = step.outputIndex;
    }
    assert.equal(plan.targetIndex, previous);
    assert.deepEqual(createScreenLightingBlurPassPlan({ contactEnabled: false, giEnabled: false }).steps, []);
});

test('接触阴影步数沿用旧质量迁移，整数化并限定4–64，显式设置独立于质量', async () => {
    const { defaults, normalizeScreenLightingSettings: normalize } = await import('../3rd/mmd-ar-test/web-screen-lighting-panel.mjs');
    assert.equal(defaults.contactStepCount, 12);
    for (const [quality, count] of [['low', 12], ['medium', 20], ['high', 32]]) {
        assert.equal(normalize({ quality }).contactStepCount, count);
        for (const raw of [null, '', ' ', 'bad', true, [], {}]) assert.equal(normalize({ quality, contactStepCount: raw }).contactStepCount, count);
        assert.equal(normalize({ quality, contactStepCount: 17 }).contactStepCount, 17);
    }
    for (const [raw, expected] of [[-1, 4], [1, 4], [4, 4], [7.6, 8], ['64', 64], [99, 64]]) {
        assert.equal(normalize({ contactStepCount: raw }).contactStepCount, expected);
    }
});

test('SSGI滤波计划按轮数横纵ping-pong，零轮或GI关闭时旁路', async () => {
    const { createGiBlurPassPlan } = await import('../3rd/mmd-ar-test/web-screen-lighting.mjs');
    const disabled = createGiBlurPassPlan({ contactEnabled: true, giEnabled: false, giBlurPassCount: 3 });
    assert.deepEqual(disabled, { steps: [], targetIndex: 0 }, '仅接触阴影时不生成GI模糊通道');
    const none = createGiBlurPassPlan({ giEnabled: true, giBlurPassCount: 0 });
    assert.deepEqual(none, { steps: [], targetIndex: 0 }, '0轮直接使用原始效果');
    const one = createGiBlurPassPlan({ giEnabled: true, giBlurPassCount: 1, giBlurRadii: [4, 2, 5] });
    assert.deepEqual(one.steps, [
        { inputIndex: 0, outputIndex: 1, radius: 4, axis: 'horizontal' },
        { inputIndex: 1, outputIndex: 2, radius: 4, axis: 'vertical' }
    ]);
    const three = createGiBlurPassPlan({ giEnabled: true, giBlurPassCount: 3, giBlurRadii: [1, 3, 5] });
    assert.equal(three.steps.length, 6);
    assert.deepEqual(three.steps.map(step => step.radius), [1, 1, 3, 3, 5, 5]);
    assert.ok(three.steps.every(step => step.inputIndex !== step.outputIndex), '禁止同目标读写');
    assert.equal(three.targetIndex, 2);
});

test('Reduction与HZB尺寸覆盖奇数输入并逐级降至目标', async () => {
    const { createReductionSteps, createHzbLevelSizes } = await import('../3rd/mmd-ar-test/web-screen-lighting.mjs');
    assert.deepEqual(createReductionSteps(1921, 1081, 384, 216), [
        { width: 961, height: 541 }, { width: 481, height: 271 }, { width: 384, height: 216 }
    ]);
    assert.deepEqual(createReductionSteps(3, 5, 3, 5), [{ width: 3, height: 5 }]);
    assert.deepEqual(createHzbLevelSizes(5, 3), [
        { width: 5, height: 3 }, { width: 3, height: 2 }, { width: 2, height: 1 }, { width: 1, height: 1 }
    ]);
});

test('相机切断或投影突变使历史失效', async () => {
    const { isCameraCut } = await import('../3rd/mmd-ar-test/web-screen-lighting.mjs');
    const world = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    const projection = { elements: [...world.elements] };
    assert.equal(isCameraCut(world, world, projection, projection), false);
    const translated = { elements: [...world.elements] }; translated.elements[12] = 9;
    assert.equal(isCameraCut(world, translated, projection, projection), true);
    const rotated = { elements: [...world.elements] }; rotated.elements[8] = 1; rotated.elements[10] = 0;
    assert.equal(isCameraCut(world, rotated, projection, projection), true);
    const changedProjection = { elements: [...projection.elements] }; changedProjection.elements[0] = 2;
    assert.equal(isCameraCut(world, world, projection, changedProjection), true);
});

test('SSGI Shader使用前帧SceneColor与HZB，不累积上一帧GI输出', async () => {
    const { fragmentShader, depthReductionShader, colorReductionShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    assert.match(fragmentShader, /uniform sampler2D tColor,tHistoryColor/u);
    assert.match(fragmentShader, /previousView\*cameraWorld/u);
    assert.match(fragmentShader, /historyDepthRange\(uv,level\)/u);
    assert.match(fragmentShader, /historyHitVisible\(hit,hitUv,thickness\)/u);
    assert.match(fragmentShader, /traceCurrent\(start,dir,giRadius/u);
    assert.doesNotMatch(fragmentShader, /tHistoryGi|previousGiAccumulation/u);
    assert.match(depthReductionShader, /nearestDepth=min\(nearestDepth,sampleValue\.r\)/u);
    assert.match(depthReductionShader, /farthestDepth=max\(farthestDepth,sampleValue\.g\)/u);
    assert.match(depthReductionShader, /packDepth16/u);
    assert.match(colorReductionShader, /uniform highp sampler2D tDepthInput/u);
    assert.match(colorReductionShader, /exp\(-abs\(z0-referenceZ\)\/tolerance\)/u);
});

test('滤波shader限制在深度/法线边界内，按模式保留另一通道', async () => {
    const { filterShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    assert.match(filterShader, /uniform int blurRadius/u);
    assert.match(filterShader, /if\(abs\(i\)>blurRadius\)continue;/u);
    assert.match(filterShader, /plane\/tolerance\).*dot\(n,otherNormal\)/u);
    assert.match(filterShader, /filterContact\?center\.rgb:filtered\.rgb/u);
    assert.match(filterShader, /filterContact\?filtered\.a:center\.a/u);
});

test('历史SceneColor/HZB双缓冲首帧回退且所有pass无读写别名', async () => {
    const { createScreenLighting } = await import('../3rd/mmd-ar-test/web-screen-lighting.mjs');
    const { colorReductionShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    const fixture = createRuntimeFixture();
    const camera = new FakeCamera();
    const colorTarget = new FakeRenderTarget(640, 360);
    const depthTexture = { id: 'current-depth' };
    const compositeMaterial = { uniforms: {
        screenAoEnabled: { value: 1 }, screenLightingEnabled: { value: false }, screenLightingTexture: { value: null },
        screenLightingSize: { value: new FakeVector2() }, screenLightingFullSize: { value: new FakeVector2() }
    } };
    const ao = { colorTarget, depthTexture, compositeMaterial };
    const previousWindow = globalThis.window;
    globalThis.window = { MmdArScreenLighting: { giEnabled: true, contactEnabled: false, quality: 'low', giBlurPassCount: 0 } };
    const lighting = createScreenLighting({ ...fixture, camera, keyLight: null });
    try {
        lighting.prepare(ao, 640, 360, false, false);
        let giPasses = fixture.draws.filter(draw => draw.historyValid !== undefined);
        assert.equal(giPasses.length, 1);
        assert.equal(giPasses[0].historyValid, false, '首帧必须回退当前场景颜色');
        assert.equal(giPasses[0].contactStepCount, 12);
        assert.equal(giPasses[0].stepCount, 12);
        assert.ok(fixture.draws.some(draw => draw.material.fragmentShader === colorReductionShader &&
            draw.inputs.some(([name, texture]) => name === 'tInput' && texture === colorTarget.texture)),
        '待写入历史从未合成GI的SceneColor采集');
        lighting.prepare(ao, 640, 360, false, false);
        giPasses = fixture.draws.filter(draw => draw.historyValid !== undefined);
        assert.deepEqual(giPasses.map(draw => draw.historyValid), [false, true]);
        globalThis.window.MmdArScreenLighting = { giEnabled: true, contactEnabled: true, quality: 'high', contactStepCount: 64, giBlurPassCount: 0 };
        lighting.prepare(ao, 640, 360, false, false);
        const independent = fixture.draws.filter(draw => draw.historyValid !== undefined).at(-1);
        assert.equal(independent.contactStepCount, 64, '接触阴影手动步数下发GPU');
        assert.equal(independent.stepCount, 32, 'SSGI仍由质量控制步数');
        globalThis.window.MmdArScreenLighting.quality = 'medium';
        lighting.prepare(ao, 640, 360, false, false);
        camera.matrixWorld.elements[12] = 9;
        lighting.prepare(ao, 640, 360, false, false);
        giPasses = fixture.draws.filter(draw => draw.historyValid !== undefined);
        assert.deepEqual(giPasses.map(draw => draw.historyValid), [false, true, false, false, false],
            '质量变化和相机切断后必须重新用当前帧初始化历史');
        globalThis.window.MmdArScreenLighting.giEnabled = false;
        globalThis.window.MmdArScreenLighting.contactEnabled = false;
        const targetCount = FakeRenderTarget.created.length;
        lighting.prepare(ao, 640, 360, false, true);
        assert.equal(FakeRenderTarget.created.length, targetCount, 'AO独立运行时不创建屏幕光照目标');
        assert.ok(FakeRenderTarget.created.filter(target => target !== colorTarget).every(target => target.disposed),
            '屏幕光照关闭后释放全部效果/历史目标');
        assert.ok(fixture.draws.every(draw => draw.inputs.every(([, texture]) => texture !== draw.output)),
            '颜色归约、深度归约、HZB、GI和滤波均不得输入输出同纹理');
    } finally {
        lighting.dispose();
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
    assert.ok(FakeRenderTarget.created.filter(target => target !== colorTarget).every(target => target.disposed),
        '销毁时释放历史色彩、HZB和屏幕光照目标');
});

test('本帧接触范围先生成再追踪，奇数尺寸/关闭/异常恢复目标与滤波通道独立', async () => {
    const { createScreenLighting } = await import('../3rd/mmd-ar-test/web-screen-lighting.mjs');
    const { contactDepthReductionShader, fragmentShader, filterShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    const fixture = createRuntimeFixture(), colorTarget = new FakeRenderTarget(641, 361);
    const compositeMaterial = { uniforms: {
        screenAoEnabled: { value: 1 }, screenLightingEnabled: { value: false }, screenLightingTexture: { value: null },
        screenLightingSize: { value: new FakeVector2() }, screenLightingFullSize: { value: new FakeVector2() }
    } };
    const ao = { colorTarget, depthTexture: { id: 'depth-first-frame' }, compositeMaterial };
    const previousWindow = globalThis.window, previousTarget = new FakeRenderTarget(20, 10);
    globalThis.window = { MmdArScreenLighting: { contactEnabled: true, giEnabled: false, contactBlurPassCount: 1 } };
    const lighting = createScreenLighting({ ...fixture, camera: new FakeCamera(), keyLight: null });
    fixture.renderer.setRenderTarget(previousTarget);
    try {
        lighting.prepare(ao, 641, 361, false, false);
        assert.deepEqual(fixture.draws.map(draw => draw.material.fragmentShader), [contactDepthReductionShader, fragmentShader, filterShader, filterShader]);
        const rangeTarget = FakeRenderTarget.created.find(target => target.texture === fixture.draws[0].output);
        assert.deepEqual([rangeTarget.width, rangeTarget.height], [321, 181]);
        assert.equal(fixture.draws[0].inputs.find(([name]) => name === 'tInput')[1], ao.depthTexture);
        assert.equal(fixture.draws[1].inputs.find(([name]) => name === 'tContactDepth')[1], rangeTarget.texture);
        assert.deepEqual(fixture.draws.slice(2).map(draw => draw.filterContact), [true, true]);
        assert.equal(fixture.renderer.getRenderTarget(), previousTarget);
        ao.depthTexture = { id: 'depth-second-frame' };
        const oldDrawCount = fixture.draws.length;
        lighting.prepare(ao, 1282, 722, false, false);
        assert.deepEqual([rangeTarget.width, rangeTarget.height], [641, 361]);
        assert.equal(fixture.draws[oldDrawCount].inputs.find(([name]) => name === 'tInput')[1], ao.depthTexture, '粗深度每帧更新');
        globalThis.window.MmdArScreenLighting = { contactEnabled: false, giEnabled: true, giBlurPassCount: 1 };
        lighting.prepare(ao, 641, 361, false, false);
        assert.equal(rangeTarget.disposed, true, '仅关闭接触也立即释放当前帧范围目标');
        assert.deepEqual(fixture.draws.filter(draw => draw.filterContact !== undefined).slice(-2).map(draw => draw.filterContact), [false, false]);
        globalThis.window.MmdArScreenLighting = { contactEnabled: true, giEnabled: false, contactBlurPassCount: 0 };
        const render = fixture.renderer.render;
        fixture.renderer.render = () => { throw new Error('模拟离屏绘制失败'); };
        assert.throws(() => lighting.prepare(ao, 641, 361, false, false), /模拟离屏绘制失败/u);
        assert.equal(fixture.renderer.getRenderTarget(), previousTarget, '归约或效果异常都须恢复原目标');
        fixture.renderer.render = render;
    } finally {
        lighting.dispose();
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
    assert.ok(FakeRenderTarget.created.filter(target => target !== colorTarget && target !== previousTarget).every(target => target.disposed));
});

test('接触阴影和SSGI位于下方正式分类，保留模糊控件并新增采样滑块', () => {
    const $ = cheerio.load('<div id="displayMmdLightingPanel"><header class="display-mmd-lighting-header"><button id="displayMmdLightingReset"></button></header><section class="mmd-ar-panel-group" id="existingLight"></section></div>');
    addScreenLightingPanel($);
    const panel = $('#mmdArScreenLighting');
    assert.equal(panel.parent().attr('id'), 'displayMmdLightingPanel');
    assert.equal(panel.prev().attr('id'), 'existingLight', '分类追加到现有正式灯光组下方');
    assert.equal($('.display-mmd-lighting-header #mmdArScreenLighting').length, 0);
    assert.equal(panel.find('details').length, 0);
    assert.equal(panel.find('#mmdArContactLighting > .mmd-ar-panel-group-header [data-group-title="接触阴影"]').length, 1);
    assert.equal(panel.find('#mmdArIndirectLighting > .mmd-ar-panel-group-header [data-group-title="间接光"]').length, 1);
    assert.equal(panel.find('#mmdArSsgi > .mmd-ar-panel-group-header [data-group-title="SSGI"]').length, 1);
    assert.equal(panel.find('#mmdArSsgi').parents('#mmdArIndirectLighting').length, 1);
    assert.equal(panel.text().includes('实验'), false);
    const samples = panel.find('[data-screen-lighting="contactStepCount"]');
    assert.equal(samples.attr('min'), '4'); assert.equal(samples.attr('max'), '64'); assert.equal(samples.attr('step'), '1');
    assert.deepEqual(panel.find('#mmdArContactLighting [data-screen-lighting="contactBlurPassCount"] option')
        .map((_, node) => node.attribs.value).get(), ['0', '1', '2', '3']);
    for (let index = 1; index <= 3; index += 1) {
        const input = panel.find(`#mmdArContactLighting [data-screen-lighting="contactBlurRadius${index}"]`);
        assert.equal(input.attr('min'), '1'); assert.equal(input.attr('max'), '5'); assert.equal(input.attr('value'), '3');
    }
    assert.deepEqual(panel.find('[data-screen-lighting="giBlurPassCount"] option').map((_, node) => node.attribs.value).get(), ['0', '1', '2', '3']);
    assert.equal(panel.find('[data-screen-lighting="giBlurPassCount"] option[selected]').attr('value'), '1');
    for (let index = 1; index <= 3; index += 1) {
        const input = panel.find(`[data-screen-lighting="giBlurRadius${index}"]`);
        assert.equal(input.attr('min'), '1'); assert.equal(input.attr('max'), '5');
        assert.equal(input.attr('value'), '3');
    }
    assert.equal(panel.find('[data-screen-blur-round="2"][hidden]').length, 1);
    assert.equal(panel.find('[data-screen-blur-round="3"][hidden]').length, 1);
});

test('SSGI面板旧设置加载默认轮数，调节持久化并恢复默认', async () => {
    const { initScreenLightingPanel } = await import('../3rd/mmd-ar-test/web-screen-lighting-panel.mjs');
    const fixture = createPanelFixture();
    const storageKey = 'aasc.mmdArTest.screenLighting.v1';
    const store = { [storageKey]: JSON.stringify({ giEnabled: true, giStrength: 2, quality: 'medium' }) };
    const previous = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
    globalThis.document = { readyState: 'complete', getElementById: id => id === 'mmdArScreenLighting' ? fixture.panel : id === 'displayMmdLightingReset' ? fixture.reset : null };
    globalThis.window = { MmdArScreenLightingSupported: true, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
    globalThis.localStorage = { getItem: key => store[key] || null, setItem: (key, value) => { store[key] = value; } };
    try {
        initScreenLightingPanel();
        assert.equal(globalThis.window.MmdArScreenLighting.giBlurPassCount, 1);
        assert.equal(globalThis.window.MmdArScreenLighting.contactBlurPassCount, 1);
        const contactCount = fixture.inputs.find(input => input.dataset.screenLighting === 'contactBlurPassCount');
        contactCount.value = '3'; contactCount.listeners.change();
        assert.equal(fixture.contactRounds[2][1].hidden, false);
        const contactRadius = fixture.inputs.find(input => input.dataset.screenLighting === 'contactBlurRadius3');
        contactRadius.value = '4'; contactRadius.listeners.input();
        assert.equal(JSON.parse(store[storageKey]).contactBlurRadii[2], 4);
        assert.deepEqual([...globalThis.window.MmdArScreenLighting.giBlurRadii], [3, 3, 3]);
        assert.equal(globalThis.window.MmdArScreenLighting.contactStepCount, 20, '旧中质量迁移为20步');
        const samples = fixture.inputs.find(input => input.dataset.screenLighting === 'contactStepCount');
        samples.value = '51'; samples.listeners.input();
        assert.equal(JSON.parse(store[storageKey]).contactStepCount, 51);
        assert.equal(fixture.outputs.get('contactStepCount').textContent, '51');
        assert.deepEqual([...globalThis.window.MmdArScreenLighting.giBlurRadii], [3, 3, 3]);
        assert.equal(fixture.rounds[1][1].hidden, true);
        const radius = fixture.inputs.find(input => input.dataset.screenLighting === 'giBlurRadius2');
        radius.value = '5'; radius.listeners.input();
        assert.equal(JSON.parse(store[storageKey]).giBlurRadii[1], 5);
        const passCount = fixture.inputs.find(input => input.dataset.screenLighting === 'giBlurPassCount');
        passCount.value = '3'; passCount.listeners.input();
        assert.equal(fixture.rounds[2][1].hidden, false);
        fixture.reset.listeners.click();
        const saved = JSON.parse(store[storageKey]);
        assert.equal(saved.giBlurPassCount, 1);
        assert.equal(saved.contactBlurPassCount, 1);
        assert.deepEqual(saved.contactBlurRadii, [3, 3, 3]);
        assert.equal(saved.contactStepCount, 12);
        assert.deepEqual(saved.giBlurRadii, [3, 3, 3]);
    } finally {
        for (const name of ['document', 'window', 'localStorage']) {
            if (previous[name] === undefined) delete globalThis[name]; else globalThis[name] = previous[name];
        }
    }
});
