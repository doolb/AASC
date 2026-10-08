'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('真实双视口拖拽、右相机跟随、旋转及关闭数据流不直连真值', { timeout: 90000 }, async t => {
    const { createLabServer } = await import('../3rd/imu-six-axis-test/server.mjs');
    const service = await createLabServer({ port: 0, host: '127.0.0.1' }); t.after(() => service.close());
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    t.after(() => browser.close()); const page = await browser.newPage(); await page.setViewport({ width: 1480, height: 1060 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${service.port}/`); await page.waitForFunction(() => window.imuLab?.snapshot().engine.samples > 20);
    assert.equal(await page.$$eval('.viewport canvas', canvases => canvases.length), 2);
    const boxes = await page.$$eval('.viewport', elements => elements.map(element => { const box = element.getBoundingClientRect(); return { x: box.x, right: box.right }; }));
    assert.ok(boxes[1].x > boxes[0].right);
    await page.click('#cleanInput');
    assert.equal(await page.$eval('#filterHz', element => element.value), '12');
    assert.equal(await page.$eval('#accelZone', element => element.value), '0.08');
    assert.equal(await page.$eval('#gyroBias', element => element.value), '0');
    await page.click('#ideal');
    const before = await page.evaluate(() => window.imuLab.snapshot());
    // 在可见X箭头上搜索命中位置，随后执行真实pointer拖动。
    let found = null;
    for (const distance of [0.45, 0.55, 0.65, 0.75, 0.85]) {
        const point = await page.evaluate(distance => window.imuLab.projectHandle('X', distance), distance);
        await page.mouse.move(point.x, point.y); await page.mouse.down();
        const dragging = await page.evaluate(() => window.imuLab.snapshot().dragging);
        if (dragging) { found = point; break; } await page.mouse.up();
    }
    assert.ok(found, '真实鼠标应命中移动手柄');
    await page.mouse.move(found.x + 110, found.y, { steps: 18 }); await page.mouse.up(); await delay(1800);
    const moved = await page.evaluate(() => window.imuLab.snapshot());
    assert.ok(Math.hypot(...moved.truth.position) > 0.2, '右侧虚拟设备应被拖动');
    moved.rightCameraOffset.forEach((value, axis) => assert.ok(Math.abs(value - before.rightCameraOffset[axis]) < 0.02, '右相机应保持距离方向'));
    moved.rightTarget.forEach((value, axis) => assert.ok(Math.abs(value - moved.rightDevice[axis]) < 1e-6));
    assert.ok(moved.engine.position.every(Number.isFinite));
    assert.ok(Math.hypot(...moved.engine.position.map((value, axis) => value - moved.truth.position[axis])) < 0.02);
    await page.click('#rotate'); assert.equal(await page.evaluate(() => window.imuLab.snapshot().transformMode), 'rotate');
    // 实际拖动旋转圆环，覆盖旋转模式的命中与事件隔离。
    const center = await page.evaluate(() => window.imuLab.projectHandle('X', 0));
    let ring = null;
    for (const radius of [70, 90, 110, 130, 150]) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
            const point = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
            await page.mouse.move(point.x, point.y); await page.mouse.down();
            if (await page.evaluate(() => window.imuLab.snapshot().dragging)) { ring = { ...point, angle, radius }; break; }
            await page.mouse.up();
        }
        if (ring) break;
    }
    assert.ok(ring, '真实鼠标应命中旋转圆环');
    const rotationBefore = await page.evaluate(() => window.imuLab.snapshot().truth.quaternion);
    await page.mouse.move(center.x + Math.cos(ring.angle + 0.65) * ring.radius,
        center.y + Math.sin(ring.angle + 0.65) * ring.radius, { steps: 16 });
    await page.mouse.up(); await delay(1200);
    const rotationAfter = await page.evaluate(() => window.imuLab.snapshot().truth.quaternion);
    assert.ok(rotationAfter.some((value, axis) => Math.abs(value - rotationBefore[axis]) > 0.01));
    await page.click('[data-trajectory="rotate"]'); await delay(900);
    const rotated = await page.evaluate(() => window.imuLab.snapshot());
    assert.ok(rotated.engine.rawGyro.some(value => Math.abs(value) > 0.01));
    await page.click('#stream'); const stopped = await page.evaluate(() => window.imuLab.snapshot());
    await page.click('[data-trajectory="translate"]'); await delay(1000);
    const paused = await page.evaluate(() => window.imuLab.snapshot());
    assert.deepEqual(paused.engine.position, stopped.engine.position);
    assert.deepEqual(paused.engine.quaternion, stopped.engine.quaternion);
    assert.notDeepEqual(paused.truth.position, stopped.truth.position);
    await page.screenshot({ path: '/tmp/imu-six-axis-test-desktop.png', fullPage: true });
    const second = await browser.newPage(); await second.setViewport({ width: 390, height: 844 });
    await second.goto(`http://127.0.0.1:${service.port}/?room=${moved.room}&role=phone`);
    await second.waitForFunction(() => window.imuLab?.snapshot().devices.length >= 2);
    assert.equal(await second.$eval('.simulator', element => getComputedStyle(element).display), 'none');
    // 注入浏览器事件仍经过手机适配和同一个估计器，不直接操作位姿。
    await second.bringToFront(); await second.click('#phoneStart');
    await second.evaluate(async () => {
        // 浏览器会量化接收时间，真实采样间隔不能用同一任务中的瞬时事件替代。
        for (let i = 0; i < 10; i += 1) {
            await new Promise(resolve => setTimeout(resolve, 20));
            window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
                rotationRate: { alpha: 0, beta: 0, gamma: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 } }));
        }
    });
    assert.ok(await second.evaluate(() => window.imuLab.snapshot().engine.samples >= 5), await second.$eval('#phoneStatus', element => element.textContent));
    // 观察端在后台时rAF可能暂停，网络接收断言使用定时轮询，避免等待绘制帧。
    await page.waitForFunction(() => window.imuLab.snapshot().devices.some(device => device.label === '手机六轴' && device.frame?.samples >= 5), { polling: 100 });
    await second.click('#phoneStop');
    assert.equal(await second.evaluate(() => window.imuLab.snapshot().engine.status), 'paused');
    assert.deepEqual(errors, []);
});
