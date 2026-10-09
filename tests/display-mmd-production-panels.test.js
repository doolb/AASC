'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
    .find((candidate) => candidate && fs.existsSync(candidate));

test('正式显示端面板分类、动作进度及开关与标题互不干扰', { skip: !CHROME }, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 740, deviceScaleFactor: 3 });
        await page.setContent($.html());
        await page.evaluate(() => {
            window.DisplayMmd = { getMotionProgress: () => ({ timeSeconds: 5, durationSeconds: 20 }) };
        });
        await page.addScriptTag({ path: path.join(PUBLIC, 'js/display-mmd-panel-groups.js') });
        const initial = await page.evaluate(() => ({
            lighting: document.querySelectorAll('#displayMmdLightingPanel .display-mmd-panel-group').length,
            motion: document.querySelectorAll('#displayMmdMotionPanel .display-mmd-panel-group').length,
            tracking: document.querySelectorAll('#displayArTargetPanel .display-mmd-panel-group').length,
            duplicateIds: [...document.querySelectorAll('[id]')].some((node) =>
                document.querySelectorAll(`[id="${node.id}"]`).length > 1),
            loadingProgress: !!document.getElementById('displayMmdLoadingProgress')
        }));
        assert.deepEqual(initial, { lighting: 11, motion: 3, tracking: 6, duplicateIds: false, loadingProgress: true });
        await page.click('#displayMmdMotionToggle');
        const progress = await page.evaluate(() => ({
            visible: !document.getElementById('displayMmdMotionPanel').hidden,
            value: document.getElementById('displayMmdMotionProgress').value,
            text: document.getElementById('displayMmdMotionTime').textContent
        }));
        assert.deepEqual(progress, { visible: true, value: 5, text: '00:05 / 00:20' });
        await page.click('#displayMmdLightingToggle');
        assert.equal(await page.evaluate(() => document.getElementById('displayMmdMotionPanel').hidden), true);
        const ao = await page.evaluate(() => {
            const group = document.getElementById('displayMmdPmxAoEnabled').closest('.display-mmd-panel-group');
            const button = group.querySelector('.display-mmd-panel-group-toggle');
            const checkbox = group.querySelector('#displayMmdPmxAoEnabled');
            checkbox.click();
            const afterSwitch = button.getAttribute('aria-expanded');
            button.click();
            return { afterSwitch, afterTitle: button.getAttribute('aria-expanded') };
        });
        assert.deepEqual(ao, { afterSwitch: 'false', afterTitle: 'true' });
        assert.equal(await page.evaluate(() => document.getElementById('displayArStartButton')
            .closest('.display-mmd-panel-group').querySelector('.display-mmd-panel-group-toggle').textContent), '跟踪操作');
    } finally {
        await browser.close();
    }
});
