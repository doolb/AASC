'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/apps/web-mediacenter/ui/public/js/display-wallpaper-motion.js');
const g = 9.80665;
const event = (x, y, z, rotationRate) => ({ accelerationIncludingGravity: { x, y, z }, rotationRate });

test('加速度基线：静止、四向平移、缺失数据和长间隔', () => {
    for (const [axis, amount] of [[0, 2], [0, -2], [1, 2], [1, -2]]) {
        const sensor = globalThis.createWallpaperMotionEstimator();
        assert.deepEqual(sensor.sample(event(0, 0, g), 0), [0, 0, 0]);
        assert.deepEqual(sensor.sample(event(0, 0, g), 10), [0, 0, 0]);
        const force = [0, 0, g]; force[axis] += amount;
        const result = sensor.sample(event(...force), 20);
        assert.ok(result[axis] * Math.sign(amount) > 1.9);
        assert.equal(sensor.sample({ acceleration: { x: 1, y: 0, z: 0 } }, 30), null);
        assert.deepEqual(sensor.sample(event(0, 0, g), 500), [0, 0, 0]);
    }
});

test('角速度变化或缺失不会改变镜头平移，持续倾斜的重力基线会收敛', () => {
    const a = globalThis.createWallpaperMotionEstimator();
    const b = globalThis.createWallpaperMotionEstimator();
    a.sample(event(0, 0, g), 0); b.sample(event(0, 0, g), 0);
    let result;
    for (let i = 1; i <= 500; i++) {
        const angle = Math.PI / 6;
        const force = [0, g * Math.sin(angle), g * Math.cos(angle)];
        result = a.sample(event(...force, { alpha: 100, beta: -900, gamma: 30 }), i * 10);
        assert.deepEqual(result, b.sample(event(...force), i * 10));
    }
    assert.ok(Math.hypot(...result) < 0.02);
});
