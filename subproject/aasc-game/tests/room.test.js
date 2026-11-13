const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, readdirSync } = require('node:fs');
const { tmpdir, homedir } = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const cache = path.join(homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json/20240303');
let jsonJar;
try { jsonJar = path.join(cache, readdirSync(cache)[0], 'json-20240303.jar'); } catch (_) { }
test('房间服务分发网页、校验棋步并恢复重连', { skip: !jsonJar && '需要 Gradle 缓存中的 org.json JVM 测试库', timeout: 30000 }, async t => {
    const output = mkdtempSync(path.join(tmpdir(), 'aasc-game-test-'));
    const sources = ['RoomServer.java', 'NativeRoom.java', 'GomokuRoomServer.java'].map(file => `app/src/main/java/com/aasc/game/${file}`);
    const fixtures = ['android/content/SharedPreferences.java', 'android/content/Context.java', 'android/content/res/AssetManager.java', 'android/util/Log.java', 'com/aasc/game/TestServer.java'].map(file => `tests/fixtures/${file}`);
    execFileSync('javac', ['-cp', jsonJar, '-d', output, ...sources, ...fixtures]);
    const process = spawn('java', ['-cp', `${output}:${jsonJar}`, 'com.aasc.game.TestServer'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = readline.createInterface({ input: process.stdout });
    const [line] = await new Promise((resolve, reject) => { lines.once('line', value => resolve([value])); process.once('exit', () => reject(new Error('服务启动失败'))); });
    let [port, key] = line.split(' ');
    const clients = [];
    const connect = async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`); const messages = []; const waiters = [];
        ws.onmessage = event => { const message = JSON.parse(event.data); const waiter = waiters.shift(); if (waiter) waiter(message); else messages.push(message); };
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        clients.push(ws);
        return { ws, next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)), send: (topic, payload = {}) => ws.send(JSON.stringify({ type: 'command', topic, payload })) };
    };
    try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(response.status, 200); assert.match(await response.text(), /AASC 游戏/);
        const host = await connect(), guest = await connect(), invalid = await connect();
        invalid.send('game.join', { token: 'invalid-1234567890123', name: '测试', gameId: 'other', protocolVersion: 1 });
        assert.equal((await invalid.next()).topic, 'game.error');
        invalid.send('game.join', { token: 'invalid-1234567890123', name: '测试', gameId: 'gomoku', protocolVersion: 'bad' });
        assert.equal((await invalid.next()).topic, 'game.error');
        invalid.ws.close();
        host.send('game.join', { token: 'host-1234567890123456', name: '房主', hostKey: key });
        const initial = (await host.next()).payload;
        assert.equal(initial.seat, 0); assert.equal(initial.gameId, 'gomoku'); assert.equal(initial.protocolVersion, 1);
        guest.send('game.join', { token: 'guest-123456789012345', name: '玩家' });
        await host.next(); assert.equal((await guest.next()).payload.seat, 1);
        host.send('game.config', { size: 9 }); await host.next(); assert.equal((await guest.next()).payload.size, 9);
        host.send('game.start'); let current = (await host.next()).payload; await guest.next();
        guest.send('game.move', { x: 0, y: 0, revision: current.revision }); assert.equal((await guest.next()).topic, 'game.error');
        for (let i = 0; i < 9; i++) {
            const player = i % 2 ? guest : host; const x = Math.floor(i / 2), y = i % 2;
            player.send('game.move', { x, y, revision: current.revision });
            current = (await host.next()).payload; await guest.next();
        }
        assert.equal(current.result, 'black'); assert.equal(current.board[4], 1);
        guest.ws.close(); await host.next();
        const rejoined = await connect();
        rejoined.send('game.join', { token: 'guest-123456789012345', name: '玩家' });
        await host.next(); assert.equal((await rejoined.next()).payload.result, 'black');

        // 用真实 Chromium 加载房主分发的页面，检查网页连接、状态和邀请二维码。
        host.ws.close(); rejoined.ws.close();
        await new Promise(resolve => setTimeout(resolve, 300));
        let puppeteer;
        try { puppeteer = require('puppeteer-core'); } catch (_) { t.diagnostic('未安装 puppeteer-core，跳过 Chromium 页面验证'); }
        if (puppeteer) {
            const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
            try {
                const page = await browser.newPage();
                await page.evaluateOnNewDocument(() => { localStorage.setItem('aasc-game-token', 'host-1234567890123456'); localStorage.setItem('aasc-game-name', '房主'); });
                await page.goto(`http://127.0.0.1:${port}/?host=${key}&address=192.168.1.2:${port}`);
                await page.waitForFunction(() => document.querySelector('#state').textContent.includes('黑棋获胜'));
                assert.match(await page.$eval('#players', node => node.textContent), /房主/);
                await page.waitForFunction(() => document.querySelector('#qr').width === 180);
                const image = await page.$eval('#qr', node => Array.from(node.getContext('2d').getImageData(0, 0, 180, 180).data));
                assert.equal(require('jsqr')(Uint8ClampedArray.from(image), 180, 180).data, `http://192.168.1.2:${port}/`);
                const context = await browser.createBrowserContext();
                const guestPage = await context.newPage();
                await guestPage.evaluateOnNewDocument(() => { localStorage.setItem('aasc-game-token', 'guest-123456789012345'); localStorage.setItem('aasc-game-name', '玩家'); });
                await guestPage.goto(`http://127.0.0.1:${port}/`);
                await guestPage.waitForFunction(() => document.querySelector('#state').textContent.includes('黑棋获胜'));
                await guestPage.click('#otherRoom');
                const qrFile = path.join(output, 'invite.png');
                await require('qrcode').toFile(qrFile, `http://127.0.0.1:${port}/`);
                const navigation = guestPage.waitForNavigation();
                await (await guestPage.$('#image')).uploadFile(qrFile);
                await navigation;
                await guestPage.waitForFunction(() => document.querySelector('#state').textContent.includes('黑棋获胜'));
                await context.close();
            } finally { await browser.close(); }
        }
        const restarted = new Promise(resolve => lines.once('line', resolve));
        process.stdin.write('r');
        [port, key] = (await restarted).split(' ');
        const recovered = await connect();
        recovered.send('game.join', { token: 'host-1234567890123456', name: '房主', hostKey: key });
        const saved = (await recovered.next()).payload;
        assert.equal(saved.result, 'black'); assert.equal(saved.board[4], 1); assert.equal(saved.size, 9);
    } finally { for (const ws of clients) ws.close(); process.stdin.end(); }
});
