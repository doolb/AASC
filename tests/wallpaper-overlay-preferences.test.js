'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadControls(native) {
    const nodes = new Map();
    const events = new Map();
    const element = id => {
        if (!nodes.has(id)) nodes.set(id, {
            checked: false, hidden: false, disabled: false, style: {}, textContent: '',
            handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
            setAttribute() {}, getBoundingClientRect() { return { top: 0 }; }
        });
        return nodes.get(id);
    };
    const document = { getElementById: element, body: { classList: { toggle() {} } }, addEventListener() {} };
    const window = {
        document, NativeDisplay: native, localStorage: { getItem: () => null, setItem() {} },
        createWallpaperMotionEstimator: () => ({ reset() {} }), requestAnimationFrame: () => 1,
        addEventListener(type, handler) { events.set(type, handler); }, removeEventListener() {}
    };
    const source = fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/js/display-wallpaper-controls.js'), 'utf8');
    vm.runInNewContext(source, { window });
    return { element, events };
}

test('简略浮窗设置读取、写入并在页面状态切换后保持', () => {
    let simplified = true;
    const { element, events } = loadControls({ isWallpaperActive: () => false,
        getWallpaperOverlaySimplified: () => simplified,
        setWallpaperOverlaySimplified: value => { simplified = value; } });
    const input = element('wallpaperOverlaySimplified');
    assert.equal(input.checked, true);
    assert.equal(input.disabled, false);
    input.checked = false;
    input.handlers.change();
    assert.equal(simplified, false);
    events.get('aasc-wallpaper-mode')();
    assert.equal(input.checked, false);
});

test('旧 APK 没有简略浮窗桥时禁用设置', () => {
    const { element } = loadControls({ isWallpaperActive: () => false });
    const input = element('wallpaperOverlaySimplified');
    assert.equal(input.disabled, true);
    assert.match(input.title, /更新/);
});
