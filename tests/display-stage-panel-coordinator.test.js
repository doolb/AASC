'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../node_modules/puppeteer');

const publicRoot = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const displayHtml = fs.readFileSync(path.join(publicRoot, 'display.html'), 'utf8');
const coordinator = fs.readFileSync(path.join(publicRoot, 'js/display-stage-panel-coordinator.js'), 'utf8');
const entries = [
    ['displayAppearanceToggle', 'displayAppearancePanel'],
    ['displayTtsVoiceToggle', 'displayTtsVoicePanel'],
    ['displayMmdLightingToggle', 'displayMmdLightingPanel'],
    ['displayMmdMotionToggle', 'displayMmdMotionPanel'],
    ['displayArTargetToggle', 'displayArTargetPanel']
];
let browser;

before(async () => {
    browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu']
    });
});

after(async () => { if (browser) await browser.close(); });

test('显示页装配右侧面板协调器，五个顶层按钮均有对应面板', () => {
    assert.match(displayHtml, /js\/display-stage-panel-coordinator\.js/u);
    for (const [buttonId, panelId] of entries) {
        assert.match(displayHtml, new RegExp(`id="${buttonId}"[^>]*aria-controls="${panelId}"`, 'u'));
        assert.match(displayHtml, new RegExp(`id="${panelId}"`, 'u'));
    }
});

test('切换五个右侧面板会运行原关闭方法并保持可见状态与 ARIA 一致', async () => {
    const page = await browser.newPage();
    try {
        const controls = entries.map(([buttonId, panelId]) =>
            `<button id="${buttonId}" aria-controls="${panelId}" aria-expanded="false">${buttonId}</button>`
            + `<section id="${panelId}" hidden><button class="inner">子选项</button></section>`).join('');
        await page.setContent(`<div class="display-stage-lighting-control">${controls}</div>`);
        await page.evaluate(() => {
            window.__closed = [];
            const close = name => () => window.__closed.push(name);
            window.DisplayAppearanceControls = { close: close('主题') };
            window.DisplayTtsVoices = { close: close('音色') };
            window.DisplayMmdLighting = { close: close('灯光') };
            window.DisplayMmdPanelGroups = { closeMotion: close('动作') };
            window.DisplayMmdAr = { closePanel: close('定位') };
            document.querySelectorAll('.display-stage-lighting-control > button').forEach(button => {
                button.addEventListener('click', () => {
                    const panel = document.getElementById(button.getAttribute('aria-controls'));
                    panel.hidden = !panel.hidden;
                    button.setAttribute('aria-expanded', String(!panel.hidden));
                });
            });
        });
        await page.addScriptTag({ content: coordinator });
        const result = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('.display-stage-lighting-control > button')];
            const state = () => buttons.map(button => {
                const panel = document.getElementById(button.getAttribute('aria-controls'));
                return [!panel.hidden, button.getAttribute('aria-expanded')];
            });
            const snapshots = [];
            for (const button of buttons) {
                button.click();
                snapshots.push(state());
                document.querySelector('.display-stage-lighting-control .inner').click();
                snapshots.push(state());
            }
            buttons.at(-1).click();
            snapshots.push(state());
            return { snapshots, closed: window.__closed };
        });
        for (let index = 0; index < 5; index++) {
            for (const snapshot of result.snapshots.slice(index * 2, index * 2 + 2)) {
                assert.deepEqual(snapshot, entries.map((_, entryIndex) => [entryIndex === index, String(entryIndex === index)]));
            }
        }
        assert.deepEqual(result.snapshots.at(-1), entries.map(() => [false, 'false']));
        assert.deepEqual(result.closed, ['主题', '音色', '灯光', '动作']);
    } finally { await page.close(); }
});
