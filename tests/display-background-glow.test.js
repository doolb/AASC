'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const configService = require('../src/apps/server/modules/config/config-app-service');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const server = read('src/apps/server/boot/server-app.js');
const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
const controlScript = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const selfTest = read('src/apps/web-mediacenter/ui/public/js/self-test.js');
const display = read('src/apps/web-mediacenter/ui/public/display.html');
const displayCss = read('src/apps/web-mediacenter/ui/public/css/display.css');
const glowScript = read('src/apps/web-mediacenter/ui/public/js/display-background-glow.js');

function createGlowControlHarness() {
    const inputs = {
        color: { value: '#B4C8EF', handlers: {} },
        centerRange: { value: '14', handlers: {} },
        spread: { value: '66', handlers: {} }
    };
    Object.values(inputs).forEach(input => {
        input.addEventListener = (name, handler) => { input.handlers[name] = handler; };
    });
    const outputs = {
        color: { textContent: '' },
        centerRange: { textContent: '' },
        spread: { textContent: '' }
    };
    const cssVariables = new Map();
    const sentMessages = [];
    const ids = {
        displayBackgroundGlowColor: inputs.color,
        displayBackgroundGlowCenterRange: inputs.centerRange,
        displayBackgroundGlowSpread: inputs.spread,
        displayBackgroundGlowColorValue: outputs.color,
        displayBackgroundGlowCenterRangeValue: outputs.centerRange,
        displayBackgroundGlowSpreadValue: outputs.spread
    };
    const documentObject = {
        documentElement: { style: { setProperty: (name, value) => cssVariables.set(name, value) } },
        getElementById: id => ids[id] || null,
        addEventListener() {}
    };
    const windowObject = {
        WebSocketManager: { ws: { readyState: 1, send: message => sentMessages.push(JSON.parse(message)) } },
        showToast() {}
    };
    vm.runInNewContext(glowScript, { window: windowObject, document: documentObject });
    windowObject.DisplayBackgroundGlow.init();
    return { windowObject, inputs, outputs, cssVariables, sentMessages };
}

test('显示端背景光晕配置使用安全默认值并规范化范围', () => {
    const normalize = configService.normalizeDisplayBackgroundGlowConfig;
    assert.equal(typeof normalize, 'function', '配置服务应导出光晕参数规范化函数');
    assert.equal(typeof configService.getDefaultDisplayBackgroundGlowConfig, 'function');
    const defaults = { color: '#8FA8D5', centerRange: 10, spread: 58 };
    assert.deepEqual(configService.getDefaultDisplayBackgroundGlowConfig(), defaults);
    assert.equal(Object.hasOwn(configService, 'DEFAULT_DISPLAY_BACKGROUND_GLOW'), false,
        '默认对象不得作为可持久化配置字段导出');
    assert.deepEqual(normalize(undefined), defaults);
    assert.deepEqual(normalize({ brightness: 0, centerRange: 30, spread: 10 }), {
        color: '#8FA8D5', centerRange: 20, spread: 25
    });
    assert.deepEqual(normalize({ color: '#abcdef', centerRange: 13, spread: 72 }), {
        color: '#ABCDEF', centerRange: 13, spread: 72
    });
    assert.deepEqual(
        normalize({ color: 'invalid', centerRange: Number.NaN, spread: Number.NaN }, {
            color: '#345678', centerRange: 4, spread: 62
        }),
        { color: '#345678', centerRange: 4, spread: 62 }
    );
});
test('显示端背景光晕配置拒绝非数值输入并规范化有效载荷', () => {
    const validate = configService.validateDisplayBackgroundGlowPayload;
    assert.equal(typeof validate, 'function', '配置服务应导出远端载荷校验函数');
    assert.equal(validate({ color: 'bright', centerRange: 8, spread: 58 }).ok, false);
    assert.equal(validate({ centerRange: 'wide', spread: 58 }).ok, false);
    assert.deepEqual(validate({ color: '#12abEF', centerRange: 15, spread: 70 }), {
        ok: true,
        config: { color: '#12ABEF', centerRange: 15, spread: 70 }
    });
});

test('中心范围驱动纯色中心范围而非 alpha，颜色和新配置同步发送', () => {
    const { windowObject, inputs, outputs, cssVariables, sentMessages } = createGlowControlHarness();

    assert.equal(windowObject.DisplayBackgroundGlow.currentConfig.color, '#8FA8D5');
    inputs.color.value = '#B4C8EF';
    inputs.centerRange.value = '14';
    inputs.spread.value = '66';
    inputs.centerRange.handlers.input();
    assert.equal(cssVariables.get('--display-background-glow-center-range'), '14%');
    assert.equal(cssVariables.get('--display-background-glow-center-color'), '#B4C8EF');
    assert.equal(cssVariables.get('--display-background-glow-middle-color'), '#717E98');
    assert.equal(cssVariables.has('--display-background-glow-brightness'), false,
        '中心范围不可映射为颜色 alpha');
    assert.equal(outputs.color.textContent, '#B4C8EF');
    assert.equal(outputs.centerRange.textContent, '14%');

    inputs.color.handlers.change();
    assert.deepEqual(sentMessages.at(-1), {
        type: 'setDisplayBackgroundGlowConfig',
        config: { color: '#B4C8EF', centerRange: 14, spread: 66 }
    });
});

test('光晕经 WebSocket 持久化广播并在两端连接初始化时下发', () => {
    assert.match(server, /'setDisplayBackgroundGlowConfig'/, '控制端消息应注册光晕配置类型');
    assert.match(server, /config\.set\(['"]ui\.displayBackgroundGlow['"]/, '服务端应持久化全局光晕参数');
    assert.match(server, /if\s*\(!config\.set\(['"]ui\.displayBackgroundGlow['"][\s\S]*?return;/,
        '持久化失败时服务端应停止广播并回传权威值');
    assert.match(server, /displayBackgroundGlowConfig/, '服务端应广播光晕权威配置');
    assert.match(upload, /display-background-glow\.js/, '控制端应加载光晕设置管理器');
    assert.match(upload, /id="displayBackgroundGlowColor"/, '系统设置应提供中心颜色选择器');
    assert.match(upload, /id="displayBackgroundGlowCenterRange"/, '系统设置应提供中心纯色范围滑块');
    assert.match(upload, /中心亮度范围/, '设置标签应说明滑块控制中心色范围');
    assert.doesNotMatch(upload, /id="displayBackgroundGlowBrightness"/);
    assert.match(upload, /id="displayBackgroundGlowSpread"/, '系统设置应提供扩散范围滑块');
    assert.match(selfTest, /id:\s*'display_background_glow_settings'/, '自测模块应检查光晕设置控件');
    assert.match(selfTest, /id:\s*'control_sidebar_orientation'/, '自测模块应检查导航方向布局');
    assert.match(controlScript, /displayBackgroundGlowConfig/, '控制端应接收服务端光晕配置');
    assert.match(display, /displayBackgroundGlowConfig/, '显示端应接收服务端光晕配置');
    assert.match(displayCss, /radial-gradient/, '显示端媒体画布应使用中心渐变底色');
});
