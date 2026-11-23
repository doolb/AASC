const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('媒体和显示设备列表横屏居左、竖屏居上且主题兼容', { timeout: 30000 }, async t => {
    const root = path.resolve('src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    $('script,link,style').remove();
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    for (const [width, height, horizontal] of [[1440, 900, true], [844, 390, true], [390, 844, false]]) {
        await page.setViewport({ width, height });
        await page.setContent($.html());
        for (const css of ['upload.css', 'chat.css', 'media-library.css', 'theme.css', 'control-workspace.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
        await page.addStyleTag({ content: '*, *::before, *::after { transition:none !important; animation:none !important; }' });
        for (const theme of ['dark', 'light', 'warm']) {
            const results = await page.evaluate(theme => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = theme === 'dark' ? 'dark' : 'light';
                return ['media', 'display'].map(name => {
                    document.querySelectorAll('.panel').forEach(panel => { panel.style.display = panel.id === `panel-${name}` ? 'block' : 'none'; });
                    const panel = document.getElementById(`panel-${name}`);
                    const device = panel.querySelector('.device-column').getBoundingClientRect();
                    const content = panel.querySelector('.device-column-content').getBoundingClientRect();
                    const list = panel.querySelector(name === 'media' ? '#mediaDeviceList' : '#deviceList');
                    return { name, device: { left: device.left, right: device.right, top: device.top, bottom: device.bottom }, content: { left: content.left, right: content.right, top: content.top }, hasList: !!list };
                });
            }, theme);
            for (const item of results) {
                assert.ok(item.hasList, `${item.name} 设备列表缺失`);
                assert.ok(item.content.right <= width + 1 && item.device.left >= -1, `${width}/${theme}/${item.name} 溢出`);
                if (horizontal) assert.ok(item.device.right <= item.content.left && Math.abs(item.device.top - item.content.top) < 2, `${width}/${theme}/${item.name} 应左右并排`);
                else assert.ok(item.device.bottom <= item.content.top + 1, `${width}/${theme}/${item.name} 应上下排列`);
            }
        }
    }
});
