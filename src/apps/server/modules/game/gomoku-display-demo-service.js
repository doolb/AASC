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

    function start(owner, displayId, size = 15) {
        if (!owner || typeof displayId !== 'string' || !isOnline(displayId)) {
            return { ok: false, code: '显示端不在线' };
        }
        if (![9, 15].includes(size)) return { ok: false, code: '演示棋盘尺寸无效' };
        if (active.has(displayId)) {
            const previous = stop(displayId, owner, false);
            if (!previous.ok) return previous;
        }
        const demo = { id: `demo-${randomUUID()}`, owner, displayId, size, revision: 1,
            board: Array(size * size).fill('.'), turn: 'User', timers: [] };
        active.set(displayId, demo);
        const rows = () => {
            const result = [];
            for (let y = 0; y < size; y += 1) {
                result.push(demo.board.slice(y * size, (y + 1) * size).join(''));
            }
            return result.join('/');
        };
        const sent = sendToDisplay(displayId, { type: 'gameSnapshot', game: '五子棋',
            gameId: demo.id, revision: 1, size, board: rows(), turn: 'User',
            result: '进行中', visible: true, demo: true });
        if (!sent) {
            active.delete(displayId);
            return { ok: false, code: '显示端发送失败' };
        }
        function move(actor, coordinate) {
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
            demo.turn = actor === 'User' ? 'AI' : 'User';
            sendToDisplay(displayId, { type: 'gameDelta', game: '五子棋', gameId: demo.id,
                revision: demo.revision, actor, coordinate, turn: demo.turn,
                result: '进行中', demo: true });
        }
        const userMove = size === 15 ? 'H8' : 'C3';
        const aiMove = size === 15 ? 'G8' : 'D3';
        demo.timers.push(schedule(() => move('User', userMove), 700));
        demo.timers.push(schedule(() => move('AI', aiMove), 1400));
        return { ok: true, displayId, gameId: demo.id, size };
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
