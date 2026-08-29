'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const renderSource = fs.readFileSync(
    path.join(__dirname, '../res/tasks/render-display/render.js'),
    'utf8'
);

test('render-display 进度条外标签应使用固定白字、黑影和正下方主题投影', () => {
    assert.match(renderSource, /lbl\.style\.cssText[\s\S]*?color:#fff/u);
    assert.match(renderSource, /lbl\.style\.cssText[\s\S]*?text-shadow:0 2px 0 var\(--accent-color,#00d2ff\),2px 2px 8px rgba\(0,0,0,0\.8\)/u);
    assert.match(renderSource, /lbl\.style\.cssText[\s\S]*?text-shadow:0 2px 0 color-mix\(in srgb,var\(--accent-color,#00d2ff\) 65%,transparent\),2px 2px 8px rgba\(0,0,0,0\.8\)/u);
    assert.doesNotMatch(renderSource, /lbl\.style\.cssText[\s\S]*?-webkit-text-stroke/u);
    assert.doesNotMatch(renderSource, /lbl\.style\.cssText[\s\S]*?box-shadow:inset/u);
});
