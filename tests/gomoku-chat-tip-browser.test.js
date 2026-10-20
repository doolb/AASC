const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('控制端游戏协议提示实时显示并从历史恢复', { skip: !fs.existsSync(chrome) }, async () => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setContent('<div id="chatMessages"><div id="streamingAssistant"><div id="streamingContent"></div></div></div>');
        await page.addStyleTag({ path: path.join(publicDir, 'css/chat.css') });
        await page.evaluate(() => { window.ChatMarkdown = { render: text => String(text || '') }; });
        await page.addScriptTag({ path: path.join(publicDir, 'js/chat.js') });
        await page.evaluate(() => {
            Chat.activeRequestId = 'game-test';
            Chat.handleGameProtocol({ requestId: 'game-test', sequence: 1, kind: 'AI',
                text: '<Game:五子棋,AI,落子,H4>', summary: 'AI · 落子 H4' });
            Chat.handleGameProtocol({ requestId: 'game-test', sequence: 1, kind: 'AI',
                text: '<Game:五子棋,AI,落子,H4>', summary: 'AI · 落子 H4' });
        });
        assert.equal(await page.$$eval('.chat-game-protocol-tip', nodes => nodes.length), 1);
        assert.equal(await page.$eval('.chat-game-protocol-tip', node => getComputedStyle(node).fontSize), '11px');
        assert.equal(await page.$eval('.chat-game-protocol-tip', node => node.textContent), 'AI · 落子 H4');
        await page.evaluate(() => {
            for (const [sequence, kind, text, summary] of [
                [2, 'GM', '<Game:五子棋,GM,落子,a93d,3,AI,H4,User,进行中>', 'GM · 第3手 AI H4'],
                [3, 'User', '<Game:五子棋,User,落子,H3>', 'User · 落子 H3'],
                [4, 'GM', '<Game:五子棋,GM,落子,a93d,4,User,H3,AI,进行中>', 'GM · 第4手 User H3']
            ]) Chat.handleGameProtocol({ requestId: 'game-test', sequence, kind, text, summary });
        });
        assert.deepEqual(await page.$$eval('.chat-game-protocol-tip', nodes => nodes.map(node => node.textContent)),
            ['AI · 落子 H4', 'GM · 第3手 AI H4', 'User · 落子 H3', 'GM · 第4手 User H3']);
        await page.evaluate(() => {
            Chat.history = [{ role: 'assistant', mode: 'group', name: '助手', content: '我下 H4',
                gameTrace: Array.from({ length: 25 }, (_, index) => ({ sequence: index + 1,
                    kind: 'AI', text: '<Game:五子棋,AI,查看>', summary: `提示 ${index + 1}` })) }];
            Chat.renderHistory();
        });
        assert.equal(await page.$$eval('.chat-game-protocol-tip', nodes => nodes.length), 25);
        assert.equal(await page.$eval('.chat-game-protocol-tip:last-of-type', node => node.textContent), '提示 25');
        assert.match(await page.$eval('#chatMessages', node => node.textContent), /我下 H4/);
    } finally {
        await browser.close();
    }
});
