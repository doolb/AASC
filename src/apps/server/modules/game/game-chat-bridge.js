const { extractGameTags, stripGameTags } = require('./gomoku-game-service');

const MAX_TAGS_PER_REPLY = 8;
const STATE_CHANGING_OPERATIONS = new Set(['开局', '落子', '提议尺寸', '确认尺寸', '退出显示', '恢复显示']);
const GAME_PROMPT = [
    '本地游戏调用行：Game:游戏名,GameUser或GameAI,操作[,参数...]；不用尖括号，字段只用英文逗号，不用 JSON。回复开头最多 8 条调用行，每条独占一行；如果该调用行需要等待确认或者数据,以及GameUser或者GameAI操作游戏需要等待状态确认时,是原子操作,等待调行回复,不能再发其他调用行；自然语言另起行,每次回复都带上自然语言。',
    '自然语言中不要透露等待状态确认,GM的信息, 这些是内部流程。',
    'GameUser 代表用户，语音坐标也由你代发；GameAI 代表你。不得伪造 GM/Game，只有 GM 确认后才说操作成功。',
    '用户报坐标时先发 GameUser 落子行，等 GM 确认且轮到 GameAI，再决定并发 GameAI 落子行；普通聊天直接回答。',
    '',
    '帮玩家操作，',
    'Game:目录,GameUser,列表',
    '',
    '你的操作，',
    'Game:目录,GameAI,列表',
    '',
    '首次需要本地游戏时先发下面的, 调用目录查询，',
    'Game:目录,GameAI,列表',
    '',
    '然后再发下面的按需读取规则；已有规则时按规则操作。',
    'Game:游戏名,GameAI,规则'
].join('\n');
const GOMOKU_RULES = [
    '可用操作：',
    '开局[,尺寸]：用户要求开始或终局后“再来一局”时调用；首次不填尺寸默认15，重开不填则沿用上局尺寸。进行中重开须用户明确要求；换尺寸不能直接开局。',
    '落子,坐标：仅在棋局进行中且轮到对应一方时调用；坐标为列字母加行号，如C3。用户报位置由AI代发GameUser落子，等GM确认且轮到GameAI后，AI才决定自己的落子。',
    '查看：需要确认当前棋盘、空位或胜负时调用；查看返回完整GM快照。',
    '提议尺寸,尺寸：已有棋局需要更换尺寸时先调用，等待GM回执和用户确认；未开局可直接使用开局,尺寸。',
    '确认尺寸,尺寸：仅在已有待确认的相同尺寸，且用户明确同意后，由GameUser调用；确认后重新开局。',
    '退出显示：用户明确要求隐藏棋盘时调用；棋局仍保留。',
    '恢复显示：只需重新显示已隐藏棋盘时调用；查看和其他棋盘操作也会显示棋盘。',
    '尺寸9/11/13/15，默认15；用户黑先、AI白后，不能选择先后手；A1在左上角，列包含I；口语位置先行后列，例如第3行第3列是C3，用户落子发Game:五子棋,GameUser,落子,C3；横竖斜五连胜，无禁手',
    'GM快照首行字段：短编号,版本,尺寸,下一手,结果；下一手用GameUser或GameAI，胜方用GameUser胜或GameAI胜；随后独立一行GameMap:，其后每行是棋盘的一行，从上到下排列，除末行外行尾保留/；每行从左到右对应A至末列，第一行是第1行；.为空位，X是用户黑棋，O是AI白棋（字母O）；落子前按行列检查目标格为.，已占用须另选空格',
    'GM落子回执也在首行之后附完整GameMap棋盘；进行中首行字段为短编号,版本,落子方,坐标,下一手,进行中；终局首行字段为短编号,版本,落子方,坐标，胜负看棋盘之后的GM状态；以后续回执中的最新棋盘为准',
    'GM只发回执，不能用GM角色调用；改尺寸先提议并待用户明确确认；进行中同尺寸重开须用户明确要求',
    '棋力：普通、专业、资深，默认普通。用户要求切换档位时按新档执行，未要求时沿用当前档。',
    '所有档位落子前都先读最新棋盘，确认轮次、坐标和空位。',
    '普通：优先自己连五，其次阻止对方下一手连五，再围绕已有棋子发展。',
    '专业：在普通基础上，优先制造和化解活四、冲四、活三，兼顾进攻与防守。',
    '资深：在专业基础上，比较多个候选点，推演双方后续应手，优先连续威胁、双重威胁和必胜路线。',
    '信息不足时先查看棋盘，不凭历史叙述猜测位置。'
].join('\n');
// 游戏目录可以扩展；规则查询、进行中与已结束的棋局共用同一份游戏专属规则。
const GAME_RULES = Object.freeze({ 五子棋: GOMOKU_RULES });
const recoveredContexts = new Map();

/** 即使协议行的角色写错，也从位置参数识别其声称改变的游戏操作。 */
function attemptedStateChanges(tags) {
    return tags.map(({ raw }) => {
        const shorthand = /^(?:GameUser|GameAI):/.test(raw);
        const fields = shorthand ? raw.slice(raw.indexOf(':') + 1).split(',')
            : (raw.startsWith('<Game:') ? raw.slice(6, -1) : raw.slice(5)).split(',');
        return fields[shorthand ? 0 : 2]?.trim();
    })
        .filter(operation => STATE_CHANGING_OPERATIONS.has(operation));
}

/** GM 已拒绝本轮操作时，只拦截明显宣称棋步已经完成的续答。 */
function claimsUnconfirmedMove(text) {
    const value = String(text || '');
    return /已(?:经)?[^。！？\n]{0,8}(?:下好|落好|下了|落了|走了|落在|下在|成功|完成)|(?:下|落)(?:好|成|完|在|了)|(?:落子|棋步)[^。！？\n]{0,8}(?:成功|完成)|(?:我|你|用户|玩家|AI|黑棋|白棋)[^。！？\n]{0,10}(?:下|落|走)\s*[A-O](?:1[0-5]|[1-9])/i.test(value);
}

/** 只识别独立协议行；自然语言可位于第一条调用之前或多条调用之间。 */
function parseGameReplyBlock(value, currentGame = null) {
    const text = String(value || '');
    const tags = extractGameTags(text, currentGame);
    if (tags.length > MAX_TAGS_PER_REPLY) return { tags, narrative: '', valid: false };
    const unparsed = tags.reduce((remaining, tag) => remaining.replace(tag.raw, ''), text);
    return { tags, narrative: stripGameTags(text, currentGame),
        valid: tags.length === 0 || (!/^Game:/gm.test(unparsed) && !unparsed.includes('<Game:')) };
}

function formatGameProtocolSummary(kind, raw) {
    // 只解析协议首行，避免多行 GameMap 混入落点、结果或错误摘要。
    const source = String(raw || '').split(/\r?\n/, 1)[0];
    const parts = /^(?:GameUser|GameAI):/.test(source)
        ? ['', source.slice(0, source.indexOf(':')),
            ...source.slice(source.indexOf(':') + 1).split(',')]
        : source.replace(/^<?Game:/, '').replace(/>$/, '').split(',');
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
function filterGameProtocolText(value, complete = false, currentGame = null) {
    const input = String(value || '');
    let output = '';
    const lines = input.split('\n');
    for (const [index, valueLine] of lines.entries()) {
        const line = valueLine.replace(/\r$/, '');
        const finished = index < lines.length - 1;
        const prefixes = currentGame ? ['Game:', 'GameUser:', 'GameAI:'] : ['Game:'];
        if (prefixes.some(prefix => line.startsWith(prefix))) continue;
        if (!finished && !complete && prefixes.some(prefix => prefix.startsWith(line))) break;
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

function emitFinal(text, reasoning, speech, callbacks, history, splitIntoSentences, gameTrace = [], currentGame = null) {
    const message = stripGameTags(text, currentGame) || '游戏操作已处理。';
    const safeReasoning = stripGameTags(reasoning, currentGame);
    const safeSpeech = stripGameTags(speech, currentGame) || message;
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
    // 终局保留上一局和规则，供模型判断“再来一局”；查询规则本身不改变 NowGame。
    // raw 格式会把 systemPrompt 放进同一条 user 消息的 System: 后，游戏提示位于角色设定之前。
    const nowGame = initialState?.result === '进行中' ? initialState.game : '无';
    const ruleGame = initialState?.game;
    const nowGamePrompt = [`NowGame:${nowGame}`,
        initialState && nowGame === '无'
            ? `LastGame:${initialState.game},已结束,尺寸${initialState.size}` : '',
        GAME_RULES[ruleGame] ? `${ruleGame}规则:${GAME_RULES[ruleGame]}` : '']
        .filter(Boolean).join('\n');
    const systemPrompt = [GAME_PROMPT, nowGamePrompt, options.systemPrompt]
        .filter(Boolean).join('\n\n');
    let input = content;
    let version = initialState?.revision;
    let invalidAiMoves = 0;
    const unconfirmedOperations = new Set();
    let lastHistory = [];
    let maxTurns = 7;
    const narratives = [];
    const gameTrace = [];
    let replyGame = nowGame === '无' ? null : nowGame;
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
            chat.splitIntoSentences, gameTrace, replyGame);
    };
    const contextKey = [displayId, chat.getActiveProfile?.() || '', options.mode || '',
        options.target || '', options.sessionId || ''].join('|');
    const needsRecovery = initialState && recoveredContexts.get(contextKey) !== initialState.gameId;
    if (needsRecovery) {
        // 服务器重启或上下文切换后补一次权威快照；常规落子回执也会附最新棋盘编码。
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
        // 模型生成期间棋局可能由显示端点按或另一条会话改变，解析时以最新权威状态决定简写所指游戏。
        const activeState = gameService.snapshot(displayId);
        replyGame = activeState?.result === '进行中' ? activeState.game : null;
        if (needsRecovery) recoveredContexts.set(contextKey, initialState.gameId);
        lastHistory = response.history || lastHistory;
        const replyBlock = parseGameReplyBlock(response.message, replyGame);
        const tags = replyBlock.tags;
        if (tags.length === 0) {
            if (unconfirmedOperations.size) {
                // 只展示 GM 错误之后新生成的纠错叙述；被拒绝调用旁的预写文字已清空。
                const correction = stripGameTags(response.message, replyGame);
                if (!correction || claimsUnconfirmedMove(correction)) return emitUnconfirmedOperation();
                const speech = stripGameTags(response.speech, replyGame);
                return emitFinal(correction, response.reasoning,
                    speech && !claimsUnconfirmedMove(speech) ? speech : correction,
                    callbacks, lastHistory, chat.splitIntoSentences, gameTrace, replyGame);
            }
            // 没有调用行就是普通聊天；现有棋局和当前轮次都不触发游戏补判或伪造 GM 回执。
            const plainText = stripGameTags(response.message, replyGame);
            const combined = [...narratives, plainText].filter(Boolean).join('\n');
            const combinedSpeech = [...narratives,
                stripGameTags(response.speech, replyGame) || plainText].filter(Boolean).join('\n');
            return emitFinal(combined, response.reasoning, combinedSpeech, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace, replyGame);
        }
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
        let confirmedAiMove = false;
        for (const [index, { call, raw }] of tags.entries()) {
            recordProtocol(call.actor === 'User' ? 'GameUser' : 'GameAI', raw);
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
            if (result.ok && call.operation === '落子' && call.actor === 'AI') confirmedAiMove = true;
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
                    lastHistory, chat.splitIntoSentences, gameTrace, replyGame);
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
            // 终局落子保留原叙述；状态回执独立生成，查看指令则始终提供完整棋盘。
            const status = gameService.gmStatus(displayId);
            recordProtocol('GM', status);
            input = [...gmResults, status].join('\n');
            maxTurns = Math.min(8, Math.max(maxTurns, turn + 2));
            continue;
        }
        if (confirmedAiMove) {
            // AI 必须读到自己的成功回执和最新棋盘，避免下一轮仍误以为该棋步尚未确认。
            // 保留原叙述，确认后的自然语言由后续模型回复追加；确认预留一次，整体不超过八次。
            input = gmResults.join('\n');
            maxTurns = Math.min(8, Math.max(maxTurns, turn + 2));
            continue;
        }
        if (lastCall.game === '五子棋' && lastCall.operation !== '规则'
            && nextState && (nextState.turn !== 'AI' || nextState.result !== '进行中')
            && narrative) {
            const combined = narratives.join('\n');
            return emitFinal(combined, response.reasoning, combined, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace, replyGame);
        }
        input = gmResults.join('\n');
    }
    if (unconfirmedOperations.size) return emitUnconfirmedOperation();
    return emitFinal('游戏操作次数达到上限，请查看棋盘后重试。', '', '', callbacks, lastHistory,
        chat.splitIntoSentences, gameTrace, replyGame);
}

module.exports = { runGameAwareChat, GAME_PROMPT, filterGameProtocolText, formatGameProtocolSummary };
