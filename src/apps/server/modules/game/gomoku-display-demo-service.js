const { randomUUID } = require('node:crypto');

function isLoopbackAddress(address) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
}

/** 演示仅改变显示端的临时画面，不写入棋局文件或聊天历史。 */
function createGomokuDisplayDemoService({ getSnapshot, sendToDisplay, isOnline,
    schedule = setTimeout, cancel = clearTimeout }) {
    const active = new Map();

    function stop(displayId, owner = null, restore = true) {
        const demo = active.get(displayId);
        if (!demo) return { ok: false, code: '演示未运行' };
        if (owner && demo.owner !== owner) return { ok: false, code: '演示由其他连接启动' };
        active.delete(displayId);
        for (const timer of demo.timers) cancel(timer);
        if (restore && isOnline(displayId)) {
            const snapshot = getSnapshot(displayId);
            sendToDisplay(displayId, snapshot || { type: 'gameDemoEnd', gameId: demo.id });
        }
        return { ok: true, displayId };
    }

    function start(owner, displayId, size = 15, options = {}) {
        if (!owner || typeof displayId !== 'string' || !isOnline(displayId)) {
            return { ok: false, code: '显示端不在线' };
        }
        if (![9, 15].includes(size)) return { ok: false, code: '演示棋盘尺寸无效' };
        const { delayMs = 900, resultPauseMs = 2000, winner = 'both' } = options;
        if (!Number.isSafeInteger(delayMs) || delayMs < 100 || delayMs > 10000
            || !Number.isSafeInteger(resultPauseMs) || resultPauseMs < 500 || resultPauseMs > 30000
            || !['both', 'user', 'ai'].includes(winner)) {
            return { ok: false, code: '演示节奏或胜方参数无效' };
        }
        if (active.has(displayId)) {
            const previous = stop(displayId, owner, false);
            if (!previous.ok) return previous;
        }
        const demo = { id: `demo-${randomUUID()}`, owner, displayId, size, revision: 1,
            board: Array(size * size).fill('.'), turn: 'User', timers: [] };
        active.set(displayId, demo);
        const rounds = winner === 'both' ? ['user', 'ai'] : [winner];
        const userWins = ['E5', 'E6', 'F5', 'F6', 'G5', 'G6', 'H5', 'H6', 'I5'];
        const aiWins = ['E5', 'E6', 'F5', 'F6', 'G5', 'G6', 'H5', 'H6', 'A1', 'I6'];
        const rows = () => {
            const result = [];
            for (let y = 0; y < size; y += 1) {
                result.push(demo.board.slice(y * size, (y + 1) * size).join(''));
            }
            return result.join('/');
        };
        function sendSnapshot() {
            return sendToDisplay(displayId, { type: 'gameSnapshot', game: '五子棋',
                gameId: demo.id, revision: 1, size, board: rows(), turn: 'User',
                result: '进行中', visible: true, demo: true });
        }
        const sent = sendSnapshot();
        if (!sent) {
            active.delete(displayId);
            return { ok: false, code: '显示端发送失败' };
        }
        function move(actor, coordinate, result) {
            if (active.get(displayId) !== demo || demo.turn !== actor) return;
            const match = /^([A-O])([1-9]|1[0-5])$/.exec(coordinate);
            if (!match) return;
            const x = match[1].charCodeAt(0) - 65;
            const y = Number(match[2]) - 1;
            if (x >= size || y >= size) return;
            const index = y * size + x;
            if (demo.board[index] !== '.') return;
            demo.board[index] = actor === 'User' ? 'X' : 'O';
            demo.revision += 1;
            demo.turn = result === '进行中' ? (actor === 'User' ? 'AI' : 'User') : '-';
            sendToDisplay(displayId, { type: 'gameDelta', game: '五子棋', gameId: demo.id,
                revision: demo.revision, actor, coordinate, turn: demo.turn,
                result, demo: true });
        }
        function playRound(roundIndex, moveIndex) {
            if (active.get(displayId) !== demo) return;
            const coordinates = rounds[roundIndex] === 'user' ? userWins : aiWins;
            if (moveIndex === coordinates.length) {
                if (roundIndex + 1 === rounds.length) return;
                demo.timers.push(schedule(() => {
                    if (active.get(displayId) !== demo) return;
                    demo.id = `demo-${randomUUID()}`;
                    demo.revision = 1;
                    demo.board = Array(size * size).fill('.');
                    demo.turn = 'User';
                    if (sendSnapshot()) playRound(roundIndex + 1, 0);
                }, resultPauseMs));
                return;
            }
            demo.timers.push(schedule(() => {
                if (active.get(displayId) !== demo) return;
                const actor = moveIndex % 2 === 0 ? 'User' : 'AI';
                const result = moveIndex + 1 === coordinates.length
                    ? (rounds[roundIndex] === 'user' ? 'User胜' : 'AI胜') : '进行中';
                move(actor, coordinates[moveIndex], result);
                playRound(roundIndex, moveIndex + 1);
            }, delayMs));
        }
        playRound(0, 0);
        return { ok: true, displayId, gameId: demo.id, size, delayMs, resultPauseMs, winner };
    }

    function stopForControl(owner) {
        for (const [displayId, demo] of active) {
            if (demo.owner === owner) stop(displayId, owner);
        }
    }

    function stopForDisplay(displayId) { return stop(displayId, null, false); }

    return { start, stop, stopForControl, stopForDisplay,
        cancelForRealUpdate: displayId => stop(displayId, null, false).ok };
}

module.exports = { createGomokuDisplayDemoService, isLoopbackAddress };
