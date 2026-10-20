const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium',
    '/usr/bin/google-chrome'].find(candidate => candidate && fs.existsSync(candidate));

test('连接脚本运行前游戏模块已注册五子棋', { skip: !CHROME }, async () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8');
    const $ = cheerio.load(html);
    const gameScript = $('script[src="js/display-game.js"]').toString();
    const server = http.createServer((request, response) => {
        if (request.url === '/js/display-game.js') {
            response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            response.end(fs.readFileSync(path.join(PUBLIC, 'js/display-game.js')));
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<html><body>${gameScript}<script>window.gamesAtConnection = window.DisplayGame?.supportedGames || [];<\/script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        assert.deepEqual(await page.evaluate(() => window.gamesAtConnection), ['五子棋']);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('显示端五子棋首连快照、点击增量和版本缺口恢复', { skip: !CHROME }, async () => {
    const displayHtml = fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8');
    const $ = cheerio.load(displayHtml);
    const timerSource = displayHtml.match(/function scheduleVoiceConversationTimer\(\) \{[\s\S]*?\n        \}/)?.[0];
    assert.ok(timerSource, '应能读取显示端实际使用的本地对话超时函数');
    const markup = `${$('#displayGameLayer').toString()}<div class="display-interaction-layer">${$('#displayGameChatActions').toString()}</div>`;
    const style = fs.readFileSync(path.join(PUBLIC, 'css/display-game.css'), 'utf8')
        + fs.readFileSync(path.join(PUBLIC, 'css/display-mmd.css'), 'utf8');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 740 });
        await page.setContent(`<style>:root{--display-stage-width:390px;--display-stage-height:740px}</style><style>${style}</style>${markup}`);
        await page.evaluate(() => {
            const subscriptions = new Map();
            window.__sent = [];
            window.__stageMessages = [];
            window.__transportAvailable = false;
            window.__emit = (type, data) => (subscriptions.get(type) || []).forEach(handler => handler(data));
            window.DisplayStage = {
                getBus: () => ({ subscribe(type, handler) {
                    const list = subscriptions.get(type) || [];
                    list.push(handler);
                    subscriptions.set(type, list);
                } }),
                send(message) {
                    if (!window.__transportAvailable) return false;
                    window.__sent.push(message);
                    return true;
                },
                handleServerMessage(message) {
                    window.__stageMessages.push(message);
                    window.__emit('server.message', message);
                    return false;
                },
                getState: () => ({ rotationGeometry: { logicalWidth: 390, logicalHeight: 740, rotation: 0 } })
            };
        });
        await page.addScriptTag({ path: path.join(PUBLIC, 'js/display-game.js') });
        await page.evaluate(() => window.dispatchEvent(new Event('display-stage-ready')));
        assert.equal(await page.evaluate(() => window.__sent.length), 0,
            '舞台初始化早于 WebSocket 建立时，首次恢复请求无法发送');
        await page.evaluate(() => {
            window.__transportAvailable = true;
            window.__emit('transport.changed', { available: true });
        });
        assert.equal(await page.evaluate(() => window.__sent[0].type), 'gameRecover');
        assert.deepEqual(await page.$$eval('[data-game-name]', buttons => buttons.map(button => button.dataset.gameName)),
            ['五子棋']);
        assert.equal(await page.$eval('#displayGameToggle', button => button.textContent), '游戏');
        const entryLayout = await page.evaluate(() => {
            const gameButton = document.getElementById('displayGameToggle');
            const chatButton = document.getElementById('displayChatToggle');
            const gameRect = gameButton.getBoundingClientRect();
            const chatRect = chatButton.getBoundingClientRect();
            const hit = document.elementFromPoint(chatRect.left + chatRect.width / 2,
                chatRect.top + chatRect.height / 2);
            return { above: gameRect.bottom <= chatRect.top, chatClickable: hit === chatButton };
        });
        assert.deepEqual(entryLayout, { above: true, chatClickable: true });
        await page.click('#displayGameToggle');
        assert.equal(await page.$eval('#displayGameMenu', menu => menu.hidden), false);
        await page.click('[data-game-name="五子棋"]');
        assert.match(await page.$eval('#displayGameMenuHint', hint => hint.textContent), /聊天中告诉 AI/);
        assert.equal(await page.evaluate(() => window.__sent.length), 1, '列表不能自行创建棋局');
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#displayGameMenu', menu => menu.hidden), true);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameSnapshot', gameId: 'g1', revision: 1, size: 9,
            board: Array(9).fill('.........').join('/'), turn: 'User', result: '进行中', visible: true
        }));
        assert.equal(await page.$$eval('.display-game-point', list => list.length), 81);
        assert.equal(await page.$$eval('.display-game-point.is-placing', list => list.length), 0,
            '恢复快照不应重新播放旧棋子');
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), true,
            '等待唤醒时应保留棋盘数据但隐藏棋盘');
        await page.evaluate(() => window.__emit('server.message', {
            type: 'voiceConversationState', state: 'activeGroup'
        }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), false);
        assert.equal(await page.$eval('#displayGameToggle', button => button.textContent), '五子棋');
        assert.equal(await page.$eval('#displayGameShell', shell => getComputedStyle(shell).backgroundColor),
            'rgba(0, 0, 0, 0)');
        await page.addStyleTag({ path: path.join(PUBLIC, 'css/theme.css') });
        await page.evaluate(() => { document.documentElement.dataset.themeMode = 'light'; });
        assert.equal(await page.$eval('.display-game-point', point => getComputedStyle(point).backgroundImage), 'none');
        const headerStyle = await page.$eval('.display-game-header', header => {
            const style = getComputedStyle(header);
            return { background: style.backgroundImage, blur: style.backdropFilter,
                radius: style.borderRadius, padding: style.paddingTop };
        });
        assert.match(headerStyle.background, /linear-gradient/);
        assert.match(headerStyle.blur, /blur\(4px\)/);
        assert.notEqual(headerStyle.radius, '0px');
        assert.notEqual(headerStyle.padding, '0px');
        await page.click('[data-coordinate="C3"]');
        const move = await page.evaluate(() => window.__sent.at(-1));
        assert.equal(move.type, 'gameMove');
        assert.equal(move.coordinate, 'C3');
        assert.equal(move.revision, 1);
        assert.match(move.requestId, /^game-\d+$/);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameDelta', gameId: 'g1', revision: 2, actor: 'User', coordinate: 'C3',
            turn: 'AI', result: '进行中'
        }));
        assert.equal(await page.$eval('[data-coordinate="C3"]', button => button.dataset.stone), 'X');
        assert.equal(await page.$eval('[data-coordinate="C3"] .display-game-stone', stone =>
            getComputedStyle(stone).animationName), 'display-game-stone-place');
        await page.waitForFunction(() => !document.querySelector('[data-coordinate="C3"]').classList.contains('is-placing'));
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameDelta', gameId: 'g1', revision: 3, actor: 'AI', coordinate: 'D3',
            turn: 'User', result: '进行中'
        }));
        assert.equal(await page.$eval('[data-coordinate="D3"]', button => button.dataset.stone), 'O');
        assert.equal(await page.$eval('[data-coordinate="D3"]', button => button.classList.contains('is-placing')), false);
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameDelta', gameId: 'g1', revision: 5, actor: 'AI', coordinate: 'E3',
            turn: 'User', result: '进行中'
        }));
        assert.equal(await page.evaluate(() => window.__sent.at(-1).type), 'gameRecover');
        await page.evaluate(() => document.getElementById('displayGameToggle').click());
        assert.equal(await page.$eval('#displayGameMenu', menu => menu.hidden), false);
        await page.evaluate(source => {
            const runTimer = new Function('window', `
                let voiceConversationTimer = null;
                let voiceListeningEnabled = true;
                let voiceConversationTimerPaused = false;
                let voiceConversationState = 'activeGroup';
                let voiceConversationExpiresAt = Date.now() - 1;
                let voiceConversationRemainingMs = null;
                function clearVoiceConversationTimer() { clearTimeout(voiceConversationTimer); }
                function clearVoiceConversationCountdown() {}
                function updateVoiceStatusDisplay() {}
                ${source}
                scheduleVoiceConversationTimer();
            `);
            runTimer(window);
        }, timerSource);
        await page.waitForFunction(() => document.getElementById('displayGameLayer').hidden);
        assert.deepEqual(await page.evaluate(() => window.__stageMessages.at(-1)), {
            type: 'voiceConversationState', state: 'waitingWake', reason: 'localTimeout'
        });
        assert.equal(await page.$eval('#displayGameMenu', menu => menu.hidden), true);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'voiceConversationState', state: 'activeGroup'
        }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), false,
            '服务端恢复活动对话后应重新显示棋盘');
        await page.evaluate(() => window.__emit('server.message', {
            type: 'voiceConversationState', state: 'waitingWake'
        }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), true);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'voiceConversationState', state: 'activePrivate'
        }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), false);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameSnapshot', gameId: 'g1', revision: 3, size: 9,
            board: Array(9).fill('.........').join('/'), turn: 'User', result: '进行中', visible: false
        }));
        assert.equal(await page.$eval('#displayGameShell', shell => shell.hidden), true);
        assert.equal(await page.$eval('#displayGameToggle', button => button.textContent), '五子棋');
        await page.click('#displayGameToggle');
        assert.match(await page.$eval('.display-game-list-status', status => status.textContent), /已隐藏/);
        await page.click('[data-game-name="五子棋"]');
        assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)),
            { type: 'gameView', visible: true, revision: 3 });
        assert.equal(await page.$eval('#displayGameMenu', menu => menu.hidden), true);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameVisibility', gameId: 'g1', revision: 4, visible: true
        }));
        assert.equal(await page.$eval('#displayGameShell', shell => shell.hidden), false);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'voiceConversationState', state: 'disabled'
        }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), true);
        assert.equal(await page.$eval('#displayGameToggle', button => button.textContent), '游戏');
        await page.evaluate(() => window.__emit('stage.resize', {
            width: 740, height: 390, rotation: 90
        }));
        assert.match(await page.$eval('#displayGameLayer', layer => layer.style.transform), /rotate\(90deg\)/);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameSnapshot', gameId: 'demo-1', revision: 1, size: 9,
            board: Array(9).fill('.........').join('/'), turn: 'User', result: '进行中',
            visible: true, demo: true
        }));
        assert.equal(await page.$eval('[data-coordinate="C3"]', button => button.disabled), true);
        assert.equal(await page.$$eval('.display-game-point.is-placing', list => list.length), 0);
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), false,
            '演示棋盘在对话未激活时仍可显示');
        assert.match(await page.$eval('#displayGameStatus', node => node.textContent), /演示/);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameDelta', gameId: 'demo-1', revision: 2, actor: 'User', coordinate: 'C3',
            turn: 'AI', result: '进行中'
        }));
        assert.equal(await page.$eval('[data-coordinate="C3"]', button => button.classList.contains('is-placing')), true);
        const sentBeforeClose = await page.evaluate(() => window.__sent.length);
        await page.click('#displayGameClose');
        assert.equal(await page.evaluate(() => window.__sent.length), sentBeforeClose);
        await page.evaluate(() => window.__emit('server.message', { type: 'gameDemoEnd', gameId: 'demo-1' }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), true);
        assert.equal(await page.$eval('#displayGameToggle', button => button.textContent), '游戏');
    } finally {
        await browser.close();
    }
});
