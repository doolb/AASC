'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const read = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('首次展开、会话恢复和迟到历史使用真实聊天与舞台模块', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async (context) => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    context.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    async function reset() {
        const $ = cheerio.load(read('display.html'));
        $('script, link[rel="stylesheet"]').remove();
        $('head').append(`<style>${read('css/theme.css')}${read('css/display.css')}${read('css/display-mmd.css')}${read('css/display-chat.css')}</style>`);
        await page.setViewport({ width: 390, height: 740 });
        // 每次换新文档，确保检验首次展开而非上一次关闭留下的选择。
        await page.goto('about:blank');
        await page.setContent($.html());
        await page.addScriptTag({ path: path.join(publicDir, 'js/display-chat.js') });
        await page.addScriptTag({ path: path.join(publicDir, 'js/display-stage.js') });
        await page.evaluate(() => {
            window.sent = [];
            window.DisplayStage.setTransport((message) => { window.sent.push(message); return true; });
        });
    }
    const deliver = (message) => page.evaluate((payload) => window.DisplayStage.handleServerMessage(payload), message);
    const latestHistory = () => page.evaluate(() => window.sent.findLast((message) =>
        ['chatHistory', 'roleHistory'].includes(message.type)));
    const text = () => page.$eval('[data-role="messages"]', (element) => element.textContent);

    await context.test('恢复私聊后首次展开直接加载当前历史，无默认群聊请求', async () => {
        await reset();
        assert.equal(await latestHistory(), undefined);
        await deliver({ type: 'chatSession', session: { mode: 'private', privateTarget: '小爱', privateSessionId: 'saved' } });
        const restored = await latestHistory();
        assert.equal(restored.target, '小爱');
        assert.equal(restored.sessionId, 'saved');
        assert.equal(await page.$eval('#displayChatLayer', (node) => getComputedStyle(node).display), 'none');
        await page.click('#displayChatToggle');
        const opened = await latestHistory();
        assert.notEqual(opened.requestId, restored.requestId);
        await deliver({ type: 'chatHistory', requestId: opened.requestId,
            history: [{ mode: 'private', target: '小爱', sessionId: 'saved', role: 'assistant', content: '恢复后的聊天内容' }] });
        assert.match(await text(), /恢复后的聊天内容/u);
        assert.equal(await page.$eval('[data-role="messages"]', (node) => node.getBoundingClientRect().height > 0), true);
        const count = await page.evaluate(() => window.sent.filter((message) => message.type === 'chatHistory').length);
        await page.evaluate(() => window.DisplayStage.setChatVisible(true));
        assert.equal(await page.evaluate(() => window.sent.filter((message) => message.type === 'chatHistory').length), count);
    });

    await context.test('群聊和角色首次展开、角色空历史及旧端历史兼容', async () => {
        for (const session of [{ mode: 'group' }, { mode: 'role', roleTarget: '工作角色' }]) {
            await reset();
            await deliver({ type: 'chatSession', session });
            await page.click('#displayChatToggle');
            const request = await latestHistory();
            assert.equal(request.type, session.mode === 'role' ? 'roleHistory' : 'chatHistory');
            const response = { type: request.type, role: session.roleTarget,
                history: [{ mode: session.mode, target: session.roleTarget, role: 'assistant', content: '首次消息' }] };
            // 兼容旧服务端不回传请求标识的响应。
            await deliver(response);
            assert.match(await text(), /首次消息/u);
            await deliver({ ...response, history: [] });
            assert.equal(await text(), '');
        }
    });

    await context.test('切换会话和同范围重复查询的旧响应均不覆盖最新内容', async () => {
        await reset();
        await deliver({ type: 'chatSession', session: { mode: 'group' } });
        const group = await latestHistory();
        await page.click('#displayChatToggle');
        await deliver({ type: 'chatSession', session: { mode: 'private', privateTarget: '小爱' } });
        const current = await latestHistory();
        await deliver({ type: 'chatHistory', requestId: current.requestId,
            history: [{ mode: 'private', target: '小爱', role: 'assistant', content: '当前内容' }] });
        await deliver({ type: 'chatHistory', requestId: group.requestId, history: [] });
        assert.match(await text(), /当前内容/u);
        await deliver({ type: 'chatHistory', history: [{ mode: 'group', role: 'assistant', content: '旧群聊' }] });
        assert.match(await text(), /当前内容/u);
        await page.evaluate(() => { window.DisplayStage.setChatVisible(false); window.DisplayStage.setChatVisible(true); });
        const reopened = await latestHistory();
        assert.notEqual(reopened.requestId, current.requestId);
        await deliver({ type: 'chatHistory', requestId: current.requestId, history: [] });
        assert.match(await text(), /当前内容/u);
    });

    await context.test('历史刷新保留流式节点，完成回复后旧快照不擦除消息', async () => {
        await reset();
        await deliver({ type: 'chatSession', session: { mode: 'group' } });
        await page.click('#displayChatToggle');
        const request = await latestHistory();
        await deliver({ type: 'chatInput', requestId: 'live', content: '正在提问' });
        await deliver({ type: 'chatChunk', requestId: 'live', chunk: '第一段' });
        await deliver({ type: 'chatHistory', requestId: request.requestId,
            history: [{ mode: 'group', role: 'assistant', content: '过去消息' },
                { mode: 'group', role: 'user', content: '正在提问' }] });
        await deliver({ type: 'chatChunk', requestId: 'live', chunk: '第二段' });
        assert.match(await text(), /过去消息/u);
        assert.match(await text(), /第一段第二段/u);
        assert.equal(await page.$$eval('.display-chat-message.is-user', (nodes) => nodes.length), 1);
        await deliver({ type: 'chatResponse', requestId: 'live', success: true, message: { content: '完整答案' } });
        await deliver({ type: 'chatHistory', requestId: request.requestId, history: [] });
        assert.match(await text(), /完整答案/u);
    });

    await context.test('断线重连重新读取权威会话，保持面板关闭', async () => {
        await reset();
        await deliver({ type: 'chatSession', session: { mode: 'group' } });
        await page.evaluate(() => {
            window.DisplayStage.setTransport(null);
            window.DisplayStage.setTransport((message) => { window.sent.push(message); return true; });
        });
        assert.equal(await page.evaluate(() => window.sent.filter((message) => message.type === 'getChatSession').length), 2);
        await deliver({ type: 'chatSession', session: { mode: 'group' } });
        assert.equal(await page.evaluate(() => window.sent.filter((message) => message.type === 'chatHistory').length), 2);
        assert.equal(await page.$eval('#displayChatLayer', (node) => getComputedStyle(node).display), 'none');
    });
    assert.deepEqual(errors, []);
});

test('灯光组贴右下角，面板左侧向上展开且四向旋转和键盘下不越界', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async (context) => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    context.after(() => browser.close());
    const page = await browser.newPage();
    const $ = cheerio.load(read('display.html'));
    $('script, link[rel="stylesheet"]').remove();
    $('head').append(`<style>${read('css/theme.css')}${read('css/display.css')}${read('css/display-mmd.css')}${read('css/display-voice-controls.css')}</style>`);
    await page.setContent($.html());
    await page.addScriptTag({ path: path.join(publicDir, 'js/display-stage.js') });
    await page.addScriptTag({ path: path.join(publicDir, 'js/display-mmd-panel-groups.js') });
    await page.evaluate(() => { document.getElementById('displayArTargetToggle').textContent = '定位中'; });
    for (const viewport of [{ width: 390, height: 740 }, { width: 840, height: 390 }]) {
        await page.setViewport(viewport);
        // resize 是异步浏览器事件；先等真实舞台尺寸更新，避免把旧视口当作新视口校验。
        await page.waitForFunction(({ width, height }) => {
            const geometry = window.DisplayStage.getRotationGeometry();
            return geometry.viewportWidth === width && geometry.viewportHeight === height;
        }, {}, viewport);
        for (const rotation of [0, 90, 180, 270]) {
            await page.evaluate((angle) => window.DisplayStage.setRotation(angle), rotation);
            for (const id of ['displayMmdLightingToggle', 'displayMmdMotionToggle', 'displayArTargetToggle']) {
                // 只验证实际面板的排版，避免启动模型加载和定位摄像头生命周期。
                const button = await page.$(`#${id}`);
                assert.ok(button, id);
                await page.evaluate((buttonId) => {
                    const control = document.querySelector('.display-stage-lighting-control');
                    const panelId = document.getElementById(buttonId).getAttribute('aria-controls');
                    for (const panel of control.querySelectorAll(':scope > section')) panel.hidden = panel.id !== panelId;
                }, id);
                const geometry = await page.evaluate(() => {
                    const stage = window.DisplayStage;
                    const dimensions = stage.getRotationGeometry();
                    const bounds = document.getElementById('displayStageLayers').getBoundingClientRect();
                    const control = document.querySelector('.display-stage-lighting-control');
                    const rect = control.getBoundingClientRect();
                    const center = stage.mapViewportPointToStage((rect.left + rect.right) / 2,
                        (rect.top + rect.bottom) / 2, bounds, dimensions);
                    const panel = [...control.children].find((node) =>
                        node.matches('.display-mmd-lighting-panel, .display-mmd-ar-panel') && !node.hidden);
                    const panelRect = panel.getBoundingClientRect();
                    const panelCenter = stage.mapViewportPointToStage((panelRect.left + panelRect.right) / 2,
                        (panelRect.top + panelRect.bottom) / 2, bounds, dimensions);
                    const circle = document.getElementById('displayVoiceAction').getBoundingClientRect();
                    return { center, dimensions, controlWidth: control.offsetWidth, controlHeight: control.offsetHeight,
                        panel: { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom },
                        logicalPanelBottom: panelCenter.y + panel.offsetHeight / 2,
                        logicalPanelRight: panelCenter.x + panel.offsetWidth / 2,
                        intersectsCircle: rect.right > circle.left && rect.left < circle.right
                            && rect.bottom > circle.top && rect.top < circle.bottom };
                });
                assert.ok(Math.abs(geometry.center.x - (geometry.dimensions.logicalWidth - 12 - geometry.controlWidth / 2)) <= 1);
                assert.ok(Math.abs(geometry.center.y - (geometry.dimensions.logicalHeight - 12 - geometry.controlHeight / 2)) <= 1);
                assert.equal(geometry.intersectsCircle, false);
                assert.ok(Math.abs(geometry.logicalPanelBottom - (geometry.dimensions.logicalHeight - 12)) <= 1);
                assert.ok(geometry.logicalPanelRight <= geometry.center.x - geometry.controlWidth / 2 - 7);
                assert.ok(geometry.panel.left >= -1 && geometry.panel.right <= viewport.width + 1, JSON.stringify(geometry));
                assert.ok(geometry.panel.top >= -1 && geometry.panel.bottom <= viewport.height + 1, JSON.stringify(geometry));
            }
        }
    }
    await page.setViewport({ width: 390, height: 740 });
    await page.evaluate(() => window.DisplayStage.setRotation(0));
    await page.waitForFunction(() => window.DisplayStage.getRotationGeometry().logicalWidth === 390
        && window.DisplayStage.getRotationGeometry().logicalHeight === 740);
    await page.evaluate(() => {
        const stage = document.getElementById('displayStageLayers');
        stage.style.setProperty('--display-safe-inset-top', '18px');
        stage.style.setProperty('--display-safe-inset-right', '24px');
        stage.style.setProperty('--display-safe-inset-bottom', '20px');
        stage.style.setProperty('--display-keyboard-inset-bottom', '100px');
    });
    await page.evaluate(() => {
        for (const panel of document.querySelectorAll('.display-stage-lighting-control > section')) {
            panel.hidden = panel.id !== 'displayMmdLightingPanel';
        }
    });
    const bounds = await page.evaluate(() => {
        const rect = document.querySelector('.display-stage-lighting-control').getBoundingClientRect();
        const panel = document.getElementById('displayMmdLightingPanel').getBoundingClientRect();
        return { right: rect.right, bottom: rect.bottom, panelTop: panel.top, panelBottom: panel.bottom,
            panelRight: panel.right, controlLeft: rect.left };
    });
    assert.equal(bounds.right, 366);
    assert.equal(bounds.bottom, 620);
    assert.equal(bounds.panelBottom, 620);
    assert.ok(bounds.panelTop >= 18);
    assert.ok(bounds.panelRight <= bounds.controlLeft - 8);
    const modelStatus = await page.evaluate(() => {
        const status = document.getElementById('displayMmdStatus');
        status.textContent = 'PMX 模型已加载';
        const normal = getComputedStyle(status).display;
        status.classList.add('is-error');
        status.textContent = '角色模型加载失败';
        const error = getComputedStyle(status).display;
        const bounds = status.getBoundingClientRect();
        const top = bounds.top;
        const height = bounds.height;
        status.classList.remove('is-error');
        status.textContent = '';
        return { normal, error, top, height, loadingProgress: !!document.getElementById('displayMmdLoadingProgress') };
    });
    assert.ok(modelStatus.height > 0 && modelStatus.height < 100);
    assert.equal(modelStatus.normal, 'none');
    assert.equal(modelStatus.error, 'block');
    assert.equal(modelStatus.top, 18);
    assert.equal(modelStatus.loadingProgress, true);
    const topmost = await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:auto';
        document.body.appendChild(overlay);
        const panel = document.getElementById('displayMmdLightingPanel');
        const rect = panel.getBoundingClientRect();
        const visibleOnTop = !!document.elementFromPoint(rect.left + 20, rect.top + 20)?.closest('#displayMmdLightingPanel');
        const openZ = getComputedStyle(document.getElementById('displayStageLayers')).zIndex;
        overlay.remove();
        panel.hidden = true;
        const closedZ = getComputedStyle(document.getElementById('displayStageLayers')).zIndex;
        panel.hidden = false;
        return { visibleOnTop, openZ, closedZ };
    });
    assert.deepEqual(topmost, { visibleOnTop: true, openZ: '10001', closedZ: '3000' });
    const cache = path.join(process.env.TMPDIR || '/tmp', 'display-right-bottom-preview');
    fs.mkdirSync(cache, { recursive: true });
    await page.screenshot({ path: path.join(cache, 'portrait.png') });
});

test('正式 chatHistory WebSocket 分支回传显示端历史请求标识，控制端兼容', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    const start = source.indexOf("} else if (data.type === 'chatHistory') {");
    const end = source.indexOf("} else if (data.type === 'clearChatHistory') {", start);
    const branch = source.slice(start + "} else if (data.type === 'chatHistory') {".length, end);
    const calls = [];
    const context = { data: { source: 'displayChat', requestId: 'history-1', mode: 'private', target: '小爱', sessionId: 'saved' },
        ws: { send: (value) => calls.push(JSON.parse(value)) },
        chat: { getHistory: (options) => { assert.equal(options.target, '小爱'); return []; } }, logError() {} };
    vm.runInNewContext(`(function () { ${branch} })()`, context);
    assert.equal(calls[0].requestId, 'history-1');
    context.data = { requestId: 'control-history' };
    context.chat.getHistory = () => [];
    vm.runInNewContext(`(function () { ${branch} })()`, context);
    assert.equal(calls[1].requestId, undefined);
});

test('角色注册适配层回传显示端历史请求标识', async () => {
    const handlers = new Map();
    const calls = [];
    require('../src/apps/server/modules/ai-roles/ai-roles-ws-handler')({
        registerHandler: (type, handler) => handlers.set(type, handler)
    }, { aiRoles: { list: () => [{ name: '工作角色' }], history: () => [] }, broadcastToControls() {} });
    await handlers.get('roleHistory')({ role: '工作角色', source: 'displayChat', requestId: 'role-history-1' },
        { ws: { send: (value) => calls.push(JSON.parse(value)) } });
    assert.equal(calls[0].requestId, 'role-history-1');
});
