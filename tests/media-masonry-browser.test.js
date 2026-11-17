'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const root = path.resolve('src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('媒体瀑布流按真实尺寸重排，动态加载和缩放不重叠', { skip: !fs.existsSync(chrome), timeout: 45000 }, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    $('script,link,style').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, hasTouch: true });
    await page.setContent($.html());
    for (const css of ['upload.css', 'chat.css', 'media-library.css', 'theme.css', 'control-workspace.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
    await page.addStyleTag({ content: '*, *::before, *::after { transition:none !important; animation:none !important; }' });
    await page.evaluate(() => {
        document.querySelectorAll('.panel').forEach(p => p.style.display = p.id === 'panel-media' ? 'block' : 'none');
        const root = document.getElementById('mediaLibraryContent');
        root.innerHTML = '';
        const card = (id, src, folder = false) => {
            const el = document.createElement('div'); el.id = id; el.className = 'media-library-item' + (folder ? ' folder' : '');
            if (src !== null) el.innerHTML = `<div class="media-thumb-wrapper"><img class="media-thumb" ${src ? `src="${src}"` : ''}></div><div class="item-name">测试媒体</div><div class="item-meta">image</div><div class="item-actions"><button onclick="window.played = (window.played || 0) + 1">播放</button></div>`;
            else el.innerHTML = '<div class="folder-icon">文件夹</div><div class="item-name">目录</div>';
            root.append(el);
            return el;
        };
        window.svgImage = (w, h, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/></svg>`);
        card('wide', window.svgImage(900, 600, 'red'));
        card('tall', window.svgImage(400, 800, 'blue'));
        card('square', window.svgImage(400, 400, 'green'));
        card('unknown', '', false);
        card('folder', null, true);
        for (let i = 0; i < 5; i++) card('extra' + i, window.svgImage(400, 600 + i * 50, 'purple'));
        const remote = document.getElementById('bilibiliVideoList'); remote.style.display = 'grid';
        remote.innerHTML = '<div class="bilibili-section-title">推荐</div><div id="remote" class="bilibili-video-card"><img class="bilibili-video-cover"><div class="bilibili-video-title">远程内容</div><div class="bilibili-video-actions"><button>播放</button></div></div>';
        remote.querySelector('img').src = window.svgImage(400, 800, 'orange');
    });
    await page.addScriptTag({ path: path.join(root, 'js/media-masonry.js') });
    const settle = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))); await new Promise(resolve => setTimeout(resolve, 200)); };
    await page.waitForFunction(() => document.querySelector('#wide').style.getPropertyValue('--media-aspect') && document.querySelector('#remote').style.getPropertyValue('--media-aspect'));
    await settle();
    const check = async (width, expectFallback = true) => {
        const data = await page.evaluate(() => {
            const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
            const root = document.getElementById('mediaLibraryContent');
            return { wide: box('wide'), tall: box('tall'), square: box('square'), unknown: box('unknown'), folder: box('folder'), remote: box('remote'), items:[...root.children].map(el => ({ id: el.id, ...box(el.id) })), loaded: document.getElementById('wide').style.getPropertyValue('--media-aspect'), fallback: document.getElementById('unknown').style.getPropertyValue('--media-aspect'), remoteAspect: document.getElementById('remote').style.getPropertyValue('--media-aspect') };
        });
        assert.match(data.loaded, /900\s*\/\s*600/);
        assert.match(data.remoteAspect, /400\s*\/\s*800/);
        if (expectFallback) assert.equal(data.fallback, '');
        else assert.match(data.fallback, /800\s*\/\s*400/);
        assert.ok(data.wide.width > data.tall.width, `${width} 横向卡片应更宽`);
        assert.ok(data.tall.height > data.tall.width, `${width} 竖向卡片应更高`);
        assert.ok(data.items.some(item => item.id !== 'tall' && item.top > data.tall.top + 1 && item.top < data.tall.bottom - 1), `${width} 较短卡片下方应能放置其他卡片`);
        for (let i = 0; i < data.items.length; i++) for (let j = i + 1; j < data.items.length; j++) {
            const a = data.items[i], b = data.items[j];
            assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${width} 卡片重叠: ${a.id}/${b.id}`);
        }
    };
    await check(1440);
    await page.evaluate(() => { document.querySelector('#unknown img').src = window.svgImage(800, 400, 'pink'); });
    await page.waitForFunction(() => document.querySelector('#unknown').classList.contains('masonry-wide'));
    await settle();
    await check(1440, false);
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const finished = new Promise(resolve => { recorder.onstop = resolve; });
        recorder.start(); canvas.getContext('2d').fillRect(0, 0, 320, 180);
        await new Promise(resolve => setTimeout(resolve, 250)); recorder.stop(); await finished;
        stream.getTracks().forEach(track => track.stop());
        const card = document.createElement('div'); card.id = 'video'; card.className = 'media-library-item';
        card.innerHTML = '<div class="media-thumb-wrapper"><video class="media-thumb" preload="metadata" muted></video></div><div class="item-name">视频</div>';
        card.querySelector('video').src = URL.createObjectURL(new Blob(chunks, { type:'video/webm' }));
        document.getElementById('mediaLibraryContent').append(card);
    });
    await page.waitForFunction(() => document.querySelector('#video').style.getPropertyValue('--media-aspect').includes('320'));
    await page.setViewport({ width: 390, height: 844, hasTouch: true });
    await settle();
    const mobile = await page.evaluate(() => [...document.querySelectorAll('#mediaLibraryContent > *')].map(el => { const r = el.getBoundingClientRect(); return { id:el.id, l:r.left, r:r.right, t:r.top, b:r.bottom }; }));
    for (let i = 0; i < mobile.length; i++) for (let j = i + 1; j < mobile.length; j++) { const a = mobile[i], b = mobile[j]; assert.ok(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1, `手机卡片重叠: ${a.id}/${b.id}`); }
    assert.equal(await page.$eval('#wide .item-actions', element => getComputedStyle(element).opacity), '1');
    await page.click('#wide .item-actions button');
    assert.equal(await page.evaluate(() => window.played), 1);
});
