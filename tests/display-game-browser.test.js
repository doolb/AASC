const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium',
    '/usr/bin/google-chrome'].find(candidate => candidate && fs.existsSync(candidate));

test('显示端五子棋首连快照、点击增量和版本缺口恢复', { skip: !CHROME }, async () => {
    const $ = cheerio.load(fs.readFileSync(path.join(PUBLIC, 'display.html'), 'utf8'));
    const markup = $('#displayGameLayer').toString();
    const style = fs.readFileSync(path.join(PUBLIC, 'css/display-game.css'), 'utf8');
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 740 });
        await page.setContent(`<style>:root{--display-stage-width:390px;--display-stage-height:740px}</style><style>${style}</style>${markup}`);
        await page.evaluate(() => {
            const subscriptions = new Map();
            window.__sent = [];
            window.__emit = (type, data) => (subscriptions.get(type) || []).forEach(handler => handler(data));
            window.DisplayStage = {
                getBus: () => ({ subscribe(type, handler) {
                    const list = subscriptions.get(type) || [];
                    list.push(handler);
                    subscriptions.set(type, list);
                } }),
                send(message) { window.__sent.push(message); return true; },
                getState: () => ({ rotationGeometry: { logicalWidth: 390, logicalHeight: 740, rotation: 0 } })
            };
        });
        await page.addScriptTag({ path: path.join(PUBLIC, 'js/display-game.js') });
        await page.evaluate(() => window.dispatchEvent(new Event('display-stage-ready')));
        assert.equal(await page.evaluate(() => window.__sent[0].type), 'gameRecover');
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
        assert.equal(await page.$eval('#displayGameReopen', button => button.hidden), false);
        await page.evaluate(() => window.__emit('server.message', {
            type: 'voiceConversationState', state: 'disabled'
        }));
        assert.equal(await page.$eval('#displayGameLayer', layer => layer.hidden), true);
        assert.equal(await page.$eval('#displayGameReopen', button => button.hidden), true);
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
    } finally {
        await browser.close();
    }
});
