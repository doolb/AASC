'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/apps/web-mediacenter/ui/public/js/display-wallpaper-motion.js');
const g = 9.80665;
const event = (x, y, z, beta = 0) => ({ accelerationIncludingGravity: { x, y, z }, rotationRate: { beta, gamma: 0, alpha: 0 } });

test('六轴去重力：静止、平移、缺失数据和长间隔', () => {
    const sensor = globalThis.createWallpaperMotionEstimator();
    assert.deepEqual(sensor.sample(event(0, 0, g), 0), [0, 0, 0]);
    const rest = sensor.sample(event(0, 0, g), 10);
    assert.ok(Math.hypot(...rest) < 1e-8);
    assert.ok(Math.abs(sensor.sample(event(2, 0, g), 20)[0] - 2) < 1e-8);
    assert.equal(sensor.sample({ acceleration: { x: 1, y: 0, z: 0 } }, 30), null);
    assert.deepEqual(sensor.sample(event(0, 0, g), 500), [0, 0, 0]);
});

test('纯旋转不应把重力误判为平移', () => {
    const sensor = globalThis.createWallpaperMotionEstimator();
    sensor.sample(event(0, 0, g), 0);
    for (let i = 1; i <= 100; i++) {
        const angle = i * Math.PI / 200;
        const result = sensor.sample(event(0, g * Math.sin(angle), g * Math.cos(angle), 90), i * 10);
        assert.ok(Math.hypot(...result) < 0.1, `rotation ${i}: ${result}`);
    }
});
