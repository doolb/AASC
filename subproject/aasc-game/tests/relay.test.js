const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelay } = require('../server/relay');
const { WebSocket } = require('ws');

async function listen(t, options) {
    const relay = createRelay(options);
    await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
    t.after(() => { for (const client of relay.wss.clients) client.terminate(); relay.server.close(); });
    return `http://127.0.0.1:${relay.server.address().port}`;
}

test('测试模块验证三人游戏、协议版本、动作和座位隔离', { timeout: 10000 }, async t => {
    const { games } = require('../games/catalog');
    const fixture = require('./fixtures/test-game');
    const url = await listen(t, { games: { ...games, [fixture.game.id]: fixture.game } });
    const host = await connect(url), first = await connect(url), second = await connect(url), invalid = await connect(url);
    const room = '1'.repeat(32), key = '2'.repeat(32);
    send(invalid, 'relay.host', { room: '3'.repeat(32), key, gameId: 'unknown', protocolVersion: 1 });
    assert.equal((await receive(invalid)).topic, 'game.error');
    send(host, 'relay.host', { room, key, gameId: fixture.game.id, protocolVersion: 2 });
    assert.equal((await receive(host)).payload.gameId, fixture.game.id); await receive(host);
    send(invalid, 'relay.join', { room, token: '4'.repeat(32), name: '错误版本', gameId: fixture.game.id, protocolVersion: 1 });
    assert.equal((await receive(invalid)).topic, 'game.error');
    send(invalid, 'relay.join', { room, token: '4'.repeat(32), name: '旧客户端' });
    assert.equal((await receive(invalid)).topic, 'game.error');
    send(first, 'relay.join', { room, token: '5'.repeat(32), name: '甲', gameId: fixture.game.id, protocolVersion: 2 });
    assert.equal((await receive(first)).payload.seat, 1); await receive(host);
    send(second, 'relay.join', { room, token: '6'.repeat(32), name: '乙', gameId: fixture.game.id, protocolVersion: 2 });
    assert.equal((await receive(second)).payload.seat, 2); assert.equal((await receive(host)).payload.players.length, 3);
    send(invalid, 'relay.join', { room, token: '4'.repeat(32), name: '超员', gameId: fixture.game.id, protocolVersion: 2 });
    assert.equal((await receive(invalid)).topic, 'game.error');
    send(second, 'relay.action', { topic: 'game.move', payload: {} }); assert.equal((await receive(second)).topic, 'game.error');
    send(second, 'relay.action', { topic: 'game.pulse', payload: {} });
    const action = (await receive(host)).payload;
    assert.equal(action.seat, 2); assert.equal(action.gameId, fixture.game.id);
    const state = fixture.apply({ revision: 0 }, action.seat, action.topic);
    send(host, 'relay.snapshot', { state });
    assert.equal((await receive(host)).payload.lastSeat, 2);
    assert.equal((await receive(first)).payload.seat, 1);
    assert.equal((await receive(second)).payload.seat, 2);
    send(host, 'relay.error', { seat: 2, message: '只发给乙' });
    assert.equal((await receive(second)).payload.message, '只发给乙');
    assert.equal(first.messages.length, 0);
});
async function connect(url) {
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/relay');
    socket.messages = []; socket.waiters = [];
    socket.on('message', data => { const value = JSON.parse(data); const waiter = socket.waiters.shift(); if (waiter) waiter(value); else socket.messages.push(value); });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return socket;
}
function receive(socket) { return socket.messages.length ? Promise.resolve(socket.messages.shift()) : new Promise(resolve => socket.waiters.push(resolve)); }
function send(socket, topic, payload) { socket.send(JSON.stringify({ type: 'command', topic, payload })); }

test('中转绑定房主身份，拒绝伪造快照并隔离房间', { timeout: 10000 }, async t => {
    const url = await listen(t), host = await connect(url), attacker = await connect(url), guest = await connect(url);
    const room = 'a'.repeat(32), key = 'b'.repeat(32), token = 'c'.repeat(32);
    send(host, 'relay.host', { room, key }); assert.equal((await receive(host)).topic, 'relay.ready'); await receive(host);
    send(attacker, 'relay.host', { room, key: 'd'.repeat(32) }); assert.equal((await receive(attacker)).topic, 'game.error');
    send(guest, 'relay.join', { room, token, name: '玩家' }); assert.equal((await receive(guest)).topic, 'relay.ready'); await receive(host);
    send(guest, 'relay.snapshot', { state: {} }); assert.equal((await receive(guest)).topic, 'game.error');
    const otherHost = await connect(url);
    send(otherHost, 'relay.host', { room: 'e'.repeat(32), key: 'f'.repeat(32) });
    await receive(otherHost); await receive(otherHost);
    send(guest, 'relay.action', { topic: 'game.move', payload: { x: 1, y: 2, revision: 1 } });
    assert.equal((await receive(host)).topic, 'relay.action');
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(otherHost.messages.length, 0);
    send(host, 'relay.snapshot', { state: { revision: 1 } });
    assert.equal((await receive(host)).payload.seat, 0); assert.equal((await receive(guest)).payload.seat, 1);
    const paused = receive(guest); host.close(); assert.equal((await paused).topic, 'relay.paused');
});

test('真实网页创建房间并由房主本地处理棋局', { timeout: 30000 }, async t => {
    let puppeteer;
    try { puppeteer = require('puppeteer-core'); } catch (_) { t.skip('需要 puppeteer-core'); return; }
    const url = await listen(t);
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const hostContext = await browser.createBrowserContext(), guestContext = await browser.createBrowserContext();
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    for (const page of [host, guest]) page.on('dialog', dialog => dialog.accept('玩家'));
    await host.goto(url); await host.click('#relayHost');
    await host.waitForFunction(() => document.querySelector('#roomAddress').textContent.includes('room='));
    const invite = await host.$eval('#roomAddress', node => node.textContent);
    assert.ok(!invite.includes('host='));
    assert.equal(new URL(invite).searchParams.get('game'), 'gomoku');
    assert.equal(new URL(invite).searchParams.get('version'), '1');
    const invalidPage = await guestContext.newPage();
    const invalidUrl = new URL(invite); invalidUrl.searchParams.set('version', '999');
    await invalidPage.goto(invalidUrl.href);
    assert.match(await invalidPage.$eval('#notice', node => node.textContent), /不兼容/);
    await invalidPage.close();
    await guest.goto(url);
    await guest.type('#address', invite);
    await Promise.all([guest.waitForNavigation(), guest.click('#join')]);
    await host.waitForFunction(() => !document.querySelector('#start').disabled);
    await host.click('#start');
    await guest.waitForFunction(() => document.querySelector('#state').textContent.includes('轮到黑棋'));
    await host.click('#board button');
    await guest.waitForFunction(() => document.querySelector('#state').textContent.includes('轮到白棋'));
    assert.equal(await guest.$eval('#board button:first-child .stone', node => node.className), 'stone');
    await guest.click('#board button:nth-child(2)');
    await host.waitForFunction(() => document.querySelector('#state').textContent.includes('轮到黑棋'));
    assert.equal(await host.$eval('#board button:nth-child(2) .stone', node => node.className), 'stone white');
    // 模拟旧邀请和旧房主存档都没有游戏元信息，刷新后必须保留棋局。
    await host.evaluate(() => {
        const room = new URL(location.href).searchParams.get('room');
        localStorage.removeItem(`aasc-game-meta-${room}`);
        history.replaceState(null, '', `/?relay=1&room=${room}`);
    });
    await host.reload();
    await host.waitForFunction(() => document.querySelector('#state').textContent.includes('轮到黑棋'));
    assert.equal(await host.$eval('#board button:first-child .stone', node => node.className), 'stone');
    const roomUrl = host.url();
    await host.close();
    await guest.waitForFunction(() => document.querySelector('#notice').textContent.includes('房主离线'));
    const resumed = await hostContext.newPage();
    await resumed.goto(roomUrl);
    await resumed.waitForFunction(() => document.querySelector('#state').textContent.includes('轮到黑棋'));
    await guest.waitForFunction(() => document.querySelector('#state').textContent.includes('轮到黑棋'));
});
