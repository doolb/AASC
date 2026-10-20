const { extractGameTags, stripGameTags } = require('./gomoku-game-service');

const MAX_TAGS_PER_REPLY = 8;
const STATE_CHANGING_OPERATIONS = new Set(['开局', '落子', '提议尺寸', '确认尺寸', '退出显示', '恢复显示']);
const GAME_PROMPT = [
    '本地游戏调用行：Game:游戏名,User或AI,操作[,参数...]；不用尖括号，字段只用英文逗号，不用 JSON。回复开头最多 8 条调用行，每条独占一行；如果该调用行需要等待确认或者数据,以及User或者AI操作游戏需要等待状态确认时,是原子操作,等待调行回复,不能再发其他调用行；自然语言另起行,每次回复都带上自然语言。',
    'User 代表用户，语音坐标也由你代发；AI 代表你。不得伪造 GM/Game，只有 GM 确认后才说操作成功。用户报坐标时先发 User 落子行，等 GM 确认且轮到 AI，再决定并发 AI 落子行；普通聊天直接回答。',
    '',
    '首次需要本地游戏时先发下面的, 调用目录查询，',
    'Game:目录,AI,列表',
    '',
    '然后再发下面的按需读取规则；已有规则时按规则操作。',
    'Game:游戏名,AI,规则'
].join('\n');
const GOMOKU_RULES = [
    '操作：开局[,尺寸]、落子,坐标、查看、提议尺寸,尺寸、确认尺寸,尺寸、退出显示、恢复显示',
    '尺寸9/11/13/15，默认15；用户黑先、AI白后；A1在左上角，列包含I；横竖斜五连胜，无禁手',
    'GM快照字段：短编号,版本,尺寸,下一手,结果,棋盘编码；棋盘用/从上到下分行，每行从左到右对应A至末列，第一行是第1行；.为空位，X是用户黑棋，O是AI白棋（字母O）；落子前按行列检查目标格为.，已占用须另选空格',
    '改尺寸先提议并待用户明确确认；进行中同尺寸重开须用户明确要求'
].join('；');
// 游戏目录可以扩展；规则查询和正在进行的棋局共用同一份游戏专属规则。
const GAME_RULES = Object.freeze({ 五子棋: GOMOKU_RULES });
const recoveredContexts = new Map();

/** 即使协议行的角色写错，也从位置参数识别其声称改变的游戏操作。 */
function attemptedStateChanges(tags) {
    return tags.map(({ raw }) => (raw.startsWith('<Game:') ? raw.slice(6, -1) : raw.slice(5))
        .split(',')[2]?.trim())
        .filter(operation => STATE_CHANGING_OPERATIONS.has(operation));
}

/** 只识别独立协议行；自然语言可位于第一条调用之前或多条调用之间。 */
function parseGameReplyBlock(value) {
    const text = String(value || '');
    const tags = extractGameTags(text);
    if (tags.length > MAX_TAGS_PER_REPLY) return { tags, narrative: '', valid: false };
    const unparsed = tags.reduce((remaining, tag) => remaining.replace(tag.raw, ''), text);
    return { tags, narrative: stripGameTags(text),
        valid: tags.length === 0 || (!/^Game:/gm.test(unparsed) && !unparsed.includes('<Game:')) };
}

function formatGameProtocolSummary(kind, raw) {
    const parts = String(raw || '').replace(/^<?Game:/, '').replace(/>$/, '').split(',');
    const operation = parts[2] || '操作';
    if (kind !== 'GM') return `${kind} · ${operation}${parts[3] ? ` ${parts[3]}` : ''}`;
    if (operation === '规则') return `GM · ${parts[0]}规则已读取`;
    if (operation === '列表') return `GM · 当前支持：${parts[3] || '无'}`;
    if (operation === '快照') return `GM · #${String(parts[3] || '').slice(0, 4)} ${parts[5]}路棋盘已同步`;
    if (operation === '状态') {
        return `GM · #${String(parts[3] || '').slice(0, 4)} 状态 ${parts.at(-1) || '未知'}`;
    }
    if (operation === '落子') {
        const result = parts[8] && parts[8] !== '进行中' ? ` · ${parts[8]}` : '';
        return `GM · #${String(parts[3] || '').slice(0, 4)} 第${parts[4]}手 ${parts[5]} ${parts[6]}${result}`;
    }
    return `GM · ${operation}${parts[3] ? ` ${parts[3]}` : ''}`;
}

/** 普通流式回复只过滤独立游戏协议行；对尚未收齐的行首前缀先保留在缓冲区。 */
function filterGameProtocolText(value, complete = false) {
    const input = String(value || '');
    let output = '';
    const lines = input.split('\n');
    for (const [index, valueLine] of lines.entries()) {
        const line = valueLine.replace(/\r$/, '');
        const finished = index < lines.length - 1;
        if (line.startsWith('Game:')) continue;
        if (!finished && !complete && 'Game:'.startsWith(line)) break;
        output += valueLine + (finished ? '\n' : '');
    }
    // 旧格式继续可被权威棋局执行；流式展示路径仍须在完整回合处理前隐藏调用文本。
    let safe = '';
    let cursor = 0;
    while (cursor < output.length) {
        const opening = output.indexOf('<', cursor);
        if (opening < 0) return safe + output.slice(cursor);
        safe += output.slice(cursor, opening);
        const remaining = output.slice(opening);
        if ('<Game:'.startsWith(remaining)) return complete ? safe + remaining : safe;
        if (remaining.startsWith('<Game:')) {
            const closing = remaining.indexOf('>');
            if (closing < 0) return safe;
            cursor = opening + closing + 1;
            continue;
        }
        safe += '<';
        cursor = opening + 1;
    }
    return safe;
}

function emitFinal(text, reasoning, speech, callbacks, history, splitIntoSentences, gameTrace = []) {
    const message = stripGameTags(text) || '游戏操作已处理。';
    const safeReasoning = stripGameTags(reasoning);
    const safeSpeech = stripGameTags(speech) || message;
    callbacks.onChunk?.(message, message, safeReasoning);
    for (const sentence of splitIntoSentences(safeSpeech)) {
        if (sentence.trim()) callbacks.onSentence?.(sentence, message, safeReasoning, safeSpeech, 'answer');
    }
    callbacks.onComplete?.(message, history, safeReasoning, safeSpeech, gameTrace);
    return { success: true, message, reasoning: safeReasoning, speech: safeSpeech, history };
}

/** 游戏回合缓冲模型输出，避免协议行的半截流进入聊天或 TTS。 */
async function runGameAwareChat({ chat, gameService, displayId, content, userText = content,
    options, callbacks, internalSignal = false, getAvailableGames = () => ['五子棋'] }) {
    if (!displayId) {
        return chat.chatStream(content, options, callbacks);
    }
    const initialState = gameService.snapshot(displayId);
    // 当前游戏名来自服务端权威快照；已结束的棋局不再作为正在进行的游戏提示给模型。
    // 查询规则本身不改变 NowGame；只在权威棋局进行中的下一轮附该游戏规则。
    // raw 格式会把 systemPrompt 放进同一条 user 消息的 System: 后，游戏提示位于角色设定之前。
    const nowGame = initialState?.result === '进行中' ? initialState.game : '无';
    const nowGamePrompt = [`NowGame:${nowGame}`,
        nowGame !== '无' && GAME_RULES[nowGame] ? `${nowGame}规则:${GAME_RULES[nowGame]}` : '']
        .filter(Boolean).join('\n');
    const systemPrompt = [GAME_PROMPT, nowGamePrompt, options.systemPrompt]
        .filter(Boolean).join('\n\n');
    let input = content;
    let version = initialState?.revision;
    let invalidAiMoves = 0;
    let missingAiMoves = 0;
    let retriedUserTurn = false;
    const unconfirmedOperations = new Set();
    let firstPlainReply = null;
    let lastHistory = [];
    let maxTurns = 7;
    const narratives = [];
    const gameTrace = [];
    const recordProtocol = (kind, text) => {
        const entry = { kind, text, summary: formatGameProtocolSummary(kind, text),
            sequence: gameTrace.length + 1 };
        gameTrace.push(entry);
        callbacks.onGameProtocol?.(entry);
    };
    const emitUnconfirmedOperation = () => {
        const current = gameService.snapshot(displayId);
        const unchanged = current?.revision === initialState?.revision;
        const message = unchanged
            ? '刚才的游戏操作未执行，棋盘未变化。请重新说出要执行的操作。'
            : '刚才的游戏操作未全部完成，请查看棋盘后继续。';
        return emitFinal(message, '', message, callbacks, lastHistory,
            chat.splitIntoSentences, gameTrace);
    };
    const contextKey = [displayId, chat.getActiveProfile?.() || '', options.mode || '',
        options.target || '', options.sessionId || ''].join('|');
    const needsRecovery = initialState && recoveredContexts.get(contextKey) !== initialState.gameId;
    if (needsRecovery) {
        // 服务器重启或聊天上下文切换后只补一次权威棋盘；常规回合继续传增量。
        const snapshot = gameService.gmSnapshot(displayId);
        input = `${snapshot}\n${content}`;
        recordProtocol('GM', snapshot);
    }
    if (internalSignal && /^Game:五子棋,GM,/.test(content)) recordProtocol('GM', content);
    for (let turn = 0; turn < maxTurns; turn += 1) {
        // 调用行可能出现在任意独立行，须等整次回复结束后再决定哪些叙述可展示。
        const response = await chat.chatStream(input, { ...options, systemPrompt }, {});
        if (!response?.success) {
            callbacks.onError?.(response?.error || '游戏聊天失败');
            return response;
        }
        if (needsRecovery) recoveredContexts.set(contextKey, initialState.gameId);
        lastHistory = response.history || lastHistory;
        const replyBlock = parseGameReplyBlock(response.message);
        const tags = replyBlock.tags;
        if (tags.length === 0) {
            // 前一次非法批次可能写了虚假的落子叙述；只有 GM 确认后才可转述模型的完成宣称。
            if (unconfirmedOperations.size) return emitUnconfirmedOperation();
            const state = gameService.snapshot(displayId);
            if (turn === 0 && !internalSignal && initialState?.result === '进行中'
                && state?.turn === 'User' && state.result === '进行中'
                && !retriedUserTurn) {
                // 只让模型重新判断是否该发送协议行，不由服务端识别游戏关键词或代用户落子。
                retriedUserTurn = true;
                firstPlainReply = response;
                input = `你刚才对用户原话只给出自然语言答复，棋局并未变化。请重新判断原话是否要求本地游戏操作；` +
                    `若要求操作，回复开头先发一条合法 Game 标签，等待 GM 回执；若是普通聊天，直接回答。` +
                    `原话：${userText}`;
                continue;
            }
            if (state?.turn === 'AI' && state.result === '进行中' && missingAiMoves < 2) {
                // 未落子的自然语言可能声称了不存在的棋步，不进入最终播报。
                missingAiMoves += 1;
                input = 'Game:五子棋,GM,错误,轮到AI落子';
                continue;
            }
            const plainResponse = firstPlainReply && state?.turn === 'User'
                ? firstPlainReply : response;
            const finalText = state?.turn === 'AI' && state.result === '进行中'
                ? 'AI 落子尚未得到 GM 确认，请稍后重试。'
                : plainResponse.message;
            const combined = [...narratives, stripGameTags(finalText)].filter(Boolean).join('\n');
            const combinedSpeech = state?.turn === 'AI' && state.result === '进行中'
                ? combined : [...narratives, stripGameTags(plainResponse.speech) || stripGameTags(finalText)]
                    .filter(Boolean).join('\n');
            return emitFinal(combined, plainResponse.reasoning, combinedSpeech, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace);
        }
        firstPlainReply = null;
        if (!replyBlock.valid || tags.some(tag => !tag.call)) {
            const rejectedOperations = attemptedStateChanges(tags);
            if (rejectedOperations.length) {
                for (const operation of rejectedOperations) unconfirmedOperations.add(operation);
                narratives.length = 0;
            }
            input = 'Game:五子棋,GM,错误,调用行格式无效';
            continue;
        }
        const gmResults = [];
        let failedResult = null;
        let deferredAiMove = false;
        let terminalMove = false;
        for (const [index, { call, raw }] of tags.entries()) {
            recordProtocol(call.actor, raw);
            const games = getAvailableGames(displayId);
            const available = Array.isArray(games) && games.includes('五子棋');
            const result = call.game === '目录'
                ? { ok: true, gm: `Game:目录,GM,列表,${available ? '五子棋' : '无'}` }
                : call.operation === '规则'
                    ? available
                        ? { ok: true, gm: `Game:${call.game},GM,规则,${GAME_RULES[call.game]}` }
                        : { ok: false, code: '当前显示端不支持五子棋',
                            gm: 'Game:五子棋,GM,错误,当前显示端不支持五子棋' }
                    : gameService.apply(displayId, call, { expectedVersion: version, userText });
            recordProtocol('GM', result.gm);
            gmResults.push(result.gm);
            version = gameService.snapshot(displayId)?.revision;
            if (result.ok && call.operation === '开局') {
                recoveredContexts.set(contextKey, gameService.snapshot(displayId)?.gameId);
            }
            if (result.ok && STATE_CHANGING_OPERATIONS.has(call.operation)) {
                unconfirmedOperations.delete(call.operation);
            }
            if (result.ok && call.operation === '落子'
                && gameService.snapshot(displayId)?.result !== '进行中') terminalMove = true;
            if (result.ok) {
                // 用户棋步确认后才让模型选择 AI 棋步；本回复预写的 AI 落子及叙述均不采信。
                if (call.actor === 'User' && call.operation === '落子'
                    && tags.slice(index + 1).some(tag => tag.call.actor === 'AI'
                        && tag.call.operation === '落子')) {
                    deferredAiMove = true;
                    break;
                }
                continue;
            }
            failedResult = result;
            if (STATE_CHANGING_OPERATIONS.has(call.operation)) {
                unconfirmedOperations.add(call.operation);
                narratives.length = 0;
            }
            if (call.actor === 'AI' && call.operation === '落子') invalidAiMoves += 1;
            break;
        }
        if (failedResult) {
            if (invalidAiMoves > 2) {
                return emitFinal('AI 落子未成功，棋局仍停留在 AI 回合，请稍后重试。', '', '', callbacks,
                    lastHistory, chat.splitIntoSentences, gameTrace);
            }
            // 已确认的前序操作不回滚；把每条权威回执交还模型，避免其重做已完成的落子。
            input = failedResult.code === '版本过期'
                ? gameService.gmSnapshot(displayId) : gmResults.join('\n');
            continue;
        }
        if (deferredAiMove) {
            input = gmResults.join('\n');
            continue;
        }
        const lastCall = tags.at(-1).call;
        const narrative = replyBlock.narrative;
        if (unconfirmedOperations.size) {
            if (lastCall.operation === '开局') return emitUnconfirmedOperation();
            // 查询只能读取权威状态，不能补确认之前被拒绝的开局或落子。
            input = gmResults.join('\n');
            continue;
        }
        if (narrative) narratives.push(narrative);
        const nextState = gameService.snapshot(displayId);
        if (terminalMove && nextState) {
            // 终局落子已获 GM 确认；保留模型原叙述，再给模型落子与最终状态作一次续答。
            const status = gameService.apply(displayId,
                { game: '五子棋', actor: 'AI', operation: '查看', args: [] },
                { expectedVersion: version });
            if (status.ok) {
                recordProtocol('GM', status.gm);
                input = [...gmResults, status.gm].join('\n');
                maxTurns = Math.max(maxTurns, turn + 2);
                continue;
            }
        }
        if (lastCall.game === '五子棋' && lastCall.operation !== '规则'
            && nextState && (nextState.turn !== 'AI' || nextState.result !== '进行中')
            && narrative) {
            const combined = narratives.join('\n');
            return emitFinal(combined, response.reasoning, combined, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace);
        }
        input = gmResults.join('\n');
    }
    if (unconfirmedOperations.size) return emitUnconfirmedOperation();
    return emitFinal('游戏操作次数达到上限，请查看棋盘后重试。', '', '', callbacks, lastHistory,
        chat.splitIntoSentences, gameTrace);
}

module.exports = { runGameAwareChat, GAME_PROMPT, filterGameProtocolText, formatGameProtocolSummary };
