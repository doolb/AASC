const { extractGameTags, stripGameTags } = require('./gomoku-game-service');

const GAME_PROMPT = '需要本地游戏时，回复开头只输出 <Game:目录,AI,列表> 查询当前显示端游戏；' +
    '再用 <Game:游戏名,AI,规则> 按需读取规则。每轮只发一条标签，等 GM 回执；普通聊天无需调用。';
const GOMOKU_RULES = [
    '位置参数标签只用英文逗号且不用JSON；操作者User或AI；标签放回复开头且一次一条；GM只表示权威回执，不要伪造',
    '可调用User或AI的开局、落子坐标、查看、提议尺寸、确认尺寸、退出显示、恢复显示；开局默认15路，也可9、11、13路',
    '用户执黑先行，AI执白；横竖斜连续五子获胜，无禁手；坐标A1从左上角起，列包含I，中文数字可转阿拉伯数字',
    '用户语音落子由AI代发User标签；不得编造用户坐标或确认；显示端点击已由GM提供增量，轮到AI时须先选择合法空位调用AI落子',
    '已有棋局勿重复开局；进行中同尺寸重开要用户明确要求，改尺寸先提议待确认；只有GM确认后才能宣称落子或胜负',
    '收到GM落子增量后若轮到AI先落子，否则自然语言答复；游戏标签不复述不朗读'
].join('；');
const recoveredContexts = new Map();

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
    const systemPrompt = [options.systemPrompt, GAME_PROMPT].filter(Boolean).join('\n\n');
    let input = content;
    let version = gameService.snapshot(displayId)?.revision;
    let invalidAiMoves = 0;
    let missingAiMoves = 0;
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
        const mayStreamPlain = turn === 0 && !internalSignal
            && !(initialState?.turn === 'AI' && initialState.result === '进行中');
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
        const tags = extractGameTags(response.message);
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
            if (state?.turn === 'AI' && state.result === '进行中' && missingAiMoves < 2) {
                const pendingText = stripGameTags(response.message);
                if (pendingText) narratives.push(pendingText);
                missingAiMoves += 1;
                input = '<Game:五子棋,GM,错误,轮到AI落子>';
                continue;
            }
            const finalText = state?.turn === 'AI' && state.result === '进行中'
                ? `${stripGameTags(response.message)}\n当前轮到 AI，落子暂未完成。`
                : response.message;
            const combined = [...narratives, stripGameTags(finalText)].filter(Boolean).join('\n');
            const combinedSpeech = [...narratives, stripGameTags(response.speech) || stripGameTags(finalText)]
                .filter(Boolean).join('\n');
            return emitFinal(combined, response.reasoning, combinedSpeech, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace);
        }
        if (tags.length !== 1 || !tags[0].call) {
            input = '<Game:五子棋,GM,错误,标签格式无效>';
            continue;
        }
        const call = tags[0].call;
        recordProtocol(call.actor, tags[0].raw);
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
        const narrative = stripGameTags(response.message);
        if (result.ok && narrative) narratives.push(narrative);
        version = gameService.snapshot(displayId)?.revision;
        if (result.ok && call.operation === '开局') {
            recoveredContexts.set(contextKey, gameService.snapshot(displayId)?.gameId);
        }
        if (!result.ok && call.actor === 'AI' && call.operation === '落子') {
            invalidAiMoves += 1;
            if (invalidAiMoves > 2) {
                return emitFinal('AI 落子未成功，棋局仍停留在 AI 回合，请稍后重试。', '', '', callbacks,
                    lastHistory, chat.splitIntoSentences, gameTrace);
            }
        }
        const nextState = gameService.snapshot(displayId);
        if (result.ok && call.game === '五子棋' && call.operation !== '规则'
            && nextState && (nextState.turn !== 'AI' || nextState.result !== '进行中')
            && narrative) {
            const combined = narratives.join('\n');
            return emitFinal(combined, response.reasoning, combined, callbacks, lastHistory,
                chat.splitIntoSentences, gameTrace);
        }
        input = result.code === '版本过期' ? gameService.gmSnapshot(displayId) : result.gm;
    }
    return emitFinal('游戏操作次数达到上限，请查看棋盘后重试。', '', '', callbacks, lastHistory,
        chat.splitIntoSentences, gameTrace);
}

module.exports = { runGameAwareChat, GAME_PROMPT, filterGameProtocolText, formatGameProtocolSummary };
