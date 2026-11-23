'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const root = path.resolve('src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('媒体库路径在全部主题和不同屏幕下可读并保留导航', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    $('script,link,style').remove();
    const css = fs.readFileSync(path.join(root, 'css/theme.css'), 'utf8');
    const themes = [...css.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{/g)].map(match => match[1]);
    assert.equal(themes.length, 15);
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent($.html());
    for (const file of ['upload.css', 'chat.css', 'media-library.css', 'theme.css', 'control-workspace.css']) await page.addStyleTag({ path: path.join(root, 'css', file) });
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.addScriptTag({ path: path.join(root, 'js/self-test.js') });
    await page.evaluate(() => {
        document.querySelectorAll('.panel').forEach(panel => panel.style.display = panel.id === 'panel-media' ? 'block' : 'none');
        MediaLibrary.currentPath = '/照片/旅行';
        MediaLibrary.loadContent = value => { window.clickedPath = value; };
        MediaLibrary.renderBreadcrumb();
    });
    for (const width of [1440, 390]) {
        await page.setViewport({ width, height: 900 });
        for (const theme of themes) {
            await page.evaluate(theme => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = theme === 'dark' ? 'dark' : 'light';
            }, theme);
            const measure = () => page.evaluate(() => {
                const bar = document.getElementById('mediaLibraryBreadcrumb');
                const luminance = color => {
                    const values = color.match(/[\d.]+/g).map(Number);
                    if (values.length > 3 && values[3] !== 1) throw new Error('路径颜色不透明度异常');
                    const [r, g, b] = values.slice(0, 3).map(value => {
                        const c = value / 255;
                        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                    });
                    return r * 0.2126 + g * 0.7152 + b * 0.0722;
                };
                const bg = luminance(getComputedStyle(bar).backgroundColor);
                return [...bar.querySelectorAll('.breadcrumb-item, .breadcrumb-sep')].map(item => {
                    const style = getComputedStyle(item), fg = luminance(style.color);
                    return { ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), decoration: style.textDecorationLine };
                });
            });
            const selfTest = await page.evaluate(() => SelfTest.tests.find(item => item.id === 'media_breadcrumb_contrast').run());
            assert.equal(selfTest.success, true, `${width}/${theme}: ${selfTest.details}`);
            for (const item of await measure()) assert.ok(item.ratio >= 4.5, `${width}/${theme}: 对比度 ${item.ratio}`);
            await page.hover('#mediaLibraryBreadcrumb .breadcrumb-item');
            const hovered = (await measure())[0];
            assert.ok(hovered.ratio >= 4.5, `${width}/${theme}: 悬停对比度 ${hovered.ratio}`);
            assert.match(hovered.decoration, /underline/);
            await page.mouse.move(0, 0);
        }
        await page.click('#mediaLibraryBreadcrumb .breadcrumb-item:nth-of-type(3)');
        assert.equal(await page.evaluate(() => window.clickedPath), '/照片');
    }
    const failure = await page.evaluate(async () => {
        document.querySelector('#mediaLibraryBreadcrumb .breadcrumb-item').style.color = getComputedStyle(document.getElementById('mediaLibraryBreadcrumb')).backgroundColor;
        return SelfTest.tests.find(item => item.id === 'media_breadcrumb_contrast').run();
    });
    assert.equal(failure.success, false);
});
