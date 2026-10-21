const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGomokuGameService } = require('../src/apps/server/modules/game/gomoku-game-service');
const { formatGameProtocolSummary } = require('../src/apps/server/modules/game/game-chat-bridge');

function stateFile(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-game-map-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return path.join(directory, 'gomoku.json');
}

/** 依据协议契约检查行列及分隔符，并与显示端所用权威棋盘逐格比较。 */
function verifyMap(receipt, snapshot) {
    const [header, marker, ...lines] = receipt.split('\n');
    assert.match(header, /^Game:五子棋,GM,/);
    assert.equal(marker, 'GameMap:');
    assert.equal(lines.length, snapshot.size);
    for (const [index, line] of lines.entries()) {
        assert.match(line, index === snapshot.size - 1 ? /^[.XO]+$/ : /^[.XO]+\/$/);
        assert.equal(line.replace(/\/$/, '').length, snapshot.size);
    }
    assert.equal(lines.join(''), snapshot.board);
    return lines.map(line => line.replace(/\/$/, ''));
}

for (const size of [9, 11, 13, 15]) {
    test(`${size}路开局、双方落子与查看输出逐行GameMap，显示端编码仍可逐格还原`, t => {
        const events = [];
        const game = createGomokuGameService({ filePath: stateFile(t), onUpdate: (_, message) => events.push(message) });
        const apply = (actor, operation, ...args) => game.apply('d', { game: '五子棋', actor, operation, args });
        const opened = apply('User', '开局', String(size));
        assert.equal(opened.ok, true);
        const empty = verifyMap(opened.gm, game.snapshot('d'));
        assert.ok(empty.every(row => row === '.'.repeat(size)));
        const user = apply('User', '落子', 'C3');
        assert.equal(user.ok, true);
        assert.equal(verifyMap(user.gm, game.snapshot('d'))[2][2], 'X');
        const ai = apply('AI', '落子', 'E5');
        assert.equal(ai.ok, true);
        const snapshot = game.snapshot('d');
        const rows = verifyMap(ai.gm, snapshot);
        assert.equal(rows[2][2], 'X');
        assert.equal(rows[4][4], 'O');
        assert.equal(snapshot.board.includes('\n'), false);
        const viewed = apply('AI', '查看');
        assert.equal(viewed.ok, true);
        verifyMap(viewed.gm, snapshot);
        const deltas = events.filter(event => event.type === 'gameDelta');
        assert.deepEqual(deltas.map(event => [event.actor, event.coordinate]), [['User', 'C3'], ['AI', 'E5']]);
        assert.ok(deltas.every(event => !Object.hasOwn(event, 'board')));
    });
}

test('用户15路样本按原样多行输出，A3至E3与G6等坐标不转置', t => {
    const expected = `GameMap:
.............../
.............../
XXXXX........../
.............../
.............../
......O......../
.....O.O.O...../
.......XO....../
.............../
.............../
.............../
.............../
.............../
.............../
...............`;
    const compact = expected.split('\n').slice(1).join('');
    const filePath = stateFile(t);
    fs.writeFileSync(filePath, JSON.stringify({ d: { id: '08a0-test', revision: 11, size: 15,
        board: compact.replaceAll('/', '').split(''), turn: 'User', result: 'User胜', visible: true } }));
    const game = createGomokuGameService({ filePath });
    const receipt = game.gmSnapshot('d');
    assert.equal(receipt, `Game:五子棋,GM,快照,08a0,11,15,GameUser,GameUser胜\n${expected}`);
    const snapshot = game.snapshot('d');
    const rows = verifyMap(receipt, snapshot);
    for (const [coordinate, stone] of Object.entries({ A3: 'X', B3: 'X', C3: 'X', D3: 'X', E3: 'X',
        G6: 'O', F7: 'O', H7: 'O', J7: 'O', H8: 'X', I8: 'O' })) {
        assert.equal(rows[Number(coordinate.slice(1)) - 1][coordinate.charCodeAt(0) - 65], stone, coordinate);
    }
    assert.equal(snapshot.board, compact);
});

test('GM摘要只显示元数据，完整GameMap保留在协议原文中', t => {
    const game = createGomokuGameService({ filePath: stateFile(t) });
    game.apply('d', { game: '五子棋', actor: 'User', operation: '开局', args: ['9'] });
    const move = game.apply('d', { game: '五子棋', actor: 'User', operation: '落子', args: ['C3'] });
    assert.equal(formatGameProtocolSummary('GM', move.gm),
        `GM · #${game.snapshot('d').gameId.slice(0, 4)} 第2手 GameUser C3`);
    assert.equal(formatGameProtocolSummary('GM', game.gmSnapshot('d')),
        `GM · #${game.snapshot('d').gameId.slice(0, 4)} 9路棋盘已同步`);
    assert.match(move.gm, /\nGameMap:\n/);
});
