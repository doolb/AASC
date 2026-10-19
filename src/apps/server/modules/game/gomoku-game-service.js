const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const GAME_NAME = '五子棋';
const SIZES = new Set([9, 11, 13, 15]);
const OPERATIONS = Object.freeze({
    开局: [0, 1], 落子: [1], 查看: [0], 提议尺寸: [1], 确认尺寸: [1], 退出显示: [0], 恢复显示: [0]
});
const GAME_TAG = /<Game:([^<>]{1,160})>/g;

function parseGameTag(raw) {
    if (typeof raw !== 'string' || !/^<Game:[^<>]{1,160}>$/.test(raw)) return null;
    const fields = raw.slice(6, -1).split(',').map(value => value.trim());
    const [game, actor, operation, ...args] = fields;
    if (game !== GAME_NAME || !['User', 'AI'].includes(actor)) return null;
    if (!Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) return null;
    if (!OPERATIONS[operation].includes(args.length) || args.some(value => !value || /[<>，]/.test(value))) return null;
    return { game, actor, operation, args, raw };
}

function extractGameTags(text) {
    if (typeof text !== 'string') return [];
    return Array.from(text.matchAll(GAME_TAG), match => ({ raw: match[0], call: parseGameTag(match[0]) }));
}

function stripGameTags(text) {
    return String(text || '').replace(/<Game:[^>\n]*(?:>|$)/g, '').trim();
}

function parseSize(value) {
    const size = Number(value);
    return SIZES.has(size) && String(size) === String(value) ? size : null;
}

function parseCoordinate(value, size) {
    const normalized = String(value || '').trim().toUpperCase().replace(/[。．.！!？?]/g, '');
    const match = /^([A-O])([1-9]|1[0-5])$/.exec(normalized);
    if (!match) return null;
    const x = match[1].charCodeAt(0) - 65;
    const y = Number(match[2]) - 1;
    return x < size && y < size ? { x, y, text: `${match[1]}${y + 1}` } : null;
}

function userNamedCoordinate(text, coordinate) {
    const named = String(coordinate || '').toUpperCase();
    const value = String(text || '').toUpperCase().replace(/\s+/g, '');
    if (value.includes(named)) return true;
    const match = /^([A-O])(1[0-5]|[1-9])$/.exec(named);
    if (!match) return false;
    const chinese = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一',
        '十二', '十三', '十四', '十五'][Number(match[2])];
    return value.includes(`${match[1]}${chinese}`);
}

function encodeBoard(board, size) {
    const rows = [];
    for (let y = 0; y < size; y += 1) rows.push(board.slice(y * size, (y + 1) * size).join(''));
    return rows.join('/');
}

function isValidState(state) {
    return state && typeof state === 'object' && typeof state.id === 'string'
        && Number.isSafeInteger(state.revision) && state.revision >= 1 && SIZES.has(state.size)
        && Array.isArray(state.board) && state.board.length === state.size ** 2
        && state.board.every(cell => ['.', 'X', 'O'].includes(cell))
        && ['User', 'AI'].includes(state.turn)
        && ['进行中', 'User胜', 'AI胜', '平局'].includes(state.result);
}

function createGomokuGameService({ filePath, onUpdate = () => {} }) {
    const games = new Map();
    try {
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const [displayId, state] of Object.entries(saved)) {
            if (isValidState(state)) games.set(displayId, state);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.error(`[Game] 读取棋局失败: ${error.message}`);
    }

    function persist() {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temporaryFile = `${filePath}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(temporaryFile, JSON.stringify(Object.fromEntries(games)), { mode: 0o600 });
            fs.renameSync(temporaryFile, filePath);
        } catch (error) {
            try { fs.unlinkSync(temporaryFile); } catch (_) { /* 临时文件可能不存在。 */ }
            throw error;
        }
    }

    function snapshot(displayId) {
        const state = games.get(displayId);
        if (!state) return null;
        return {
            type: 'gameSnapshot', game: GAME_NAME, gameId: state.id, revision: state.revision,
            size: state.size, board: encodeBoard(state.board, state.size), turn: state.turn,
            result: state.result, visible: state.visible !== false, pendingSize: state.pendingSize || null,
            tag: gmSnapshotFromState(state).replace(',GM,', ',Game,')
        };
    }

    function gmSnapshot(displayId) {
        const state = games.get(displayId);
        if (!state) return '<Game:五子棋,GM,错误,未开局>';
        return `<Game:五子棋,GM,快照,${state.id},${state.revision},${state.size},${state.turn},${state.result},${encodeBoard(state.board, state.size)}>`;
    }

    function fail(code) {
        return { ok: false, code, gm: `<Game:五子棋,GM,错误,${code}>` };
    }

    function commit(displayId, next, message, gm) {
        const previous = games.get(displayId);
        games.set(displayId, next);
        try {
            persist();
        } catch (error) {
            if (previous) games.set(displayId, previous);
            else games.delete(displayId);
            return fail('保存失败');
        }
        if (message) message.tag = gm.replace(',GM,', ',Game,');
        onUpdate(displayId, message);
        return { ok: true, gm, message };
    }

    function apply(displayId, call, { expectedVersion, userText = '', source = 'model' } = {}) {
        if (!displayId || typeof displayId !== 'string') return fail('缺少显示端');
        if (!call || call.game !== GAME_NAME) return fail('无效操作');
        const state = games.get(displayId);
        if (state && expectedVersion !== undefined && Number(expectedVersion) !== state.revision) return fail('版本过期');
        const [argument] = call.args;
        switch (call.operation) {
            case '开局': {
                const size = argument === undefined ? state?.size || 15 : parseSize(argument);
                if (!size) return fail('棋盘尺寸无效');
                if (state && size !== state.size) return fail('请先提议尺寸并等待用户确认');
                if (state?.result === '进行中' && source === 'model'
                    && !/重新开始|重开|新开|再来一局|再开一局|开始新局/.test(userText)) {
                    return fail('棋局进行中，需要用户明确要求重新开局');
                }
                const next = { id: randomUUID(), revision: 1, size, board: Array(size * size).fill('.'),
                    turn: 'User', result: '进行中', visible: true, pendingSize: null };
                const message = { ...snapshotFromState(next), type: 'gameSnapshot' };
                return commit(displayId, next, message,
                    `<Game:五子棋,GM,快照,${next.id},1,${size},User,进行中,${encodeBoard(next.board, size)}>`);
            }
            case '查看':
                return state ? { ok: true, gm: `<Game:五子棋,GM,状态,${state.id},${state.revision},${state.size},${state.turn},${state.result}>` }
                    : fail('未开局');
            case '落子': {
                if (!state) return fail('未开局');
                if (state.result !== '进行中') return fail('棋局已结束');
                if (call.actor !== state.turn) return fail('未轮到该方');
                const coordinate = parseCoordinate(argument, state.size);
                if (!coordinate) return fail('坐标无效');
                if (call.actor === 'User' && source === 'model'
                    && !userNamedCoordinate(userText, coordinate.text)) return fail('用户未指定该坐标');
                const index = coordinate.y * state.size + coordinate.x;
                if (state.board[index] !== '.') return fail('位置已占用');
                const board = state.board.slice();
                const stone = call.actor === 'User' ? 'X' : 'O';
                board[index] = stone;
                const won = [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => {
                    let total = 1;
                    for (const direction of [-1, 1]) {
                        let x = coordinate.x + dx * direction;
                        let y = coordinate.y + dy * direction;
                        while (x >= 0 && x < state.size && y >= 0 && y < state.size
                            && board[y * state.size + x] === stone) {
                            total += 1;
                            x += dx * direction;
                            y += dy * direction;
                        }
                    }
                    return total >= 5;
                });
                const result = won ? `${call.actor}胜` : board.includes('.') ? '进行中' : '平局';
                const turn = result === '进行中' ? call.actor === 'User' ? 'AI' : 'User' : call.actor;
                const next = { ...state, board, revision: state.revision + 1, turn, result };
                const message = { type: 'gameDelta', game: GAME_NAME, gameId: next.id,
                    revision: next.revision, actor: call.actor, coordinate: coordinate.text, turn, result };
                return commit(displayId, next, message,
                    `<Game:五子棋,GM,落子,${next.id},${next.revision},${call.actor},${coordinate.text},${turn},${result}>`);
            }
            case '提议尺寸': {
                if (!state) return fail('未开局');
                const size = parseSize(argument);
                if (!size) return fail('棋盘尺寸无效');
                const next = { ...state, revision: state.revision + 1, pendingSize: size };
                return commit(displayId, next, { type: 'gameProposal', game: GAME_NAME, gameId: next.id,
                    revision: next.revision, pendingSize: size }, `<Game:五子棋,GM,待确认尺寸,${size}>`);
            }
            case '确认尺寸': {
                if (!state) return fail('未开局');
                const size = parseSize(argument);
                if (call.actor !== 'User' || !size || state.pendingSize !== size) return fail('尺寸待确认');
                if (!/确认|同意|确定|可以|好的|是的|就这样|按这个|没问题/.test(userText)) return fail('需要用户确认');
                const next = { ...state, revision: state.revision + 1, size, board: Array(size * size).fill('.'),
                    turn: 'User', result: '进行中', visible: true, pendingSize: null };
                return commit(displayId, next, { ...snapshotFromState(next), type: 'gameSnapshot' },
                    `<Game:五子棋,GM,快照,${next.id},${next.revision},${size},User,进行中,${encodeBoard(next.board, size)}>`);
            }
            case '退出显示':
            case '恢复显示': {
                if (!state) return fail('未开局');
                const visible = call.operation === '恢复显示';
                const next = { ...state, revision: state.revision + 1, visible };
                const message = visible ? { ...snapshotFromState(next), type: 'gameSnapshot' }
                    : { type: 'gameVisibility', game: GAME_NAME, gameId: next.id,
                        revision: next.revision, visible: false };
                return commit(displayId, next, message, visible ? gmSnapshotFromState(next)
                    : `<Game:五子棋,GM,已隐藏,${next.id},${next.revision}>`);
            }
            default:
                return fail('无效操作');
        }
    }

    return { apply, snapshot, gmSnapshot, has: displayId => games.has(displayId) };
}

function snapshotFromState(state) {
    return { game: GAME_NAME, gameId: state.id, revision: state.revision, size: state.size,
        board: encodeBoard(state.board, state.size), turn: state.turn, result: state.result,
        visible: state.visible !== false, pendingSize: state.pendingSize || null };
}

function gmSnapshotFromState(state) {
    return `<Game:五子棋,GM,快照,${state.id},${state.revision},${state.size},${state.turn},${state.result},${encodeBoard(state.board, state.size)}>`;
}

module.exports = { createGomokuGameService, parseGameTag, extractGameTags, stripGameTags,
    parseCoordinate, encodeBoard, userNamedCoordinate };
