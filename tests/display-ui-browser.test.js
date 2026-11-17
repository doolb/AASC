'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const root = path.resolve('src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('显示端面板横竖屏、主题、透明度和隐藏状态', { skip: !fs.existsSync(chrome), timeout: 45000 }, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    $('script,link,style').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    for (const [width, height, horizontal] of [[1440, 900, true], [844, 390, true], [390, 844, false], [320, 568, false]]) {
        await page.setViewport({ width, height });
        await page.setContent($.html());
        for (const css of ['theme.css', 'display.css', 'display-chat.css', 'display-game.css', 'display-quick-control.css', 'display-mmd.css', 'display-media-library.css', 'display-wallpaper-controls.css', 'display-ui.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
        for (const theme of ['dark', 'light', 'warm']) {
            const value = await page.evaluate(theme => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = theme === 'dark' ? 'dark' : 'light';
                const quick = document.getElementById('displayQuickControlPanel');
                const library = document.getElementById('displayMediaLibraryPanel');
                const hiddenQuick = getComputedStyle(quick).display;
                const hiddenLibrary = getComputedStyle(library).display;
                quick.hidden = false;
                library.hidden = false;
                const sources = document.getElementById('displayMediaLibrarySources');
                sources.innerHTML = '<span class="display-media-library-group-title">媒体来源</span>' + Array.from({length: 8}, (_, i) => `<button class="display-media-library-source${i === 0 ? ' active' : ''}">来源${i}</button>`).join('');
                const main = library.querySelector('.display-media-library-main');
                const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
                const sections = [...quick.querySelectorAll(':scope > section')];
                library.style.setProperty('--display-media-background-alpha', '0');
                const result = { hiddenQuick, hiddenLibrary, quick: rect(quick), first: rect(sections[0]), second: rect(sections[1]), sources: rect(sources), main: rect(main), body: rect(library.querySelector('.display-media-library-body')), background: getComputedStyle(library).backgroundColor, selected: getComputedStyle(sources.querySelector('button')).color, sourceScroll: sources.scrollWidth, sourceWidth: sources.clientWidth };
                quick.hidden = true; library.hidden = true;
                return result;
            }, theme);
            assert.equal(value.hiddenQuick, 'none');
            assert.equal(value.hiddenLibrary, 'none');
            assert.equal(value.background, 'rgba(8, 10, 16, 0)');
            assert.equal(value.selected, 'rgb(255, 255, 255)');
            assert.ok(value.quick.left >= 0 && value.quick.right <= width && value.quick.bottom <= height, `${width}/${theme} 快捷面板溢出`);
            if (horizontal) {
                assert.ok(value.first.right <= value.second.left && Math.abs(value.first.top - value.second.top) < 2, `${width}/${theme} 快捷控制应并排`);
                assert.ok(value.sources.right <= value.main.left && value.sources.top === value.main.top, `${width}/${theme} 来源应在左侧`);
            } else {
                assert.ok(value.first.bottom <= value.second.top, `${width}/${theme} 快捷控制应单列`);
                assert.ok(value.sources.bottom <= value.main.top + 1 && value.main.width >= width - 2, `${width}/${theme} 来源应在顶部`);
                assert.ok(value.sourceScroll > value.sourceWidth, `${width}/${theme} 来源应可横向滚动`);
            }
        }
    }
});
