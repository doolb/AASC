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

test('四种尺寸和真实四向旋转下标尺对齐、点击坐标准确', { skip: !CHROME, timeout: 60000 }, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8'));
    // 复用页面实际样式清单，避免缺少面板样式导致隐藏的设置区域盖住棋盘。
    const styles = $('link[rel="stylesheet"]').toArray()
        .map(node => fs.readFileSync(path.join(PUBLIC, $(node).attr('href')), 'utf8')).join('\n');
    $('script, link[rel="stylesheet"]').remove();
    $('head').append(`<style>${styles}</style>`);
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 320, height: 640 });
        await page.setContent($.html());
        for (const name of ['display-chat', 'display-stage', 'display-game']) {
            await page.addScriptTag({ path: path.join(PUBLIC, `js/${name}.js`) });
        }
        await page.evaluate(() => {
            window.sent = [];
            window.DisplayStage.setTransport(message => { window.sent.push(message); return true; });
            window.DisplayGame.init();
            const recovery = window.sent.findLast(message => message.type === 'gameRecover');
            window.DisplayStage.handleServerMessage({ type: 'gameRecoverResult', requestId: recovery.requestId,
                snapshot: null, pendingRequestId: null });
            window.DisplayStage.handleServerMessage({ type: 'voiceConversationState', state: 'activePrivate' });
        });
        for (const viewport of [{ width: 320, height: 640 }, { width: 740, height: 390 }]) {
            await page.setViewport(viewport);
            for (const size of [9, 11, 13, 15]) {
                for (const angle of [0, 90, 180, 270]) {
                    const label = `${viewport.width}×${viewport.height}/${size}路/${angle}°`;
                    const gameId = `axes-${viewport.width}-${size}-${angle}`;
                    const layout = await page.evaluate(({ size, angle, gameId }) => {
                        // 正式舞台从页面当前旋转值计算几何，必须同时设置它才能测试实际角度。
                        window.currentRotation = angle;
                        window.DisplayStage.setRotation(angle);
                        window.DisplayStage.handleServerMessage({ type: 'gameSnapshot', gameId, revision: 3, size,
                            board: ['XO' + '.'.repeat(size - 2), ...Array(size - 1).fill('.'.repeat(size))].join('/'),
                            turn: 'User', result: '进行中', visible: true });
                        const board = document.getElementById('displayGameBoard');
                        const bounds = board.getBoundingClientRect();
                        const center = node => {
                            const rect = node.getBoundingClientRect();
                            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                        };
                        const cosine = Math.cos(angle * Math.PI / 180);
                        const sine = Math.sin(angle * Math.PI / 180);
                        const violations = [];
                        for (const axis of ['column', 'row']) {
                            [...board.querySelectorAll(`[data-axis="${axis}"]`)].forEach((node, index) => {
                                const coordinate = axis === 'column' ? `${String.fromCharCode(65 + index)}1` : `A${index + 1}`;
                                const point = board.querySelector(`[data-coordinate="${coordinate}"]`);
                                const a = center(node);
                                const p = center(point);
                                // 将屏幕差向量转回棋盘逻辑方向，逐个检查标签对齐且位于对应上侧/左侧。
                                const dx = cosine * (a.x - p.x) + sine * (a.y - p.y);
                                const dy = -sine * (a.x - p.x) + cosine * (a.y - p.y);
                                const aligned = axis === 'column' ? Math.abs(dx) < 0.6 && dy < 0 : Math.abs(dy) < 0.6 && dx < 0;
                                const rect = node.getBoundingClientRect();
                                const contained = rect.left >= bounds.left && rect.right <= bounds.right + 0.6
                                    && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 0.6;
                                if (!aligned || !contained) violations.push({ axis, index, dx, dy, contained });
                            });
                        }
                        return {
                            rotation: window.DisplayStage.getState().rotation,
                            columns: [...board.querySelectorAll('[data-axis="column"]')].map(node => node.textContent),
                            rows: [...board.querySelectorAll('[data-axis="row"]')].map(node => node.textContent),
                            points: board.querySelectorAll('.display-game-point').length,
                            labelsInert: [...board.querySelectorAll('.display-game-axis')].every(node =>
                                node.getAttribute('aria-hidden') === 'true' && getComputedStyle(node).pointerEvents === 'none'),
                            firstLabel: center(board.querySelector('[data-axis="column"]')), violations
                        };
                    }, { size, angle, gameId });
                    assert.equal(layout.rotation, angle, label);
                    assert.deepEqual(layout.columns, Array.from({ length: size }, (_, index) => String.fromCharCode(65 + index)), label);
                    assert.deepEqual(layout.rows, Array.from({ length: size }, (_, index) => String(index + 1)), label);
                    assert.equal(layout.columns[8], 'I', label);
                    assert.equal(layout.points, size * size, label);
                    assert.equal(layout.labelsInert, true, label);
                    assert.deepEqual(layout.violations, [], label);
                    const before = await page.evaluate(() => window.sent.filter(message => message.type === 'gameMove').length);
                    await page.mouse.click(layout.firstLabel.x, layout.firstLabel.y);
                    assert.equal(await page.evaluate(() => window.sent.filter(message => message.type === 'gameMove').length), before, label);
                    // 底部语音控件保有原交互优先级，选取未被工具栏覆盖的空位核对旋转后的落子坐标。
                    const coordinate = 'C3';
                    await page.click(`[data-coordinate="${coordinate}"]`);
                    const move = await page.evaluate(() => window.sent.findLast(message => message.type === 'gameMove'));
                    const after = await page.evaluate(() => window.sent.filter(message => message.type === 'gameMove').length);
                    assert.equal(after, before + 1, `${label} 应发送落子；${JSON.stringify(await page.$eval(`[data-coordinate="${coordinate}"]`, point => {
                        const rect = point.getBoundingClientRect();
                        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                        return { disabled: point.disabled, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                            hit: hit?.id || hit?.className, status: document.getElementById('displayGameStatus').textContent };
                    }))}`);
                    assert.equal(move.coordinate, coordinate, label);
                    assert.equal(move.gameId, gameId, label);
                    assert.equal(move.revision, 3, label);
                    await page.evaluate(({ move, coordinate, gameId }) => {
                        window.DisplayStage.handleServerMessage({ type: 'gameDelta', gameId, revision: 4,
                            actor: 'User', coordinate, turn: 'AI', result: '进行中' });
                        window.DisplayStage.handleServerMessage({ type: 'gameMoveResult', requestId: move.requestId,
                            status: 'complete', gameId, revision: 4 });
                    }, { move, coordinate, gameId });
                    assert.equal(await page.$$eval('.display-game-axis', nodes => nodes.length), size * 2, label);
                }
            }
        }
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

test('无效真实点击显示单条飘字，松手或解锁后不补执行，触屏与旋转保持可见', {
    skip: !CHROME, timeout: 30000
}, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8'));
    const styles = $('link[rel="stylesheet"]').toArray()
        .map(node => fs.readFileSync(path.join(PUBLIC, $(node).attr('href')), 'utf8')).join('\n');
    $('script, link[rel="stylesheet"]').remove();
    $('head').append(`<style>${styles}</style>`);
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 390, height: 740, hasTouch: true });
        await page.setContent($.html());
        for (const name of ['display-chat', 'display-stage', 'display-game']) {
            await page.addScriptTag({ path: path.join(PUBLIC, `js/${name}.js`) });
        }
        await page.evaluate(() => {
            window.sent = [];
            DisplayStage.setTransport(message => { sent.push(message); return true; });
            DisplayGame.init();
            const recovery = sent.findLast(message => message.type === 'gameRecover');
            DisplayStage.handleServerMessage({ type: 'gameRecoverResult', requestId: recovery.requestId,
                pendingRequestId: null, snapshot: null });
            DisplayStage.handleServerMessage({ type: 'voiceConversationState', state: 'activePrivate' });
        });
        const board = ['X........', ...Array(8).fill('.........')].join('/');
        const snapshot = (turn = 'User', revision = 1, extra = {}) => ({ type: 'gameSnapshot',
            gameId: 'hint', size: 9, board, revision, turn, result: '进行中', visible: true, ...extra });
        const deliver = message => page.evaluate(message => DisplayStage.handleServerMessage(message), message);
        const moves = () => page.evaluate(() => sent.filter(message => message.type === 'gameMove'));
        const hint = () => page.$eval('.display-game-move-hint', node => ({ text: node.textContent, hidden: node.hidden }));
        await deliver(snapshot());
        // 真触屏会点击disabled按钮；不能仅用dispatchEvent模拟普通click验证。
        await page.tap('[data-coordinate="A1"]');
        assert.deepEqual(await hint(), { text: '这里已有棋子', hidden: false });
        for (let index = 0; index < 8; index += 1) await page.tap('[data-coordinate="A1"]');
        assert.equal(await page.$$eval('.display-game-move-hint', nodes => nodes.length), 1);
        assert.equal(await page.$eval('.display-game-move-hint', node => node.getAnimations().length), 1);
        assert.equal((await moves()).length, 0);
        await page.waitForFunction(() => document.querySelector('.display-game-move-hint').hidden, { timeout: 3000 });

        await deliver(snapshot('AI'));
        await page.click('[data-coordinate="C3"]');
        assert.deepEqual(await hint(), { text: 'AI正在落子', hidden: false });
        const center = await page.$eval('[data-coordinate="C3"]', node => {
            const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        // 增量不重建交点：按下无效，松手前刚好轮到玩家，也不能把原手势当新落子。
        await deliver({ type: 'gameDelta', gameId: 'hint', revision: 2, actor: 'AI', coordinate: 'D3',
            turn: 'User', result: '进行中' });
        await page.mouse.up();
        assert.equal((await moves()).length, 0);
        assert.equal((await hint()).hidden, true);
        await page.click('[data-coordinate="C3"]');
        const move = (await moves())[0];
        assert.equal(move.coordinate, 'C3');
        for (let index = 0; index < 8; index += 1) await page.click('[data-coordinate="E3"]');
        assert.deepEqual(await hint(), { text: '正在处理上一手', hidden: false });
        assert.equal((await moves()).length, 1);
        await deliver({ type: 'gameDelta', gameId: 'hint', revision: 3, actor: 'User', coordinate: 'C3',
            turn: 'AI', result: '进行中' });
        await deliver({ type: 'gameDelta', gameId: 'hint', revision: 4, actor: 'AI', coordinate: 'F3',
            turn: 'User', result: '进行中' });
        await deliver({ type: 'gameMoveResult', requestId: move.requestId, status: 'complete', gameId: 'hint', revision: 4 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal((await moves()).length, 1, '解锁不得补发之前点过的E3');
        assert.equal(await page.$eval('[data-coordinate="E3"]', node => node.dataset.stone), '.');
        assert.equal((await hint()).hidden, true);
        await page.click('[data-coordinate="E3"]');
        const second = (await moves())[1];
        await deliver({ type: 'gameError', requestId: move.requestId, code: '旧错误' });
        assert.equal((await hint()).hidden, true, '旧请求不能污染当前提示');
        await deliver({ type: 'gameError', requestId: second.requestId, code: '位置已占用' });
        assert.deepEqual(await hint(), { text: '位置已占用', hidden: false });

        await page.evaluate(() => DisplayStage.setTransport(null));
        await page.click('[data-coordinate="E3"]');
        assert.deepEqual(await hint(), { text: '连接已断开', hidden: false });
        await page.evaluate(() => DisplayStage.setTransport(message => { sent.push(message); return true; }));
        await page.click('[data-coordinate="E3"]');
        assert.deepEqual(await hint(), { text: '正在同步棋盘', hidden: false });
        const recovery = await page.evaluate(() => sent.findLast(message => message.type === 'gameRecover'));
        await deliver({ type: 'gameRecoverResult', requestId: recovery.requestId, pendingRequestId: null, snapshot: snapshot('User', 4) });
        await deliver(snapshot('User', 5, { result: 'User胜' }));
        await page.click('[data-coordinate="C3"]');
        assert.deepEqual(await hint(), { text: '棋局已结束', hidden: false });

        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        for (const viewport of [{ width: 320, height: 640 }, { width: 740, height: 390 }]) {
            await page.setViewport({ ...viewport, hasTouch: true });
            for (const angle of [0, 90, 180, 270]) {
                await page.evaluate(angle => { window.currentRotation = angle; DisplayStage.setRotation(angle); }, angle);
                await deliver(snapshot('AI', 6));
                await page.tap('[data-coordinate="C3"]');
                const layout = await page.$eval('.display-game-move-hint', node => {
                    const rect = node.getBoundingClientRect();
                    return { hidden: node.hidden, text: node.textContent, animation: getComputedStyle(node).animationName,
                        transparent: getComputedStyle(node).pointerEvents === 'none',
                        fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight };
                });
                assert.deepEqual(layout, { hidden: false, text: 'AI正在落子', animation: 'none', transparent: true, fits: true },
                    `${viewport.width}×${viewport.height}/${angle}°`);
            }
        }
        assert.equal((await moves()).length, 2);
        await deliver({ type: 'voiceConversationState', state: 'waitingWake' });
        assert.equal((await hint()).hidden, true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

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
            type: 'gameRecoverResult', requestId: window.__sent.at(-1).requestId,
            pendingRequestId: null, snapshot: {
                type: 'gameSnapshot', gameId: 'g1', revision: 1, size: 9,
                board: Array(9).fill('.........').join('/'), turn: 'User', result: '进行中', visible: true
            }
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
        assert.equal(move.gameId, 'g1');
        assert.match(move.requestId, /^game-\d+-\d+$/);
        await page.evaluate(() => {
            const click = () => document.querySelector('[data-coordinate="E3"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            for (let index = 0; index < 20; index += 1) click();
            window.__emit('server.message', { type: 'gameSnapshot', gameId: 'g1', revision: 1,
                size: 9, board: Array(9).fill('.........').join('/'),
                turn: 'User', result: '进行中', visible: true });
            window.__emit('server.message', { type: 'gameError', requestId: 'old-move', code: '版本过期' });
            window.__emit('server.message', { type: 'gameError', code: '无关显隐错误' });
            click();
        });
        assert.equal(await page.evaluate(() => window.__sent.filter(item => item.type === 'gameMove').length), 1,
            '快速连点、同版本快照和无关错误都不能释放在途棋步');
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameDelta', gameId: 'g1', revision: 2, actor: 'User', coordinate: 'C3',
            turn: 'AI', result: '进行中'
        }));
        assert.equal(await page.$eval('[data-coordinate="C3"]', button => button.dataset.stone), 'X');
        const beforeAiTurnClick = await page.evaluate(() => window.__sent.length);
        await page.evaluate(() => document.querySelector('[data-coordinate="E3"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.evaluate(() => window.__sent.length), beforeAiTurnClick);
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
        assert.equal(await page.$eval('[data-coordinate="E3"]', button => button.disabled), true,
            'AI 棋子出现后仍需等该轮聊天处理完成');
        await page.evaluate(() => {
            window.__emit('server.message', { type: 'gameSnapshot', gameId: 'g1', revision: 1,
                size: 9, board: Array(9).fill('.........').join('/'),
                turn: 'User', result: '进行中', visible: true });
            window.__emit('transport.changed', { available: false });
            window.__emit('transport.changed', { available: true });
            const recovery = window.__sent.at(-1);
            window.__emit('server.message', { type: 'gameRecoverResult', requestId: 'old-recovery',
                snapshot: null, pendingRequestId: null });
            window.__emit('server.message', { type: 'gameRecoverResult', requestId: recovery.requestId,
                pendingRequestId: window.__sent.find(item => item.type === 'gameMove').requestId,
                snapshot: { type: 'gameSnapshot', gameId: 'g1', revision: 3, size: 9,
                    board: ['.........', '.........', '..XO.....', ...Array(6).fill('.........')].join('/'),
                    turn: 'User', result: '进行中', visible: true } });
        });
        assert.equal(await page.$eval('[data-coordinate="C3"]', button => button.dataset.stone), 'X',
            '迟到快照不能回滚棋子');
        assert.equal(await page.$eval('[data-coordinate="E3"]', button => button.disabled), true,
            '重连应恢复服务端仍在处理的请求锁');
        await page.evaluate(requestId => window.__emit('server.message', {
            type: 'gameMoveResult', requestId, status: 'complete', gameId: 'g1', revision: 3
        }), move.requestId);
        assert.equal(await page.$eval('[data-coordinate="E3"]', button => button.disabled), false);
        const movesBeforeGuards = await page.evaluate(() => window.__sent.length);
        await page.evaluate(() => {
            document.querySelector('[data-coordinate="C3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            window.__transportAvailable = false;
            document.querySelector('[data-coordinate="E3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            window.__transportAvailable = true;
        });
        assert.equal(await page.evaluate(() => window.__sent.length), movesBeforeGuards,
            '占用格不发送，连接发送失败不追加消息');
        assert.equal(await page.$eval('[data-coordinate="E3"]', button => button.disabled), false,
            '发送失败后释放本次锁');
        await page.click('[data-coordinate="E3"]');
        const secondMove = await page.evaluate(() => window.__sent.at(-1));
        assert.notEqual(secondMove.requestId, move.requestId);
        await page.evaluate(requestId => window.__emit('server.message', {
            type: 'gameMoveResult', requestId, status: 'complete', gameId: 'g1', revision: 3
        }), move.requestId);
        assert.equal(await page.$eval('[data-coordinate="F3"]', button => button.disabled), true,
            '上一棋步迟到的完成回包不能解除下一棋步锁');
        await page.evaluate(requestId => window.__emit('server.message', {
            type: 'gameError', requestId, code: '位置已占用'
        }), secondMove.requestId);
        assert.equal(await page.$eval('[data-coordinate="F3"]', button => button.disabled), false,
            '当前请求的拒绝回包应释放本次锁');
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'gameDelta', gameId: 'g1', revision: 5, actor: 'AI', coordinate: 'E3',
            turn: 'User', result: '进行中'
        }));
        assert.equal(await page.evaluate(() => window.__sent.at(-1).type), 'gameRecover');
        assert.equal(await page.$eval('[data-coordinate="E3"]', button => button.disabled), true,
            '同步缺口时禁止点击');
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
            type: 'gameRecoverResult', requestId: window.__sent.at(-1).requestId,
            pendingRequestId: null, snapshot: {
                type: 'gameSnapshot', gameId: 'g1', revision: 3, size: 9,
                board: Array(9).fill('.........').join('/'), turn: 'User', result: '进行中', visible: false
            }
        }));
        assert.equal(await page.$eval('#displayGameShell', shell => shell.hidden), true);
        const movesBeforeHidden = await page.evaluate(() => window.__sent.length);
        await page.evaluate(() => document.querySelector('[data-coordinate="E3"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.evaluate(() => window.__sent.length), movesBeforeHidden,
            '隐藏棋盘即使收到合成点击也不发送');
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
        const beforeInactiveClick = await page.evaluate(() => window.__sent.length);
        await page.evaluate(() => document.querySelector('[data-coordinate="E3"]')
            .dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await page.evaluate(() => window.__sent.length), beforeInactiveClick,
            '非活动对话不发送棋步');
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

test('清空关闭棋盘与恢复入口，迟到旧局快照不复活，新局不受旧清除事件影响', {skip:!CHROME}, async t => {
    const $=cheerio.load(fs.readFileSync(path.join(PUBLIC,'display.html'),'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
    t.after(()=>browser.close());const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.setContent($.html());
    for(const name of ['display-stage','display-game'])await page.addScriptTag({path:path.join(PUBLIC,`js/${name}.js`)});
    await page.evaluate(()=>{
        window.sent=[];DisplayStage.setTransport(message=>{sent.push(message);return true});DisplayGame.init();
        const recovery=sent.findLast(m=>m.type==='gameRecover');
        DisplayStage.handleServerMessage({type:'gameRecoverResult',requestId:recovery.requestId,snapshot:null});
        DisplayStage.handleServerMessage({type:'voiceConversationState',state:'activeGroup'});
        window.snapshot={type:'gameSnapshot',game:'五子棋',gameId:'old',revision:1,size:9,
            board:Array(9).fill('.........').join('/'),turn:'User',result:'进行中',visible:true};
        DisplayStage.handleServerMessage(snapshot);
    });
    assert.equal(await page.$eval('#displayGameShell',n=>n.hidden),false);
    await page.evaluate(()=>DisplayStage.handleServerMessage({type:'gameCleared',gameId:'old',revision:2}));
    assert.equal(await page.$eval('#displayGameShell',n=>n.hidden),true);
    assert.equal(await page.$eval('#displayGameToggle',n=>n.textContent),'游戏');
    assert.equal(await page.$eval('.display-game-list-status',n=>n.textContent),'未开局');
    await page.evaluate(()=>DisplayStage.handleServerMessage({...snapshot,revision:99}));
    assert.equal(await page.$eval('#displayGameShell',n=>n.hidden),true);
    await page.evaluate(()=>{
        DisplayStage.handleServerMessage({...snapshot,gameId:'new'});
        DisplayStage.handleServerMessage({type:'gameCleared',gameId:'old',revision:3});
    });
    assert.equal(await page.$eval('#displayGameShell',n=>n.hidden),false);
    assert.equal(await page.$eval('#displayGameToggle',n=>n.textContent),'五子棋');
    assert.deepEqual(errors,[]);
});
