const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('其他控制面板横屏分栏、竖屏恢复单列并兼容主题', { timeout: 30000 }, async t => {
    const root = path.resolve('src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    $('script,link,style').remove();
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    for (const [width, height, horizontal] of [[1440, 900, true], [844, 390, true], [390, 844, false], [680, 390, false]]) {
        await page.setViewport({ width, height });
        await page.setContent($.html());
        for (const css of ['upload.css', 'chat.css', 'media-library.css', 'theme.css', 'control-workspace.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
        for (const theme of ['dark', 'light', 'warm']) {
            const results = await page.evaluate(theme => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = theme === 'dark' ? 'dark' : 'light';
                const cases = [
                    ['servers', '.server-list-section', '.shared-media-section'],
                    ['search', '.responsive-panel-grid > :nth-child(2)', '.responsive-panel-grid > :nth-child(3)'],
                    ['logs', '.responsive-panel-grid > :nth-child(1)', '.responsive-panel-grid > :nth-child(2)'],
                    ['settings', '.responsive-panel-grid > :nth-child(1)', '.responsive-panel-grid > :nth-child(2)'],
                    ['voiceprint', '.voiceprint-card:nth-child(1)', '.voiceprint-card:nth-child(2)'],
                    ['reminder', '.reminder-form', '.reminder-list']
                ];
                return cases.map(([name, first, second]) => {
                    document.querySelectorAll('.panel').forEach(panel => { panel.style.display = panel.id === `panel-${name}` ? 'block' : 'none'; });
                    const panel = document.getElementById(`panel-${name}`);
                    const a = panel.querySelector(first).getBoundingClientRect();
                    const b = panel.querySelector(second).getBoundingClientRect();
                    const full = panel.querySelector(name === 'search' ? '.responsive-panel-grid > :first-child' : name === 'logs' ? '.log-section' : '.missing');
                    const f = full && full.getBoundingClientRect();
                    return { name, a: { left: a.left, right: a.right, top: a.top, bottom: a.bottom }, b: { left: b.left, right: b.right, top: b.top }, full: f && { left: f.left, right: f.right } };
                });
            }, theme);
            for (const { name, a, b, full } of results) {
                assert.ok(a.left >= -1 && b.right <= width + 1, `${width}/${theme}/${name} 超出视口`);
                if (horizontal) {
                    assert.ok(a.right <= b.left && Math.abs(a.top - b.top) < 2, `${width}/${theme}/${name} 应左右并排`);
                    if (full) assert.ok(full.left <= a.left + 1 && full.right >= b.right - 1, `${width}/${theme}/${name} 主要区域应占整行`);
                } else assert.ok(a.bottom <= b.top + 1, `${width}/${theme}/${name} 应上下排列`);
            }
        }
    }
});
