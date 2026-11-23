const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('控制台各面板在现有主题及桌面、手机宽度保持可见', { timeout: 30000 }, async t => {
    const root = path.resolve('src/apps/web-mediacenter/ui/public');
    const $ = cheerio.load(fs.readFileSync(path.join(root, 'upload.html'), 'utf8'));
    $('script, link, style').remove();
    $('#chatContainer').html('<div class="chat-tabs"><div class="chat-tab active">助手</div></div><div class="chat-main"><div class="chat-header"><h3>聊天</h3></div><div class="chat-messages">消息</div><div class="chat-input-row"><input id="chatInput"><button>发送</button></div></div>');
    $('#panel-task').html('<div class="task-tabs"><button class="task-tab active">任务列表</button></div><div class="task-three-col"><div class="task-list-col"><div class="task-card selected"><div class="task-card-title">任务</div></div></div><div class="task-instances-col">实例</div><div class="task-result-col">结果</div></div>');
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent($.html());
    for (const css of ['upload.css', 'chat.css', 'media-library.css', 'theme.css', 'control-workspace.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
    const themes = ['dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold', 'mint', 'ocean', 'forest', 'slate', 'algae-salt', 'girl-pink', 'rose-gold', 'new-year-red'];
    for (const width of [390, 1440]) {
        await page.setViewport({ width, height: 900 });
        for (const theme of themes) {
            const result = await page.evaluate(({ theme }) => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.dataset.themeMode = theme === 'dark' ? 'dark' : 'light';
                const results = {};
                for (const name of ['display', 'chat', 'media', 'task']) {
                    document.querySelectorAll('.panel').forEach(panel => { panel.style.display = panel.id === `panel-${name}` ? 'block' : 'none'; });
                    const selector = { display: '#backgroundMediaUrl', chat: '#chatInput', media: '.media-library-container', task: '.task-card' }[name];
                    const el = document.querySelector(selector);
                    const rect = el.getBoundingClientRect();
                    const style = getComputedStyle(el);
                    results[name] = { visible: rect.width > 0 && rect.height > 0, left: rect.left, right: rect.right, color: style.color, background: style.backgroundColor };
                }
                return results;
            }, { theme });
            for (const [name, item] of Object.entries(result)) {
                assert.ok(item.visible, `${theme}/${width}/${name} 不可见`);
                assert.ok(item.left >= -1 && item.right <= width + 1, `${theme}/${width}/${name} 超出屏幕`);
                assert.notEqual(item.color, 'rgba(0, 0, 0, 0)', `${theme}/${width}/${name} 文字透明`);
            }
        }
        const panels = await page.evaluate(() => {
            return [...document.querySelectorAll('main.content > .panel')].map(panel => {
                document.querySelectorAll('.panel').forEach(item => { item.style.display = item === panel ? 'block' : 'none'; });
                const rect = panel.getBoundingClientRect();
                return { id: panel.id, left: rect.left, right: rect.right, width: rect.width };
            });
        });
        for (const panel of panels) assert.ok(panel.width > 0 && panel.left >= -1 && panel.right <= width + 1, `${width}/${panel.id} 超出屏幕`);
    }
});
