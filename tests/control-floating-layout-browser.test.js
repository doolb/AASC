const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');

test('真实控制端样式下三个浮动按钮避开竖屏导航，横屏位置保持', { timeout: 30000 }, async (t) => {
    const publicRoot = path.resolve('src/apps/web-mediacenter/ui/public');
    const cache = path.join(os.homedir(), '.cache/aasc-control-layout');
    fs.mkdirSync(cache, { recursive: true });
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium', puppeteer.executablePath()]
        .find((file) => file && fs.existsSync(file));
    if (!executablePath) { t.skip('无可用Chromium'); return; }
    // 使用正式页面DOM与所有正式CSS，只移除与布局无关的业务脚本和外部资源请求。
    const html = fs.readFileSync(path.join(publicRoot, 'upload.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
        .replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/gu,
            (_match, href) => `<style>${fs.readFileSync(path.join(publicRoot, href), 'utf8')}</style>`);
    const browser = await puppeteer.launch({ executablePath, headless: true,
        env: { ...process.env, TMPDIR: cache }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (request) => request.abort());
        for (const [width, height] of [[360, 800], [480, 800], [800, 480]]) {
            await page.setViewport({ width, height });
            await page.setContent(html);
            const geometry = await page.evaluate(() => {
                const rect = (selector) => {
                    const r = document.querySelector(selector).getBoundingClientRect();
                    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
                };
                return { nav: rect('.sidebar'), buttons: [
                    rect('#floatingControlToggle'), rect('.self-test-trigger-btn'), rect('#floatingRecordingPauseButton')
                ] };
            });
            if (width < height) {
                for (const button of geometry.buttons) assert.ok(button.bottom < geometry.nav.top, JSON.stringify(geometry));
            } else {
                assert.equal(height - geometry.buttons[0].bottom, 20);
                assert.equal(height - geometry.buttons[1].bottom, 80);
                assert.equal(height - geometry.buttons[2].bottom, 140);
            }
            assert.equal(geometry.buttons[0].top - geometry.buttons[1].top, 60);
            assert.equal(geometry.buttons[1].top - geometry.buttons[2].top, 60);
        }
        await page.setViewport({ width: 360, height: 800 });
        await page.setContent(html);
        await page.screenshot({ path: path.join(cache, 'control-floating-portrait.png') });
    } finally {
        await browser.close();
    }
});
