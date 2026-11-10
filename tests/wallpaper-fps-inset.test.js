'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('壁纸 FPS 只避让物理屏幕上的重叠部分，并在旋转和返回前台后恢复', () => {
    const listeners = {};
    const callbacks = [];
    let top = 12;
    let inset = 30;
    const hud = { hidden: true, style: {}, getBoundingClientRect: () => ({ top }) };
    const canvas = { addEventListener: (name, fn) => { listeners[name] = fn; } };
    const render = {};
    const stage = {};
    let changed;
    const window = {
        currentRotation: 0,
        NativeDisplay: { getWallpaperTopInset: () => inset },
        DisplayMmd: { getState: () => ({ visible: true }) },
        addEventListener: (name, fn) => { listeners[name] = fn; },
        requestAnimationFrame: fn => callbacks.push(fn),
        MutationObserver: class { constructor(fn) { changed = fn; } observe() {} }
    };
    const elements = { displayMmdCanvas: canvas, displayMmdFps: hud, displayMmdRenderTime: render, displayStageLayers: stage };
    const document = { readyState: 'complete', hidden: false, getElementById: id => elements[id], addEventListener() {} };
    vm.runInNewContext(fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-mmd-performance.js', 'utf8'), { window, document });
    const flush = () => { while (callbacks.length) callbacks.shift()(); };
    listeners['mmd-performance']({ detail: { running: true } }); flush();
    assert.equal(hud.style.translate, '0px 18px');
    top = 40; listeners.resize(); flush();
    assert.equal(hud.style.translate, '');
    top = 12; window.currentRotation = 90; changed(); flush();
    assert.equal(hud.style.translate, '18px 0px');
    window.currentRotation = 180; changed(); flush();
    assert.equal(hud.style.translate, '0px -18px');
    window.currentRotation = 270; changed(); flush();
    assert.equal(hud.style.translate, '-18px 0px');
    inset = 0; listeners['aasc-wallpaper-inset'](); flush();
    assert.equal(hud.style.translate, '');
});
