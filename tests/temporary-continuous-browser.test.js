'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const root = path.resolve('src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('临时聊天连续显示旧消息、角色切换后继续、清空提示明确', { skip: !fs.existsSync(chrome), timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.setContent('<div id="chatContainer" style="height:750px"></div>');
    for (const css of ['theme.css', 'chat.css']) await page.addStyleTag({ path: path.join(root, 'css', css) });
    await page.evaluate(() => {
        window.sent = []; window.showToast = () => {}; window.ChatMarkdown = { render: text => String(text || '') };
        window.confirm = message => { window.confirmMessage = message; return true; };
        window.fetch = async () => ({ ok:true, json:async () => ({ status:'success', history:[] }) });
        window.WebSocketManager = { send: message => sent.push(message), ws: { readyState: WebSocket.OPEN, send: message => sent.push(JSON.parse(message)) } };
    });
    await page.addScriptTag({ path: path.join(root, 'js/chat.js') });
    await page.evaluate(() => {
        Chat.session.mode = 'temporary';
        Chat.templates = [{ name:'小爱', content:'角色一' }, { name:'妲己', content:'角色二' }];
        Chat.render();
        Chat.handleTemporaryConversation({ action:'snapshot', conversation: { id:'current', roleName:'小爱', messages:[
            { id:'old', mode:'temporary', sessionId:'old', role:'control', name:'用户', content:'之前的对话', timestamp:1 },
            { id:'current', mode:'temporary', sessionId:'current', role:'assistant', name:'小爱', content:'当前的回复', timestamp:2 }
        ], historyGroups:[] } });
    });
    assert.match(await page.$eval('#chatMessages', node => node.textContent), /之前的对话/);
    assert.match(await page.$eval('#chatMessages', node => node.textContent), /当前的回复/);
    assert.equal(await page.$('[data-temporary-history-select]'), null);
    await page.evaluate(() => Chat.handleTemporaryConversation({ action:'reset', conversation: { id:'next', roleName:'妲己', messages:[
        { id:'old', mode:'temporary', sessionId:'old', role:'control', name:'用户', content:'之前的对话', timestamp:1 },
        { id:'current', mode:'temporary', sessionId:'current', role:'assistant', name:'小爱', content:'当前的回复', timestamp:2 }
    ], historyGroups:[] } }));
    assert.match(await page.$eval('#chatMessages', node => node.textContent), /之前的对话/);
    assert.equal(await page.evaluate(() => Chat.temporaryConversation.roleName), '妲己');
    await page.evaluate(() => Chat.clearHistory());
    assert.match(await page.evaluate(() => window.confirmMessage), /全部临时聊天记录/);
    assert.equal(await page.evaluate(() => window.sent.at(-1).type), 'clearTemporaryConversation');
});
