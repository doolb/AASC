'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');

// 使用真实浏览器验证动画中与结束后的页面状态，不依赖外部游戏窗口。
test('离场动画、重复操作和跳转取消保持状态一致', { timeout: 30000 }, async t => {
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); } catch (_) { t.skip('需要 puppeteer-core'); return; }
    if (!existsSync('/usr/bin/chromium')) { t.skip('需要 Chromium'); return; }
    const port = 18888 + Math.floor(Math.random() * 1000);
    const server = spawn(process.execPath, ['scripts/serve-pig-level.js'], { env: { ...process.env, PIG_LEVEL_PORT: String(port) }, stdio: 'pipe' });
    let browser;
    try {
        await new Promise((resolve, reject) => {
            server.stdout.once('data', resolve);
            server.once('error', reject);
            server.once('exit', code => reject(new Error(`预览服务退出 ${code}`)));
        });
        browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });
        await page.goto(`http://127.0.0.1:${port}/?level=48`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.pig');
        const id = await page.$eval('.pig.hinted', element => element.dataset.pigId);
        const original = await page.$eval(`[data-pig-id="${id}"]`, element => element.getBoundingClientRect().top);
        await page.click('#next');
        await new Promise(resolve => setTimeout(resolve, 130));
        assert.equal(await page.$eval('#progressText', element => element.textContent), '0 / 176');
        assert.equal(await page.$eval('#next', element => element.disabled), true);
        const moved = await page.$eval(`[data-pig-id="${id}"]`, element => element.getBoundingClientRect().top);
        assert.ok(moved < original, '第一只猪应向上移动');
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '1 / 176');
        assert.equal(await page.$(`[data-pig-id="${id}"]`), null);
        await page.click('#next');
        await page.$eval('#slider', element => { element.value = 10; element.dispatchEvent(new Event('input', { bubbles: true })); });
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.equal(await page.$eval('#progressText', element => element.textContent), '10 / 176');
        const plan = await page.evaluate(async () => (await (await fetch('./level-48.json')).json()));
        const slide = plan.steps.findIndex(step => !step.exited);
        await page.$eval('#slider', (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, slide);
        await page.click('#next');
        assert.equal(await page.$eval('#progressText', element => element.textContent), `${slide + 1} / 176`, '棋盘内移动应立即完成');
        const scissorIds = plan.pigs.filter(pig => pig.kind === 'scissors').map(pig => pig.id);
        const scissorExit = plan.steps.findIndex(step => step.exited && scissorIds.includes(step.id));
        await page.$eval('#slider', (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, scissorExit);
        await page.click('#next');
        assert.match(await page.$eval('#ropeCount', element => element.textContent), /3 把/);
        await page.waitForFunction(value => document.querySelector('#progressText').textContent === `${value} / 176`, {}, scissorExit + 1);
        assert.match(await page.$eval('#ropeCount', element => element.textContent), /2 把/);
        const directionalSteps = await page.evaluate(async () => {
            const level = await (await fetch('./level-48.json')).json();
            return ['north', 'south', 'east', 'west'].map(direction => {
                const index = level.steps.findIndex(step => step.exited && level.pigs.find(pig => pig.id === step.id).direction === direction);
                return { direction, index };
            });
        });
        for (const { direction, index } of directionalSteps) {
            assert.ok(index >= 0);
            await page.$eval('#slider', (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, index);
            const target = await page.$eval('.pig.hinted', element => element.dataset.pigId);
            const before = await page.$eval(`[data-pig-id="${target}"]`, element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y }; });
            await page.click('#next');
            await new Promise(resolve => setTimeout(resolve, 120));
            const during = await page.$eval(`[data-pig-id="${target}"]`, element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y }; });
            const delta = { north: before.y - during.y, south: during.y - before.y, west: before.x - during.x, east: during.x - before.x };
            assert.ok(delta[direction] > 0, `${direction} 离场应沿朝向移动`);
            await page.waitForFunction(value => document.querySelector('#progressText').textContent.startsWith(`${value} /`), {}, index + 1);
        }
        await page.$eval('#slider', element => { element.value = 0; element.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.click('#next');
        await page.click('#resetButton');
        await new Promise(resolve => setTimeout(resolve, 900));
        assert.equal(await page.$eval('#progressText', element => element.textContent), '0 / 176', '重置应取消旧动画和旧状态提交');
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.$eval('#slider', element => { element.value = 0; element.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.click('#next');
        await page.waitForFunction(() => document.querySelector('#progressText').textContent === '1 / 176');
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.select('#levelSelect', '40')]);
        await page.waitForSelector('.pig');
        assert.match(page.url(), /level=40/);
        assert.equal(await page.$eval('#remaining', element => element.textContent), '剩余 90 只');
        assert.equal(await page.$eval('[aria-label^="锁猪"]', element => element.disabled), true);
        const lockStep = await page.evaluate(async () => {
            const data = await (await fetch('./level-40.json')).json();
            let exits = 0;
            return data.steps.findIndex(step => { exits += Number(step.exited); return exits === 30; }) + 1;
        });
        await page.$eval('#slider', (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, lockStep);
        assert.equal(await page.$eval('[aria-label^="锁猪"]', element => element.disabled), false);
        await page.click('#undo');
        assert.match(await page.$eval('#ropeCount', element => element.textContent), /还需 1 只/);
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.select('#levelSelect', '48')]);
        await page.waitForSelector('.pig');
        assert.match(page.url(), /level=48/);
        assert.equal(await page.$eval('#progressText', element => element.textContent), '0 / 176');
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
});
