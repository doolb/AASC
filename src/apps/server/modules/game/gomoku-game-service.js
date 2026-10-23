const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeGameChatScope, matchesGameChatScope } = require('./game-chat-scope');

const GAME_NAME = '五子棋';
const SIZES = new Set([9, 11, 13, 15]);
const OPERATIONS = Object.freeze({
    开局: [0, 1], 落子: [1], 查看: [0], 提议尺寸: [1], 确认尺寸: [1], 退出显示: [0], 恢复显示: [0]
});
const GAME_LINE = /^Game:[^\r\n]*/gm;
const SHORT_GAME_LINE = /^(?:GameUser|GameAI):[^\r\n]*/gm;
const LEGACY_GAME_TAG = /<Game:([^<>]{1,160})>/g;
const INTERNAL_ACTORS = Object.freeze({ GameUser: 'User', GameAI: 'AI' });

// 对模型展示的游戏角色与棋盘内部角色分开，避免改变已保存棋局和显示端增量格式。
function protocolActor(actor) { return actor === 'User' ? 'GameUser' : actor === 'AI' ? 'GameAI' : actor; }
function protocolResult(result) {
    return result === 'User胜' ? 'GameUser胜' : result === 'AI胜' ? 'GameAI胜' : result;
}

function parseGameTag(raw, currentGame = null) {
    if (typeof raw !== 'string') return null;
    const legacy = /^<Game:[^<>]{1,160}>$/.test(raw);
    // 简写只能由目标显示端正在进行的权威棋局补全，不从模型文本猜游戏名。
    const shorthand = Boolean(currentGame) && /^(?:GameUser|GameAI):[^<>\r\n]{1,160}$/.test(raw);
    if (!legacy && !shorthand && !/^Game:[^<>\r\n]{1,160}$/.test(raw)) return null;
    const fields = shorthand
        ? [currentGame, raw.slice(0, raw.indexOf(':')),
            ...raw.slice(raw.indexOf(':') + 1).split(',').map(value => value.trim())]
        : (legacy ? raw.slice(6, -1) : raw.slice(5)).split(',').map(value => value.trim());
    const [game, protocolRole, operation, ...args] = fields;
    const actor = INTERNAL_ACTORS[protocolRole];
    if (game === '目录' && ['User', 'AI'].includes(actor)
        && operation === '列表' && args.length === 0) {
        return { game, actor, operation, args, raw };
    }
    if (game === GAME_NAME && actor === 'AI' && operation === '规则' && args.length === 0) {
        return { game, actor, operation, args, raw };
    }
    if (game !== GAME_NAME || !['User', 'AI'].includes(actor)) return null;
    if (!Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) return null;
    if (!OPERATIONS[operation].includes(args.length) || args.some(value => !value || /[<>，]/.test(value))) return null;
    return { game, actor, operation, args, raw };
}

function extractGameTags(text, currentGame = null) {
    if (typeof text !== 'string') return [];
    // 同一轮允许完整、简写与旧格式并存，按原文出现位置交给权威棋局依次校验。
    const shorthand = currentGame ? [...text.matchAll(SHORT_GAME_LINE)] : [];
    return [...text.matchAll(GAME_LINE), ...text.matchAll(LEGACY_GAME_TAG), ...shorthand]
        .sort((left, right) => left.index - right.index)
        .map(match => ({ raw: match[0], call: parseGameTag(match[0], currentGame) }));
}

function stripGameTags(text, currentGame = null) {
    // 有活动棋局才移除简写；无棋局时 GameUser:/GameAI: 仍可作为普通聊天文字。
    const withoutFullTags = String(text || '').replace(/^Game:[^\r\n]*(?:\r?\n|$)/gm, '')
        .replace(/<Game:[^>\r\n]*(?:>|$)/g, '');
    return (currentGame
        ? withoutFullTags.replace(/^(?:GameUser|GameAI):[^\r\n]*(?:\r?\n|$)/gm, '')
        : withoutFullTags).trim();
}

// 完整 ID 仅用于服务端状态和显示端版本匹配；模型回执展示四位短编号。
function shortGameId(id) { return String(id || '').slice(0, 4); }

function gmStatusFromState(state) {
    // 终局已经没有下一手，胜负只在状态回执中给出；进行中继续沿用原有字段顺序。
    const ending = state.result === '进行中'
        ? `${protocolActor(state.turn)},${state.result}` : protocolResult(state.result);
    return `Game:五子棋,GM,状态,${shortGameId(state.id)},${state.revision},${state.size},${ending}`;
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

function encodeBoard(board, size) {
    const rows = [];
    for (let y = 0; y < size; y += 1) rows.push(board.slice(y * size, (y + 1) * size).join(''));
    return rows.join('/');
}

/** GM 文本每行对应棋盘一行，保留行间斜杠；显示端仍使用原 encodeBoard 编码。 */
function formatGameMap(board, size) {
    return `GameMap:\n${encodeBoard(board, size).split('/').join('/\n')}`;
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
    const chats = new Set();
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
        if (!state) return 'Game:五子棋,GM,错误,未开局';
        return gmSnapshotFromState(state);
    }

    function gmStatus(displayId) {
        const state = games.get(displayId);
        if (!state) return 'Game:五子棋,GM,错误,未开局';
        return gmStatusFromState(state);
    }

    function fail(code) {
        return { ok: false, code, gm: `Game:五子棋,GM,错误,${code}` };
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

    /** 登记整轮模型交互，清空时连尚未开局的请求也失效。 */
    function beginChat(displayId, scope) {
        const controller = new AbortController();
        const request = { displayId, scope: normalizeGameChatScope(scope), controller };
        chats.add(request);
        return { signal: controller.signal, release: () => chats.delete(request) };
    }

    function clearForChat(scope, { displayIds = [] } = {}) {
        const targets = new Set(displayIds);
        const targetMatches = id => !targets.size || targets.has(id);
        const removed = [...games].filter(([id, state]) => targetMatches(id)
            && (state.chatScope ? matchesGameChatScope(state.chatScope, scope) : targets.has(id)));
        for (const [id] of removed) games.delete(id);
        try {
            if (removed.length) persist();
        } catch (error) {
            for (const [id, state] of removed) games.set(id, state);
            throw error;
        }
        // 先保存成功，再让模型输出失效；持久失败时原局和在途操作继续有效。
        for (const request of chats) {
            if (targetMatches(request.displayId) && matchesGameChatScope(request.scope, scope)) {
                request.controller.abort(new Error('聊天已清空'));
            }
        }
        for (const [id, state] of removed) onUpdate(id, { type: 'gameCleared', game: GAME_NAME,
            gameId: state.id, revision: state.revision + 1 });
        return removed.map(([id]) => id);
    }

    function apply(displayId, call, { expectedVersion, userText = '', source = 'model', chatScope } = {}) {
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
                    turn: 'User', result: '进行中', visible: true, pendingSize: null,
                    ...(chatScope ? { chatScope: normalizeGameChatScope(chatScope) } : {}) };
                const message = { ...snapshotFromState(next), type: 'gameSnapshot' };
                return commit(displayId, next, message,
                    gmSnapshotFromState(next));
            }
            case '查看': {
                if (!state) return fail('未开局');
                // 查看也要把权威棋盘送到显示端；原先隐藏时先恢复持久化可见状态。
                const next = state.visible === false
                    ? { ...state, revision: state.revision + 1, visible: true } : state;
                const gm = gmSnapshotFromState(next);
                const message = { ...snapshotFromState(next), type: 'gameSnapshot',
                    tag: gm.replace(',GM,', ',Game,') };
                if (next !== state) return commit(displayId, next, message, gm);
                onUpdate(displayId, message);
                return { ok: true, gm, message };
            }
            case '落子': {
                if (!state) return fail('未开局');
                if (state.result !== '进行中') return fail('棋局已结束');
                if (call.actor !== state.turn) return fail('未轮到该方');
                const coordinate = parseCoordinate(argument, state.size);
                if (!coordinate) return fail('坐标无效');
                // GameUser 的位置参数由 AI 按用户自然语言代填；GM 仍校验轮次、范围与空位。
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
                const next = { ...state, board, revision: state.revision + 1, turn, result, visible: true,
                    ...(!state.chatScope && chatScope ? { chatScope: normalizeGameChatScope(chatScope) } : {}) };
                // 隐藏期间没有可靠的本地棋盘，恢复时直接发完整快照；可见时仍只发增量。
                const message = state.visible === false
                    ? { ...snapshotFromState(next), type: 'gameSnapshot' }
                    : { type: 'gameDelta', game: GAME_NAME, gameId: next.id,
                        revision: next.revision, actor: call.actor, coordinate: coordinate.text, turn, result };
                // 每步回执附落子后的权威棋盘；终局不写下一手，最终结果由随后 GM 状态说明。
                const gmEnding = result === '进行中' ? `,${protocolActor(turn)},${result}` : '';
                return commit(displayId, next, message,
                    `Game:五子棋,GM,落子,${shortGameId(next.id)},${next.revision},${protocolActor(call.actor)},${coordinate.text}${gmEnding}\n${formatGameMap(next.board, next.size)}`);
            }
            case '提议尺寸': {
                if (!state) return fail('未开局');
                const size = parseSize(argument);
                if (!size) return fail('棋盘尺寸无效');
                const next = { ...state, revision: state.revision + 1, pendingSize: size, visible: true };
                const message = state.visible === false
                    ? { ...snapshotFromState(next), type: 'gameSnapshot' }
                    : { type: 'gameProposal', game: GAME_NAME, gameId: next.id,
                        revision: next.revision, pendingSize: size };
                return commit(displayId, next, message, `Game:五子棋,GM,待确认尺寸,${size}`);
            }
            case '确认尺寸': {
                if (!state) return fail('未开局');
                const size = parseSize(argument);
                if (call.actor !== 'User' || !size || state.pendingSize !== size) return fail('尺寸待确认');
                if (!/确认|同意|确定|可以|好的|是的|就这样|按这个|没问题/.test(userText)) return fail('需要用户确认');
                const next = { ...state, revision: state.revision + 1, size, board: Array(size * size).fill('.'),
                    turn: 'User', result: '进行中', visible: true, pendingSize: null };
                return commit(displayId, next, { ...snapshotFromState(next), type: 'gameSnapshot' },
                    gmSnapshotFromState(next));
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
                    : `Game:五子棋,GM,已隐藏,${shortGameId(next.id)},${next.revision}`);
            }
            default:
                return fail('无效操作');
        }
    }

    return { apply, snapshot, gmSnapshot, gmStatus, beginChat, clearForChat,
        has: displayId => games.has(displayId) };
}

function snapshotFromState(state) {
    return { game: GAME_NAME, gameId: state.id, revision: state.revision, size: state.size,
        board: encodeBoard(state.board, state.size), turn: state.turn, result: state.result,
        visible: state.visible !== false, pendingSize: state.pendingSize || null };
}

function gmSnapshotFromState(state) {
    return `Game:五子棋,GM,快照,${shortGameId(state.id)},${state.revision},${state.size},${protocolActor(state.turn)},${protocolResult(state.result)}\n${formatGameMap(state.board, state.size)}`;
}

module.exports = { createGomokuGameService, parseGameTag, extractGameTags, stripGameTags,
    parseCoordinate, encodeBoard };
