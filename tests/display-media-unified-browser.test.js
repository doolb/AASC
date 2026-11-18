'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const root = path.resolve('src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('显示端汇总来源、按比例显示封面并按原来源播放', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'display.html'), 'utf8'));
    $('script,link,style').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width:390, height:844, hasTouch:true });
    await page.setContent($.html());
    for (const css of ['theme.css', 'display.css', 'display-mmd.css', 'display-media-library.css', 'display-ui.css']) await page.addStyleTag({ path:path.join(root, 'css', css) });
    await page.addStyleTag({ content:'*, *::before, *::after { transition:none !important; animation:none !important; }' });
    await page.evaluate(async () => {
        const svg = (width, height, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`);
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const stream = canvas.captureStream(10); const recorder = new MediaRecorder(stream, { mimeType:'video/webm' });
        const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
        const recorded = new Promise(resolve => { recorder.onstop = resolve; });
        recorder.start(); canvas.getContext('2d').fillRect(0, 0, 320, 180);
        await new Promise(resolve => setTimeout(resolve, 250)); recorder.stop(); await recorded; stream.getTracks().forEach(track => track.stop());
        const videoUrl = URL.createObjectURL(new Blob(chunks, { type:'video/webm' }));
        const libraries = [{ id:'a', name:'本地一', type:'local' }, { id:'b', name:'本地二', type:'local' }, { id:'bad', name:'失效源', type:'task' }];
        const datasets = {
            a:[{ name:'相同文件夹', path:'/same', type:'directory' }, { name:'竖图', path:'/tall.png', type:'file', mediaType:'image', directUrl:svg(400, 800, 'red') }],
            b:[{ name:'相同文件夹', path:'/same', type:'directory' }, { name:'横图', path:'/wide.png', type:'file', mediaType:'image', directUrl:svg(900, 600, 'blue') }, { name:'横视频', path:'/video.webm', type:'file', mediaType:'video', directUrl:videoUrl }]
        };
        window.fetch = async url => {
            const parsed = new URL(url, 'https://localhost');
            if (parsed.pathname.endsWith('/libraries')) return { ok:true, json:async () => ({ libraries }) };
            const id = parsed.searchParams.get('libraryId'), dir = parsed.searchParams.get('path');
            if (id === 'bad') {
                await new Promise(resolve => setTimeout(resolve, 800));
                return { ok:false, status:410, json:async () => ({ error:'已停止' }) };
            }
            await new Promise(resolve => setTimeout(resolve, id === 'a' ? 20 : 50));
            return { ok:true, json:async () => ({ path:dir, parent:'/', entries:dir === '/' ? datasets[id] : [{ name:`${id}子文件`, path:`${dir}/1.png`, type:'file', mediaType:'image', directUrl:svg(400, 400, 'green') }] }) };
        };
        window.sent = [];
    });
    await page.addScriptTag({ path:path.join(root, 'js/display-media-library.js') });
    await page.evaluate(() => DisplayMediaLibrary.init({ hostname:'localhost', send: message => { sent.push(message); return true; } }));
    await page.click('#displayMediaLibraryToggle');
    await page.waitForFunction(() => document.querySelectorAll('.display-media-library-entry').length === 5 && document.querySelector('[data-library-id="a"] img')?.naturalWidth && document.querySelector('video.display-media-card-cover')?.videoWidth);
    assert.equal(await page.$('#displayMediaLibrarySources'), null);
    assert.equal(await page.$eval('#displayMediaLibraryStatus', node => node.textContent), '加载中…', '慢来源等待时其他来源应已可见');
    await page.waitForFunction(() => document.getElementById('displayMediaLibraryStatus').textContent.includes('部分媒体来源加载失败'));
    assert.match(await page.$eval('#displayMediaLibraryStatus', node => node.textContent), /部分媒体来源加载失败/);
    assert.equal(await page.$eval('.display-media-library-entry.is-directory', card => {
        const box = card.getBoundingClientRect(), button = card.querySelector('.display-media-library-batch').getBoundingClientRect();
        return button.height > 20 && button.top >= box.top && button.bottom <= box.bottom + 1;
    }), true, '文件夹批量播放按钮应完整显示在卡片内');
    const layout = await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry.has-cover')].map(card => {
        const cover = card.querySelector('img, video'); const c = card.getBoundingClientRect(), i = cover.getBoundingClientRect();
        return { label:card.textContent, width:c.width, height:c.height, imageWidth:i.width, imageHeight:i.height, fit:getComputedStyle(cover).objectFit, aspect:card.style.getPropertyValue('--display-card-aspect') };
    }));
    const tall = layout.find(item => item.label.includes('竖图')), wide = layout.find(item => item.label.includes('横图'));
    assert.ok(tall.height > tall.width && wide.width > wide.height, JSON.stringify(layout));
    assert.match(layout.find(item => item.label.includes('横视频')).aspect, /320\s*\/\s*180/);
    for (const item of layout) { assert.equal(item.fit, 'cover'); assert.ok(Math.abs(item.width - item.imageWidth) < 3 && Math.abs(item.height - item.imageHeight) < 3); }
    for (const width of [390, 1440]) {
        await page.setViewport({ width, height:844, hasTouch:true });
        const cards = await page.$$eval('.display-media-library-entry', nodes => nodes.map(node => {
            const box = node.getBoundingClientRect(); return { left:box.left, right:box.right, top:box.top, bottom:box.bottom };
        }));
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i], b = cards[j];
            assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${width} 媒体卡片重叠`);
        }
    }
    await page.setViewport({ width:390, height:844, hasTouch:true });
    const overflow = await page.$eval('#displayMediaLibraryEntries', node => ({ horizontal:node.scrollWidth - node.clientWidth, vertical:node.scrollHeight > node.clientHeight }));
    assert.ok(overflow.horizontal <= 1, `汇总列表不能水平溢出: ${JSON.stringify(overflow)}`);
    await page.evaluate(() => document.querySelector('.display-media-library-entry[data-library-id="b"] .display-media-library-entry-name').click());
    await page.waitForFunction(() => document.querySelector('#displayMediaLibraryEntries').textContent.includes('b子文件'));
    await page.click('#displayMediaLibraryUp');
    await page.waitForFunction(() => document.querySelectorAll('.display-media-library-entry').length === 5);
    await page.evaluate(() => {
        document.querySelector('.display-media-library-entry[data-library-id="b"] .display-media-library-entry-name').click();
        document.getElementById('displayMediaLibraryUp').click();
    });
    await page.waitForFunction(() => document.querySelectorAll('.display-media-library-entry').length === 5);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(await page.$eval('#displayMediaLibraryPath', node => node.textContent), '全部媒体');
    await page.evaluate(() => document.querySelector('.display-media-library-entry[data-library-id="b"] .display-media-library-batch').click());
    assert.deepEqual(await page.evaluate(() => ({ type:sent.at(-1).type, libraryId:sent.at(-1).libraryId, path:sent.at(-1).path })), { type:'displayPlaylistRequest', libraryId:'b', path:'/same' });
    await page.click('#displayMediaLibraryToggle');
    await page.waitForFunction(() => document.querySelectorAll('.display-media-library-entry').length === 5);
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry[data-library-id="a"] .display-media-library-entry-name')].find(node => node.textContent === '竖图').click());
    assert.deepEqual(await page.evaluate(() => ({ type:sent.at(-1).type, libraryId:sent.at(-1).libraryId, path:sent.at(-1).path })), { type:'displayPlaylistCancel', libraryId:'a', path:'/tall.png' });
});
