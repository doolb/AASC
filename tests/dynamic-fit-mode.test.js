'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');
const { DynamicFitController } = require('../src/apps/web-mediacenter/ui/public/js/dynamic-fit-controller.js');

function createManualScheduler() {
    const jobs = [];
    return {
        jobs,
        schedule(callback, delay) {
            const job = { callback, delay, cancelled: false };
            jobs.push(job);
            return job;
        },
        cancel(job) {
            if (job) job.cancelled = true;
        },
        runNext() {
            const job = jobs.shift();
            assert.ok(job, '应该存在待执行的动态填充阶段');
            if (!job.cancelled) job.callback();
        }
    };
}

test('动态填充按适应停留、过渡铺满、铺满停留、过渡适应循环，默认使用3秒/2秒', () => {
    const scheduler = createManualScheduler();
    const phases = [];
    const controller = new DynamicFitController({
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
        onPhase: phase => phases.push(phase)
    });

    controller.start();
    assert.deepStrictEqual(phases, [{ mode: 'contain', transitionMs: 0 }]);
    assert.strictEqual(scheduler.jobs[0].delay, 2000);

    scheduler.runNext();
    assert.deepStrictEqual(phases[1], { mode: 'cover', transitionMs: 3000 });
    assert.strictEqual(scheduler.jobs[0].delay, 3000);

    scheduler.runNext();
    assert.deepStrictEqual(phases[2], { mode: 'cover', transitionMs: 0 });
    assert.strictEqual(scheduler.jobs[0].delay, 2000);

    scheduler.runNext();
    assert.deepStrictEqual(phases[3], { mode: 'contain', transitionMs: 3000 });
    assert.strictEqual(scheduler.jobs[0].delay, 3000);

    scheduler.runNext();
    assert.deepStrictEqual(phases[4], { mode: 'contain', transitionMs: 0 });
    assert.strictEqual(scheduler.jobs[0].delay, 2000);
});

test('动态填充停止后取消定时器，重新启动不会叠加旧循环', () => {
    const scheduler = createManualScheduler();
    const phases = [];
    const controller = new DynamicFitController({
        transitionMs: 1000,
        holdMs: 500,
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
        onPhase: phase => phases.push(phase)
    });

    controller.start();
    const firstJob = scheduler.jobs[0];
    controller.stop();
    assert.strictEqual(firstJob.cancelled, true);

    controller.start();
    assert.strictEqual(phases.length, 2);
    assert.strictEqual(scheduler.jobs.length, 2, '取消的任务保留在测试队列中，但不得再产生阶段');
    scheduler.runNext();
    assert.strictEqual(phases.length, 2);
    scheduler.runNext();
    assert.strictEqual(phases.length, 3);
});

test('动态填充进入过渡后画面尺寸应处于适应和铺满之间', async () => {
    const app = express();
    app.use(express.static('src/apps/web-mediacenter/ui/public'));
    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });
    const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    let displaySocket = null;

    wss.on('connection', socket => {
        displaySocket = socket;
        socket.send(JSON.stringify({
            type: 'restoreState',
            state: {
                fit: 'contain',
                currentMedia: {
                    type: 'base64',
                    data: imageData,
                    mimeType: 'image/png',
                    mediaType: 'image',
                    fileName: 'dynamic-fit-test.png'
                }
            }
        }));
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/display.html?displayId=dynamic-fit-test`, { waitUntil: 'load' });
        await page.waitForFunction(() => {
            const image = document.getElementById('mediaImage');
            return image && image.style.display === 'block' && image.naturalWidth > 0;
        }, { timeout: 10000 });

        const containSize = await page.evaluate(() => document.getElementById('mediaImage').getBoundingClientRect().width);
        assert.ok(displaySocket, '显示端 WebSocket 应已连接');
        displaySocket.send(JSON.stringify({ type: 'control', action: 'dynamicFitConfig', value: { transitionSeconds: 3, holdSeconds: 2 } }));
        displaySocket.send(JSON.stringify({ type: 'control', action: 'fit', value: 'dynamic' }));

        await new Promise(resolve => setTimeout(resolve, 2500));
        const transitionSize = await page.evaluate(() => {
            const image = document.getElementById('mediaImage');
            return {
                width: image.getBoundingClientRect().width,
                transition: getComputedStyle(image).transition
            };
        });

        assert.ok(transitionSize.width > containSize + 1, `过渡中尺寸应大于适应尺寸，实际 ${transitionSize.width}`);
        assert.ok(transitionSize.width < 799, `过渡中尺寸不应直接跳到铺满尺寸，实际 ${transitionSize.width}`);
        assert.match(transitionSize.transition, /width 3s/);
    } finally {
        await browser.close();
        wss.close();
        await new Promise(resolve => server.close(resolve));
    }
});
