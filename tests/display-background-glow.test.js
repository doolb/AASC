'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const configService = require('../src/apps/server/modules/config/config-app-service');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const server = read('src/apps/server/boot/server-app.js');
const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
const controlScript = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const selfTest = read('src/apps/web-mediacenter/ui/public/js/self-test.js');
const display = read('src/apps/web-mediacenter/ui/public/display.html');
const displayCss = read('src/apps/web-mediacenter/ui/public/css/display.css');

test('显示端背景光晕配置使用安全默认值并规范化范围', () => {
    const normalize = configService.normalizeDisplayBackgroundGlowConfig;
    assert.equal(typeof normalize, 'function', '配置服务应导出光晕参数规范化函数');
    assert.equal(typeof configService.getDefaultDisplayBackgroundGlowConfig, 'function');
    assert.deepEqual(configService.getDefaultDisplayBackgroundGlowConfig(), { brightness: 100, spread: 58 });
    assert.equal(Object.hasOwn(configService, 'DEFAULT_DISPLAY_BACKGROUND_GLOW'), false,
        '默认对象不得作为可持久化配置字段导出');
    assert.deepEqual(normalize(undefined), { brightness: 100, spread: 58 });
    assert.deepEqual(normalize({ brightness: 130, spread: 10 }), { brightness: 100, spread: 25 });
    assert.deepEqual(
        normalize({ brightness: 'bad', spread: Number.NaN }, { brightness: 45, spread: 62 }),
        { brightness: 45, spread: 62 }
    );
});
test('显示端背景光晕配置拒绝非数值输入并规范化有效载荷', () => {
    const validate = configService.validateDisplayBackgroundGlowPayload;
    assert.equal(typeof validate, 'function', '配置服务应导出远端载荷校验函数');
    assert.equal(validate({ brightness: 'bright', spread: 58 }).ok, false);
    assert.deepEqual(validate({ brightness: 90, spread: 70 }), {
        ok: true,
        config: { brightness: 90, spread: 70 }
    });
});

test('光晕经 WebSocket 持久化广播并在两端连接初始化时下发', () => {
    assert.match(server, /'setDisplayBackgroundGlowConfig'/, '控制端消息应注册光晕配置类型');
    assert.match(server, /config\.set\(['"]ui\.displayBackgroundGlow['"]/, '服务端应持久化全局光晕参数');
    assert.match(server, /if\s*\(!config\.set\(['"]ui\.displayBackgroundGlow['"][\s\S]*?return;/,
        '持久化失败时服务端应停止广播并回传权威值');
    assert.match(server, /displayBackgroundGlowConfig/, '服务端应广播光晕权威配置');
    assert.match(upload, /display-background-glow\.js/, '控制端应加载光晕设置管理器');
    assert.match(upload, /id="displayBackgroundGlowBrightness"/, '系统设置应提供中心亮度滑块');
    assert.match(upload, /id="displayBackgroundGlowSpread"/, '系统设置应提供扩散范围滑块');
    assert.match(selfTest, /id:\s*'display_background_glow_settings'/, '自测模块应检查光晕设置控件');
    assert.match(selfTest, /id:\s*'control_sidebar_orientation'/, '自测模块应检查导航方向布局');
    assert.match(controlScript, /displayBackgroundGlowConfig/, '控制端应接收服务端光晕配置');
    assert.match(display, /displayBackgroundGlowConfig/, '显示端应接收服务端光晕配置');
    assert.match(displayCss, /radial-gradient/, '显示端媒体画布应使用中心渐变底色');
});
