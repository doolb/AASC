const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('紧凑媒体卡片、触屏操作与显示设置在横竖屏可用', { timeout: 30000 }, async t => {
    const root = path.resolve('src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    $('script,link,style').remove();
    $('#mediaLibraryContent').html('<div class="media-library-item"><div class="media-thumb-wrapper"><img class="media-thumb" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="封面"></div><div class="item-name">图片名称</div><div class="item-meta">image</div><div class="item-actions"><button>播放</button><button>背景播放</button></div></div><div class="media-library-item folder"><div class="folder-icon">📁</div><div class="item-name">文件夹</div></div>');
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    for (const [width, height, hasTouch] of [[1440, 900, false], [390, 844, true]]) {
        await page.setViewport({ width, height, hasTouch, isMobile: hasTouch });
        await page.setContent($.html());
        for (const css of ['upload.css', 'chat.css', 'media-library.css', 'theme.css', 'control-workspace.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
        await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
        for (const theme of ['dark', 'light', 'warm']) {
            const result = await page.evaluate(({ theme }) => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = theme === 'dark' ? 'dark' : 'light';
                const card = document.querySelector('#mediaLibraryContent .media-library-item:not(.folder)');
                const image = card.querySelector('.media-thumb');
                const tabs = document.querySelector('.media-library-tabs');
                const box = card.getBoundingClientRect(), imageBox = image.getBoundingClientRect();
                const wrap = card.querySelector('.media-thumb-wrapper'); const w = wrap.getBoundingClientRect();
                return { card: { width: box.width, height: box.height }, wrapper: { width: w.width, height: w.height }, image: { width: imageBox.width, height: imageBox.height }, objectFit: getComputedStyle(image).objectFit, tabOverflow: getComputedStyle(tabs).overflowX, buttonOpacity: getComputedStyle(card.querySelector('.item-actions')).opacity };
            }, { theme });
            assert.ok(Math.abs(result.card.width - result.image.width) < 4, `${width}/${theme} 封面宽度应铺满卡片 ${JSON.stringify(result)}`);
            assert.ok(Math.abs(result.card.height - result.image.height) < 4, `${width}/${theme} 封面高度应铺满卡片`);
            assert.equal(result.objectFit, 'cover');
            assert.equal(result.tabOverflow, 'auto');
            if (hasTouch) assert.equal(result.buttonOpacity, '1');
        }
        await page.focus('#mediaLibraryContent .item-actions button');
        assert.equal(await page.$eval('#mediaLibraryContent .item-actions', element => getComputedStyle(element).opacity), '1');
        await page.evaluate(() => {
            document.querySelector('#panel-media').style.display = 'none';
            document.querySelector('#panel-display').style.display = 'block';
            window.__cropCalls = 0;
            window.Crop = { recalculateSize(value) { if (value === false) window.__cropCalls++; } };
            const crop = [...document.querySelectorAll('#panel-display details')].find(element => element.textContent.includes('画面预览与裁剪'));
            crop.open = true;
        });
        if (!hasTouch) {
            const bottom = await page.$eval('#panel-display .control-grid', element => element.getBoundingClientRect().bottom);
            assert.ok(bottom <= height, `桌面常用控制应显示在首屏：${bottom}`);
        }
        await page.waitForFunction(() => window.__cropCalls > 0, { timeout: 5000 });
        const details = await page.evaluate(() => ({ open: document.querySelector('.display-advanced:has(.crop-control)').open, visible: document.getElementById('cropPreviewContainer').getBoundingClientRect().width > 0, calls: window.__cropCalls }));
        assert.deepEqual(details, { open: true, visible: true, calls: 1 });
    }
});
