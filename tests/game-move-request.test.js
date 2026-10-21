const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createGomokuGameService } = require('../src/apps/server/modules/game/gomoku-game-service');

// 执行服务端真实消息分支，用真实棋局验证请求锁；不启动生产服务器或调用真实模型。
const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const recoverBranch = source.slice(source.indexOf("    if (data.type === 'gameRecover') {"),
    source.indexOf("    if (data.type === 'gameView') {"));
const moveBranch = source.slice(source.indexOf("    if (data.type === 'gameMove') {"),
    source.indexOf("    if (data.type === 'chatMessage') {", source.indexOf("    if (data.type === 'gameMove') {")));

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-game-move-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const messages = [];
    const requests = [];
    const errors = [];
    const pendingGameMoves = new Map();
    const ws = { send: value => messages.push(JSON.parse(value)) };
    const displayData = { ws };
    const game = createGomokuGameService({ filePath: path.join(directory, 'game.json'),
        onUpdate: (_, message) => displayData.ws.send(JSON.stringify(message)) });
    const dispatch = vm.runInNewContext(`(function(data, ws) { ${recoverBranch}\n${moveBranch} })`, {
        displayId: 'screen', displayData, pendingGameMoves, gomokuGame: game,
        chat: { getSession: () => ({ mode: 'private', privateTarget: '小爱', privateSessionId: 'test' }) },
        handleChatMessage: options => new Promise((resolve, reject) => requests.push({ options, resolve, reject })),
        logError: (_, message) => errors.push(message), broadcastToControls() {},
        sendToDisplay: (_, message) => displayData.ws.send(JSON.stringify(message))
    });
    const apply = (actor, operation, ...args) => game.apply('screen', { game: '五子棋', actor, operation, args });
    apply('User', '开局', '9');
    messages.length = 0;
    const move = (requestId = 'one', coordinate = 'C3', extra = {}) => dispatch({ type: 'gameMove', requestId,
        coordinate, gameId: game.snapshot('screen').gameId, revision: game.snapshot('screen').revision, ...extra }, ws);
    return { dispatch, ws, displayData, messages, requests, errors, pendingGameMoves, game, apply, move };
}

test('同一显示端快速重发只执行一次，AI 落子后仍保持锁直到聊天完成', async t => {
    const f = fixture(t);
    f.move();
    const revision = f.game.snapshot('screen').revision;
    for (let index = 0; index < 15; index += 1) f.move(index % 2 ? 'one' : `other-${index}`, 'E3');
    assert.equal(f.requests.length, 1);
    assert.equal(f.game.snapshot('screen').revision, revision);
    assert.equal(f.messages.filter(item => item.type === 'gameDelta').length, 1);
    assert.equal(f.messages.at(-1).code, '棋步处理中');
    assert.equal(f.requests[0].options.target, '小爱');
    assert.match(f.requests[0].options.content, /,GM,落子,/);
    assert.equal(f.apply('AI', '落子', 'D3').ok, true);
    f.move('next', 'E3');
    assert.equal(f.messages.at(-1).code, '棋步处理中');
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve();
    await new Promise(setImmediate);
    assert.equal(f.pendingGameMoves.size, 0);
    assert.equal(f.messages.at(-1).status, 'complete');
    assert.equal(f.messages.at(-1).revision, f.game.snapshot('screen').revision);
    await new Promise(setImmediate);
    assert.equal(f.requests.length, 1, '解除锁后，不得补执行处理中被拒绝的其它落点');
    assert.equal(f.game.snapshot('screen').board.split('/')[2][4], '.', '被拒绝的E3仍应为空');
    assert.equal(f.messages.filter(item => item.type === 'gameDelta').length, 2, '只能保留双方已确认的两手');
    f.move('next', 'E3');
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve();
    await new Promise(setImmediate);
});

test('错误版本、棋局、空位和回合不启动 AI，旧连接不能提交', async t => {
    const f = fixture(t);
    f.move('version', 'C3', { revision: 0 });
    assert.equal(f.messages.find(item => item.type === 'gameError').code, '版本过期');
    f.move('game', 'C3', { gameId: 'old-game' });
    assert.equal(f.messages.at(-1).code, '棋局已变化');
    f.apply('User', '落子', 'C3');
    f.move('turn', 'E3');
    assert.equal(f.messages.at(-1).code, '未轮到该方');
    f.apply('AI', '落子', 'D3');
    f.move('occupied', 'C3');
    assert.match(f.messages.at(-1).code, /占用/);
    f.dispatch({ type: 'gameMove', requestId: 'untrusted', coordinate: 'E3', revision: 3 }, { send() {} });
    assert.equal(f.requests.length, 0);
    assert.equal(f.pendingGameMoves.size, 0);
});

test('重连恢复带处理中编号，完成状态发送给当前连接，失败也释放锁', async t => {
    const f = fixture(t);
    f.move();
    const reconnected = [];
    f.displayData.ws = { send: value => reconnected.push(JSON.parse(value)) };
    f.dispatch({ type: 'gameRecover', requestId: 'recover-1' }, f.displayData.ws);
    assert.equal(reconnected.at(-1).pendingRequestId, 'one');
    assert.equal(reconnected.at(-1).snapshot.turn, 'AI');
    f.requests[0].reject(new Error('模拟模型失败'));
    await new Promise(setImmediate);
    assert.equal(f.pendingGameMoves.size, 0);
    assert.equal(f.errors.length, 1);
    assert.equal(reconnected.at(-1).status, 'complete');
    assert.equal(reconnected.at(-1).requestId, 'one');
    f.dispatch({ type: 'gameRecover', requestId: 'recover-2' }, f.displayData.ws);
    assert.equal(reconnected.at(-1).pendingRequestId, null);
    assert.equal(reconnected.at(-1).requestId, 'recover-2');
});

test('恢复没有棋局时明确返回空快照，旧恢复请求仍可收到普通快照', t => {
    const f = fixture(t);
    f.dispatch({ type: 'gameRecover' }, f.ws);
    assert.equal(f.messages.at(-1).type, 'gameSnapshot');
    const emptyGame = createGomokuGameService({ filePath: path.join(os.tmpdir(), `not-present-${Date.now()}.json`) });
    const recover = vm.runInNewContext(`(function(data, ws) { ${recoverBranch} })`, {
        displayData: { ws: f.ws }, displayId: 'missing', gomokuGame: emptyGame, pendingGameMoves: new Map()
    });
    recover({ type: 'gameRecover', requestId: 'empty' }, f.ws);
    assert.deepEqual(f.messages.at(-1), { type: 'gameRecoverResult', requestId: 'empty',
        snapshot: null, pendingRequestId: null });
});
