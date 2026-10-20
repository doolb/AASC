const { extractGameTags, stripGameTags } = require('./gomoku-game-service');

const MAX_TAGS_PER_REPLY = 8;
const GAME_PROMPT = [
    '本地游戏标签：<Game:游戏名,User或AI,操作[,参数...]>；英文逗号位置参数，不用 JSON。回复开头可连续写最多 8 行标签，每行一条，后面可接自然语言；需要新 GM 结果时先等回执。',
    'User 代表用户，语音坐标也由你代发；AI 代表你。不得伪造 GM/Game，只有 GM 确认后才说操作成功。已有棋局收到坐标先调用标签，轮到 AI 时由你落子；普通聊天直接回答。',
    '首次需要本地游戏时先发 <Game:目录,AI,列表> 查询当前显示端，再用 <Game:游戏名,AI,规则> 按需读取规则；已有规则时按规则操作。'
].join('\n');
const GOMOKU_RULES = [
    '位置参数标签只用英文逗号且不用JSON；操作者User或AI；标签放回复开头，每行一条最多八条，后面可接自然语言；需新GM结果时先等回执',
    '可调用User或AI的开局、落子坐标、查看、提议尺寸、确认尺寸、退出显示、恢复显示；开局默认15路，也可9、11、13路',
    '用户执黑先行，AI执白；横竖斜连续五子获胜，无禁手；坐标A1从左上角起，列包含I，中文数字可转阿拉伯数字',
    '用户语音落子由AI代发User标签；不得编造用户坐标或确认；显示端点击已由GM提供增量，轮到AI时须先选择合法空位调用AI落子',
    '已有棋局勿重复开局；进行中同尺寸重开要用户明确要求，改尺寸先提议待确认；只有GM确认后才能宣称落子或胜负',
    '若能确定合法AI棋步，可在User落子标签后下一行预写AI落子；否则等GM落子增量再决定；游戏标签不复述不朗读'
].join('；');
const recoveredContexts = new Map();

/** 多标签必须组成回复开头的连续整行；单标签保留旧版同一行叙述兼容。 */
function parseGameReplyBlock(value) {
    const text = String(value || '');
    const tags = extractGameTags(text);
    if (tags.length <= 1) return { tags, narrative: stripGameTags(text), valid: true };
    if (tags.length > MAX_TAGS_PER_REPLY) return { tags, narrative: '', valid: false };
    const lines = text.trimStart().replace(/\r\n?/g, '\n').split('\n');
    let tagLines = 0;
    for (const line of lines) {
        const content = line.trim();
        const lineTags = extractGameTags(content);
        if (lineTags.length !== 1 || lineTags[0].raw !== content) break;
        tagLines += 1;
    }
    const narrative = lines.slice(tagLines).join('\n').trim();
    return { tags, narrative, valid: tagLines === tags.length && !narrative.includes('<Game:') };
}

function formatGameProtocolSummary(kind, raw) {
    const parts = String(raw || '').replace(/^<Game:/, '').replace(/>$/, '').split(',');
    const operation = parts[2] || '操作';
    if (kind !== 'GM') return `${kind} · ${operation}${parts[3] ? ` ${parts[3]}` : ''}`;
    if (operation === '规则') return `GM · ${parts[0]}规则已读取`;
    if (operation === '列表') return `GM · 当前支持：${parts[3] || '无'}`;
    if (operation === '快照') return `GM · #${String(parts[3] || '').slice(0, 4)} ${parts[5]}路棋盘已同步`;
    if (operation === '落子') {
        const result = parts[8] && parts[8] !== '进行中' ? ` · ${parts[8]}` : '';
        return `GM · #${String(parts[3] || '').slice(0, 4)} 第${parts[4]}手 ${parts[5]} ${parts[6]}${result}`;
    }
    return `GM · ${operation}${parts[3] ? ` ${parts[3]}` : ''}`;
}

/** 普通流式回复只过滤游戏标签；对尚未收齐的标签前缀先保留在缓冲区。 */
function filterGameProtocolText(value, complete = false) {
    const input = String(value || '');
    let output = '';
    let cursor = 0;
    while (cursor < input.length) {
        const opening = input.indexOf('<', cursor);
        if (opening < 0) return output + input.slice(cursor);
        output += input.slice(cursor, opening);
        const remaining = input.slice(opening);
        if ('<Game:'.startsWith(remaining)) return complete ? output + remaining : output;
        if (remaining.startsWith('<Game:')) {
            const closing = remaining.indexOf('>');
            if (closing < 0) return output;
            cursor = opening + closing + 1;
            continue;
        }
        output += '<';
        cursor = opening + 1;
    }
    return output;
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

/** 游戏回合缓冲模型输出，避免标签的半截流进入聊天或 TTS。 */
async function runGameAwareChat({ chat, gameService, displayId, content, userText = content,
    options, callbacks, internalSignal = false, getAvailableGames = () => ['五子棋'] }) {
    if (!displayId) {
        return chat.chatStream(content, options, callbacks);
    }
    // raw 格式会把 systemPrompt 放进同一条 user 消息的 System: 后；游戏协议先于角色设定。
    const systemPrompt = [GAME_PROMPT, options.systemPrompt].filter(Boolean).join('\n\n');
    let input = content;
    let version = gameService.snapshot(displayId)?.revision;
    let invalidAiMoves = 0;
    let missingAiMoves = 0;
    let retriedUserTurn = false;
    let firstPlainReply = null;
    let lastHistory = [];
    const narratives = [];
    const gameTrace = [];
    const recordProtocol = (kind, text) => {
        const entry = { kind, text, summary: formatGameProtocolSummary(kind, text),
            sequence: gameTrace.length + 1 };
        gameTrace.push(entry);
        callbacks.onGameProtocol?.(entry);
    };
    const contextKey = [displayId, chat.getActiveProfile?.() || '', options.mode || '',
        options.target || '', options.sessionId || ''].join('|');
    const initialState = gameService.snapshot(displayId);
    const needsRecovery = initialState && recoveredContexts.get(contextKey) !== initialState.gameId;
    if (needsRecovery) {
        // 服务器重启或聊天上下文切换后只补一次权威棋盘；常规回合继续传增量。
        const snapshot = gameService.gmSnapshot(displayId);
        input = `${snapshot}\n${content}`;
        recordProtocol('GM', snapshot);
    }
    if (internalSignal && /^<Game:五子棋,GM,/.test(content)) recordProtocol('GM', content);
    for (let turn = 0; turn < 7; turn += 1) {
        // 活动棋局先等完整首答，避免模型漏发标签时把错误叙述提前播出。
        const mayStreamPlain = turn === 0 && !internalSignal
            && initialState?.result !== '进行中';
        let streamedPlain = false;
        let deliveredText = '';
        const pendingSentences = [];
        const forwardSentence = ([sentence, fullMessage, reasoning, speech, phase]) => {
            const safeSentence = filterGameProtocolText(sentence, true);
            if (!safeSentence) return;
            callbacks.onSentence?.(safeSentence, filterGameProtocolText(fullMessage, true),
                stripGameTags(reasoning), filterGameProtocolText(speech, true), phase);
        };
        const streamCallbacks = mayStreamPlain ? {
            onChunk: (_chunk, fullMessage, reasoning) => {
                const candidate = String(fullMessage || '').trimStart();
                if (!streamedPlain) {
                    if (!candidate || '<Game:'.startsWith(candidate) || candidate.startsWith('<Game:')) return;
                    streamedPlain = true;
                    for (const args of pendingSentences) forwardSentence(args);
                    pendingSentences.length = 0;
                }
                const safeFull = filterGameProtocolText(fullMessage);
                if (!safeFull.startsWith(deliveredText)) return;
                const safeChunk = safeFull.slice(deliveredText.length);
                if (safeChunk) callbacks.onChunk?.(safeChunk, safeFull, stripGameTags(reasoning));
                deliveredText = safeFull;
            },
            onSentence: (...args) => {
                if (!streamedPlain) {
                    pendingSentences.push(args);
                    return;
                }
                forwardSentence(args);
            }
        } : {};
        const response = await chat.chatStream(input, { ...options, systemPrompt }, streamCallbacks);
        if (!response?.success) {
            callbacks.onError?.(response?.error || '游戏聊天失败');
            return response;
        }
        if (needsRecovery) recoveredContexts.set(contextKey, initialState.gameId);
        lastHistory = response.history || lastHistory;
        const replyBlock = parseGameReplyBlock(response.message);
        const tags = replyBlock.tags;
        if (streamedPlain) {
            const message = filterGameProtocolText(response.message, true).trim();
            const reasoning = stripGameTags(response.reasoning);
            const speech = stripGameTags(response.speech) || message;
            if (message.startsWith(deliveredText) && message.length > deliveredText.length) {
                callbacks.onChunk?.(message.slice(deliveredText.length), message, reasoning);
            }
            callbacks.onComplete?.(message, lastHistory, reasoning, speech, gameTrace);
            return { ...response, message, reasoning, speech };
        }
        if (tags.length === 0) {
            const state = gameService.snapshot(displayId);
            if (turn === 0 && !internalSignal && initialState?.result === '进行中'
                && state?.turn === 'User' && state.result === '进行中'
                && !retriedUserTurn) {
                // 只让模型重新判断是否该调用标签，不由服务端识别游戏关键词或代用户落子。
                retriedUserTurn = true;
                firstPlainReply = response;
                input = `你刚才对用户原话只给出自然语言答复，棋局并未变化。请重新判断原话是否要求本地游戏操作；` +
                    `若要求操作，回复开头先发一条合法 Game 标签，等待 GM 回执；若是普通聊天，直接回答。` +
                    `原话：${userText}`;
                continue;
            }
            if (state?.turn === 'AI' && state.result === '进行中' && missingAiMoves < 2) {
                const pendingText = stripGameTags(response.message);
                if (pendingText) narratives.push(pendingText);
                missingAiMoves += 1;
                input = '<Game:五子棋,GM,错误,轮到AI落子>';
                continue;
            }
            const plainResponse = firstPlainReply && state?.turn === 'User'
                ? firstPlainReply : response;
            const finalText = state?.turn === 'AI' && state.result === '进行中'
                ? `${stripGameTags(response.message)}\n当前轮到 AI，落子暂未完成。`
                : plainResponse.message;
            const combined = [...narratives, stripGameTags(finalText)].filter(Boolean).join('\n');
            const combinedSpeech = [...narratives, stripGameTags(plainResponse.speech) || stripGameTags(finalText)]
                .filter(Boolean).join('\n');
            return emitFinal(combined, plainResponse.reasoning, combinedSpeech, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace);
        }
        firstPlainReply = null;
        if (!replyBlock.valid || tags.some(tag => !tag.call)) {
            input = '<Game:五子棋,GM,错误,标签格式无效>';
            continue;
        }
        const gmResults = [];
        let failedResult = null;
        for (const { call, raw } of tags) {
            recordProtocol(call.actor, raw);
            const games = getAvailableGames(displayId);
            const available = Array.isArray(games) && games.includes('五子棋');
            const result = call.game === '目录'
                ? { ok: true, gm: `<Game:目录,GM,列表,${available ? '五子棋' : '无'}>` }
                : call.operation === '规则'
                    ? available
                        ? { ok: true, gm: `<Game:五子棋,GM,规则,${GOMOKU_RULES}>` }
                        : { ok: false, code: '当前显示端不支持五子棋',
                            gm: '<Game:五子棋,GM,错误,当前显示端不支持五子棋>' }
                    : gameService.apply(displayId, call, { expectedVersion: version, userText });
            recordProtocol('GM', result.gm);
            gmResults.push(result.gm);
            version = gameService.snapshot(displayId)?.revision;
            if (result.ok && call.operation === '开局') {
                recoveredContexts.set(contextKey, gameService.snapshot(displayId)?.gameId);
            }
            if (result.ok) continue;
            failedResult = result;
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
        const lastCall = tags.at(-1).call;
        const narrative = replyBlock.narrative;
        if (narrative) narratives.push(narrative);
        const nextState = gameService.snapshot(displayId);
        if (lastCall.game === '五子棋' && lastCall.operation !== '规则'
            && nextState && (nextState.turn !== 'AI' || nextState.result !== '进行中')
            && narrative) {
            const combined = narratives.join('\n');
            return emitFinal(combined, response.reasoning, combined, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace);
        }
        input = gmResults.at(-1);
    }
    return emitFinal('游戏操作次数达到上限，请查看棋盘后重试。', '', '', callbacks, lastHistory,
        chat.splitIntoSentences, gameTrace);
}

module.exports = { runGameAwareChat, GAME_PROMPT, filterGameProtocolText, formatGameProtocolSummary };
