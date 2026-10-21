const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = name => fs.readFileSync(path.join(publicDir, name), 'utf8');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const usage = { estimated: true, percent: 50, inputTokens: 2048, budgetTokens: 4096,
    historyCount: 12, historyLimit: 100, imageCount: 0 };

// 使用真实页面模块验证统计收发、范围隔离和布局，不向真实模型或服务发送消息。
for (const endpoint of ['control', 'display']) {
    test(`${endpoint}输入统计：会话隔离、迟到消息、清空、断线及窄屏布局`, {
        skip: !fs.existsSync(chrome), timeout: 30000
    }, async context => {
        const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        context.after(() => browser.close());
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 390, height: 740 });
        if (endpoint === 'control') {
            await page.setContent('<div id="chatContainer" style="height:700px"></div>');
            await page.addStyleTag({ content: read('css/theme.css') + read('css/chat.css') });
            await page.evaluate(() => {
                window.sent = [];
                window.ChatMarkdown = { render: text => String(text || '') };
                window.showToast = () => {};
                window.confirm = () => true;
                window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', history: [] }) });
            });
            await page.addScriptTag({ path: path.join(publicDir, 'js/chat.js') });
            await page.addScriptTag({ path: path.join(publicDir, 'js/websocket.js') });
            await page.evaluate(() => {
                WebSocketManager.ws = { readyState: WebSocket.OPEN, send: message => sent.push(JSON.parse(message)) };
                Chat.session.mode = 'private';
                Chat.session.privateTarget = '小爱';
                Chat.session.privateSessionId = 'one';
                Chat.render();
            });
        } else {
            const $ = cheerio.load(read('display.html'));
            $('script, link[rel="stylesheet"]').remove();
            $('head').append(`<style>${read('css/theme.css')}${read('css/display.css')}${read('css/display-mmd.css')}${read('css/display-chat.css')}</style>`);
            await page.setContent($.html());
            await page.addScriptTag({ path: path.join(publicDir, 'js/display-chat.js') });
            await page.addScriptTag({ path: path.join(publicDir, 'js/display-stage.js') });
            await page.evaluate(() => {
                window.sent = [];
                window.confirm = () => true;
                DisplayStage.setTransport(message => { sent.push(message); return true; });
                DisplayStage.handleServerMessage({ type: 'chatSession', session: {
                    mode: 'private', privateTarget: '小爱', privateSessionId: 'one' } });
                DisplayStage.setChatVisible(true);
            });
        }
        const meter = endpoint === 'control' ? '#chatContextUsage' : '[data-role="context-usage"]';
        const input = endpoint === 'control' ? '#chatInput' : '[data-role="input"]';
        const text = () => page.$eval(meter, node => node.textContent);
        const latest = () => page.evaluate(() => sent.findLast(message => message.type === 'getChatContextUsage'));
        const deliver = message => page.evaluate(({ endpoint, message }) => {
            if (endpoint === 'control') WebSocketManager.handleMessage(message);
            else DisplayStage.handleServerMessage(message);
        }, { endpoint, message });
        const reply = (request, value = usage, extra = {}) => deliver({ type: 'chatContextUsage', requestId: request.requestId,
            scope: { mode: request.mode, target: request.target, sessionId: request.sessionId }, usage: value, ...extra });

        const first = await latest();
        assert.ok(first);
        assert.equal(await text(), '上下文 — · 对话 —');
        await reply(first);
        assert.equal(await text(), '上下文 ≈50% · 对话 12/100');
        const layout = await page.evaluate(({ meter, input }) => {
            const stat = document.querySelector(meter).getBoundingClientRect();
            const field = document.querySelector(input).getBoundingClientRect();
            return { above: stat.bottom <= field.top, fits: stat.left >= 0 && stat.right <= innerWidth,
                inputVisible: field.width > 40 && field.bottom <= innerHeight };
        }, { meter, input });
        assert.deepEqual(layout, { above: true, fits: true, inputVisible: true });

        // 切换同一角色的另一会话，旧范围和旧请求编号都不能污染当前统计。
        await page.evaluate(endpoint => {
            if (endpoint === 'control') { Chat.session.privateSessionId = 'two'; Chat.renderHistory(); }
            else DisplayStage.handleServerMessage({ type: 'chatSession', session: {
                mode: 'private', privateTarget: '小爱', privateSessionId: 'two' } });
        }, endpoint);
        const second = await latest();
        assert.equal(second.sessionId, 'two');
        assert.equal(await text(), '上下文 — · 对话 —');
        await reply(first);
        assert.equal(await text(), '上下文 — · 对话 —');
        await reply(second, { ...usage, historyCount: 2 });
        assert.match(await text(), /2\/100$/);

        // 真实聊天发送后只接收本轮实时预算，实时结果到达后更早的查询结果失效。
        await page.type(input, '你好');
        await page.click(endpoint === 'control' ? '#chatSendBtn' : '.display-chat-send');
        const active = await page.evaluate(() => sent.findLast(message => message.type === 'chatMessage'));
        assert.ok(active?.requestId);
        await reply({ ...second, requestId: active.requestId }, { ...usage, historyCount: 3 }, { live: true });
        assert.match(await text(), /3\/100$/);
        await reply(second);
        await reply({ ...second, requestId: 'old-request' }, usage, { live: true });
        assert.match(await text(), /3\/100$/);

        if (endpoint === 'control') {
            await page.evaluate(() => Chat.clearHistory());
        } else {
            await page.click('[data-action="clear"]');
            const clear = await page.evaluate(() => sent.findLast(message => message.type === 'clearChatHistory'));
            assert.ok(clear);
            await page.evaluate(clear => DisplayStage.handleServerMessage({ ...clear,
                type: 'chatHistory', cleared: true, history: [] }), clear);
        }
        const cleared = await latest();
        assert.notEqual(cleared.requestId, second.requestId);
        await reply(cleared, { ...usage, percent: 8, historyCount: 0 });
        assert.equal(await text(), '上下文 ≈8% · 对话 0/100');
        await reply({ ...second, requestId: active.requestId }, usage, { live: true });
        assert.match(await text(), /0\/100$/);

        await page.evaluate(endpoint => {
            if (endpoint === 'control') Chat.onProfileConnectionClosed();
            else DisplayStage.setTransport(null);
        }, endpoint);
        assert.equal(await text(), '上下文 — · 对话 —');
        assert.deepEqual(errors, []);
    });
}
