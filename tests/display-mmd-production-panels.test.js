'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const CHROME = [process.env.AASC_MMD_TEST_BROWSER_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
    .find((candidate) => candidate && fs.existsSync(candidate));

const PANEL_SELECTOR = '#displayMmdLightingPanel, #displayMmdMotionPanel, #displayArTargetPanel';
const STORAGE_KEY = 'aasc.display.mmdPanelOpacity.v1';

async function loadStyledPanels(page, storedValue = null, storageBlocked = false) {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8'));
    // 按正式页的加载顺序内嵌全部CSS；不运行服务器或加载模型/语音等无关脚本。
    $('link[rel="stylesheet"]').each((index, link) => {
        const href = $(link).attr('href');
        $(link).replaceWith(`<style>${fs.readFileSync(path.join(PUBLIC, href), 'utf8')}</style>`);
    });
    $('script').remove();
    await page.setContent($.html());
    await page.evaluate(({ storedValue, storageBlocked, storageKey }) => {
        const storage = new Map(storedValue === null ? [] : [[storageKey, storedValue]]);
        Object.defineProperty(window, 'localStorage', { configurable: true, value: {
            getItem(key) {
                if (storageBlocked) throw new Error('测试存储不可用');
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                if (storageBlocked) throw new Error('测试存储不可用');
                storage.set(key, String(value));
            }
        } });
        document.querySelector('.display-stage-lighting-control').hidden = false;
        window.DisplayMmd = { getMotionProgress: () => ({ timeSeconds: 5, durationSeconds: 20 }) };
    }, { storedValue, storageBlocked, storageKey: STORAGE_KEY });
    for (const file of ['display-mmd-panel-groups.js', 'display-mmd-production-controls.js']) {
        await page.addScriptTag({ path: path.join(PUBLIC, 'js', file) });
    }
}

test('正式显示端面板分类、动作进度及开关与标题互不干扰', { skip: !CHROME }, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 740, deviceScaleFactor: 3 });
        await page.setContent($.html());
        await page.evaluate(() => {
            // 此夹具只加载分类模块，模拟正式舞台初始化后已显示角色的入口状态。
            document.querySelector('.display-stage-lighting-control').hidden = false;
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
        assert.deepEqual(initial, { lighting: 12, motion: 9, tracking: 6, duplicateIds: false, loadingProgress: true });
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

for (const [theme, mode] of [['dark', 'dark'], ['light', 'light'], ['warm', 'light']]) {
    test(`正式面板完整CSS：${theme}主题分类及子分类背景随不透明度变化`, { skip: !CHROME }, async () => {
        const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 390, height: 740 });
            await loadStyledPanels(page);
            await page.evaluate(({ theme, mode }) => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = mode;
            }, { theme, mode });
            let stableControlStyles = null;
            for (const value of [0, 50, 100]) {
                const state = await page.evaluate(({ value, panelSelector }) => {
                    const panels = [...document.querySelectorAll(panelSelector)];
                    const canvas = document.getElementById('displayMmdCanvas');
                    const beforeSize = [canvas.width, canvas.height];
                    const input = panels[0].querySelector('[data-display-mmd-panel-opacity]');
                    input.value = String(value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    const describe = node => {
                        const style = getComputedStyle(node);
                        const color = style.backgroundColor;
                        // Chromium对color-mix返回color(srgb ... / alpha)，普通色可能返回rgba。
                        const alpha = color.includes('/') ? Number(color.split('/')[1].replace(')', '').trim())
                            : color.startsWith('rgba(') ? Number(color.slice(5, -1).split(',')[3]) : 1;
                        let current = node;
                        const opacities = [];
                        while (current) { opacities.push(getComputedStyle(current).opacity); current = current.parentElement; }
                        return { label: node.textContent.trim().slice(0, 40), alpha, image: style.backgroundImage,
                            color: style.color, disabled: node.matches(':disabled'), opacities };
                    };
                    const collect = selector => panels.flatMap(panel => [...panel.querySelectorAll(selector)].map(describe));
                    const probe = document.createElement('span');
                    probe.style.color = 'var(--text-primary)';
                    panels[0].append(probe);
                    const textColor = getComputedStyle(probe).color;
                    probe.remove();
                    return {
                        backgrounds: [...panels.map(describe), ...collect('.display-mmd-panel-group, .mmd-ar-panel-group')],
                        headers: collect('.display-mmd-panel-group-header, .mmd-ar-panel-group-header'),
                        summaries: collect('details > summary'),
                        toggles: collect('.display-mmd-panel-group-toggle, .mmd-ar-panel-group-toggle'),
                        controls: collect('input, select, textarea, output'),
                        values: panels.map(panel => panel.querySelector('[data-display-mmd-panel-opacity]').value),
                        outputs: panels.map(panel => panel.querySelector('.display-mmd-panel-opacity-control output').textContent),
                        cssValue: getComputedStyle(document.getElementById('displayStageLayers'))
                            .getPropertyValue('--display-mmd-panel-opacity').trim(),
                        textColor, ordinary: describe(document.getElementById('displayMmdLightingReset')),
                        stableControls: [document.getElementById('displayMmdLightingReset'),
                            document.getElementById('mmdArLocalDirectoryButton'),
                            document.querySelector('#mmdArLightingPresets [data-preset-action="overwrite"]'),
                            document.getElementById('displayArDeleteButton'),
                            document.querySelector('#displayMmdLipSyncPanel [data-lipsync-play]'),
                            document.getElementById('displayMmdShadowSource'),
                            document.getElementById('displayMmdAmbientColor')].map(describe),
                        canvasStable: canvas === document.getElementById('displayMmdCanvas')
                            && beforeSize[0] === canvas.width && beforeSize[1] === canvas.height
                    };
                }, { value, panelSelector: PANEL_SELECTOR });
                assert.equal(state.headers.length, 28, '包括动态分类、SSGI和旧式本地资源子标题');
                assert.equal(state.summaries.length, 8, '覆盖AI回复、Human及口型原生子分类');
                for (const surface of [...state.backgrounds, ...state.headers, ...state.summaries]) {
                    assert.ok(Math.abs(surface.alpha - value / 100) < 1e-6, `${value}% ${surface.label}背景alpha=${surface.alpha}`);
                    assert.equal(surface.image, 'none', '背景只使用可调颜色，不残留不透明渐变');
                }
                for (const toggle of state.toggles) {
                    assert.equal(toggle.alpha, 0, `${toggle.label}按钮背景透明，由标题行提供底色`);
                    assert.equal(toggle.image, 'none');
                    assert.equal(toggle.color, state.textColor, '透明标题使用主题文字色而非浅色按钮固定白色');
                }
                for (const node of [...state.headers, ...state.summaries, ...state.toggles, ...state.controls]) {
                    assert.ok(node.opacities.slice(node.disabled ? 1 : 0).every(opacity => opacity === '1'),
                        `${node.label}及祖先不因面板透明度使用整体opacity`);
                }
                assert.deepEqual(state.values, Array(3).fill(String(value)));
                assert.deepEqual(state.outputs, Array(3).fill(`${value}%`));
                assert.equal(state.cssValue, `${value}%`);
                const controlStyles = state.stableControls.map(({ alpha, image, color, disabled, opacities }) => ({
                    alpha, image, color, disabled, opacity: opacities[0]
                }));
                if (stableControlStyles === null) stableControlStyles = controlStyles;
                else assert.deepEqual(controlStyles, stableControlStyles, '调节面板背景不改变普通/禁用按钮及输入自身样式');
                const disabledAction = state.stableControls[4];
                assert.equal(disabledAction.disabled, true);
                assert.equal(disabledAction.opacities[0], '0.45', '口型禁用按钮保留既有弱化');
                assert.equal(state.canvasStable, true);
                if (mode === 'light') {
                    assert.match(state.ordinary.image, /linear-gradient/, '普通按钮保留原浅色渐变');
                    assert.match(state.stableControls[1].image, /linear-gradient/, '普通动作按钮不被透明标题规则覆盖');
                }
            }
        } finally { await browser.close(); }
    });
}

test('正式面板共用不透明度change保存、刷新恢复及存储异常默认值', { skip: !CHROME }, async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await loadStyledPanels(page);
        const saved = await page.evaluate(({ key, panelSelector }) => {
            const panels = [...document.querySelectorAll(panelSelector)];
            const input = panels[2].querySelector('[data-display-mmd-panel-opacity]');
            input.value = '37';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const beforeChange = localStorage.getItem(key);
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { beforeChange, saved: localStorage.getItem(key),
                values: panels.map(panel => panel.querySelector('[data-display-mmd-panel-opacity]').value) };
        }, { key: STORAGE_KEY, panelSelector: PANEL_SELECTOR });
        assert.deepEqual(saved, { beforeChange: null, saved: '37', values: ['37', '37', '37'] });
        for (const [storedValue, blocked, expected] of [[saved.saved, false, '37'], ['非法', false, '50'], [null, true, '50']]) {
            await loadStyledPanels(page, storedValue, blocked);
            assert.equal(await page.evaluate(() => document.querySelector('[data-display-mmd-panel-opacity]').value), expected);
        }
        await page.evaluate(() => {
            const input = document.querySelector('[data-display-mmd-panel-opacity]');
            input.value = '25'; input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await page.evaluate(() => document.querySelector('.display-mmd-panel-opacity-control output').textContent), '25%');
    } finally { await browser.close(); }
});

test('正式子分类开合及窄屏滚动保持，summary支持键盘操作', { skip: !CHROME }, async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await loadStyledPanels(page);
        await page.evaluate(() => {
            document.documentElement.dataset.theme = 'light';
            document.documentElement.dataset.themeMode = 'light';
            document.getElementById('displayMmdLightingPanel').hidden = false;
        });
        const ssgi = await page.evaluate(() => {
            document.querySelector('[aria-controls="mmdArIndirectLightingBody"]').click();
            const title = document.querySelector('[aria-controls="mmdArSsgiBody"]');
            const checkbox = document.querySelector('[data-screen-lighting="giEnabled"]');
            const checked = checkbox.checked;
            title.click();
            return { parentOpen: !document.getElementById('mmdArIndirectLightingBody').hidden,
                open: !document.getElementById('mmdArSsgiBody').hidden, checked, afterTitle: checkbox.checked };
        });
        assert.equal(ssgi.parentOpen, true); assert.equal(ssgi.open, true); assert.equal(ssgi.afterTitle, ssgi.checked);
        await page.click('#displayMmdMotionToggle');
        const local = await page.evaluate(() => {
            document.getElementById('mmdArLocalAssets').closest('.display-mmd-panel-group')
                .querySelector('.display-mmd-panel-group-toggle').click();
            document.querySelector('[aria-controls="mmdArLocalAssetsBody"]').click();
            document.getElementById('displayMmdLipSyncPanel').closest('.display-mmd-panel-group')
                .querySelector('.display-mmd-panel-group-toggle').click();
            return !document.getElementById('mmdArLocalAssetsBody').hidden;
        });
        assert.equal(local, true);
        const summary = '#displayMmdLipSyncPanel summary';
        await page.focus(summary);
        await page.keyboard.press('Enter');
        assert.equal(await page.$eval(summary, node => node.parentElement.open), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.$eval(summary, node => node.parentElement.open), false);
        for (const viewport of [{ width: 390, height: 740 }, { width: 844, height: 390 }]) {
            await page.setViewport(viewport);
            const layout = await page.evaluate(() => {
                const panel = document.getElementById('displayMmdMotionPanel');
                const rect = panel.getBoundingClientRect();
                panel.scrollTop = panel.scrollHeight;
                return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                    scrollable: getComputedStyle(panel).overflowY === 'auto', scrollTop: panel.scrollTop };
            });
            assert.ok(layout.left >= 0 && layout.right <= viewport.width && layout.top >= 0 && layout.bottom <= viewport.height);
            assert.equal(layout.scrollable, true); assert.ok(layout.scrollTop > 0);
        }
    } finally { await browser.close(); }
});
