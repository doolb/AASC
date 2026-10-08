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

function createPanelFixture() {
    const names = ['contactEnabled', 'contactStrength', 'contactDistance', 'giEnabled', 'giStrength', 'giRadius',
        'giBlurPassCount', 'giBlurRadius1', 'giBlurRadius2', 'giBlurRadius3', 'quality'];
    const inputs = names.map(name => makeControl(name,
        ['contactEnabled', 'giEnabled'].includes(name) ? 'checkbox' : ['giBlurPassCount', 'quality'].includes(name) ? 'select-one' : 'range',
        name === 'quality' ? 'low' : name === 'giBlurPassCount' ? '1' : ''));
    const outputs = new Map(names.filter(name => !['contactEnabled', 'giEnabled', 'quality'].includes(name))
        .map(name => [name, { textContent: '' }]));
    const rounds = [1, 2, 3].map(index => [String(index), { hidden: index > 1 }]);
    const status = { textContent: '' };
    const panel = {
        querySelector(selector) {
            const setting = selector.match(/^\[data-screen-lighting="([^"]+)"\]$/u);
            if (setting) return inputs.find(input => input.dataset.screenLighting === setting[1]) || null;
            const output = selector.match(/^\[data-screen-value="([^"]+)"\]$/u);
            if (output) return outputs.get(output[1]) || null;
            const round = selector.match(/^\[data-screen-blur-round="([1-3])"\]$/u);
            if (round) return rounds.find(([index]) => index === round[1])?.[1] || null;
            return selector === '[data-screen-status]' ? status : null;
        },
        querySelectorAll(selector) {
            if (selector === '[data-screen-lighting]' || selector === 'input,select') return inputs;
            return [];
        }
    };
    const reset = { listeners: {}, addEventListener(eventName, callback) { this.listeners[eventName] = callback; } };
    return { panel, inputs, outputs, rounds, status, reset };
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

test('滤波shader限制在深度/法线边界内并原样保留接触阴影中心alpha', async () => {
    const { filterShader } = await import('../3rd/mmd-ar-test/web-screen-lighting-shader.mjs');
    assert.match(filterShader, /uniform int blurRadius/u);
    assert.match(filterShader, /if\(abs\(i\)>blurRadius\)continue;/u);
    assert.match(filterShader, /plane\/tolerance\).*dot\(n,otherNormal\)/u);
    assert.match(filterShader, /gl_FragColor=vec4\(total>1e-5\?sum\.rgb\/total:center\.rgb,center\.a\)/u);
});

test('SSGI面板生成0–3轮及三组逐轮半径控件', () => {
    const $ = cheerio.load('<button id="displayMmdLightingReset"></button>');
    addScreenLightingPanel($);
    const panel = $('#mmdArScreenLighting');
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
        assert.deepEqual(saved.giBlurRadii, [3, 3, 3]);
    } finally {
        for (const name of ['document', 'window', 'localStorage']) {
            if (previous[name] === undefined) delete globalThis[name]; else globalThis[name] = previous[name];
        }
    }
});
