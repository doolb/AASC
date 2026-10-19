const { extractGameTags, stripGameTags } = require('./gomoku-game-service');

const GAME_PROMPT = [
    '你可以通过位置参数标签操作本地五子棋：<Game:五子棋,操作者,操作[,参数...]>。',
    '标签只用英文逗号分隔的位置参数，不使用 JSON；只在用户提出游戏相关请求或棋局轮到你时调用。',
    '操作者是棋子所属方 User 或 AI；即使用户用语音下棋，也是你代用户发出 User 标签。',
    'GM 是服务端权威状态，不是你可以发出的操作；Game 表示同步到显示端的事件。不要伪造 GM 或 Game 标签。',
    '一次回复最多发出一条标签，等 GM 返回权威结果后再继续。标签不需要向用户解释。',
    '操作：开局或开局,9/11/13/15；落子,H8；查看；提议尺寸,11；确认尺寸,11；退出显示；恢复显示。',
    '默认 15×15，用户黑子先行、你执白子，横竖斜连续五子及以上获胜，无禁手；坐标从左上角 A1 起，列字母包含 I。',
    '中途改变棋盘尺寸先提议，只有用户明确确认后才可调用 User,确认尺寸；确认会清空棋盘并沿用游戏 ID。',
    '已有棋局时不要重复开局；进行中的同尺寸重开只在用户明确要求重新开始时调用，改尺寸必须先提议并等用户确认。',
    '你只选择 AI 的棋步；不要代用户编造坐标或确认尺寸。用户落子后若轮到 AI，请调用 AI 落子。',
    'GM 正常落子只返回坐标、版本、下一手和结果增量；完整棋盘只在开局或恢复时提供。禁止自己宣称未被 GM 确认的落子或胜负。',
    '游戏标签会被服务端截留，不会显示或朗读。收到 GM 结果后再用自然语言向用户讲述，不要在叙述中复述标签。',
    '用户用中文数字说坐标时可规范为阿拉伯数字，例如 A一 对应 A1。'
].join('\n');
const recoveredContexts = new Map();

function shouldUseGameBridge(displayId, content, gameService, internalSignal = false) {
    return Boolean(displayId && (internalSignal || gameService.has(displayId)
        || /五子棋|五字棋|<Game:五子棋/.test(String(content || ''))));
}

function emitFinal(text, reasoning, speech, callbacks, history, splitIntoSentences) {
    const message = stripGameTags(text) || '游戏操作已处理。';
    const safeReasoning = stripGameTags(reasoning);
    const safeSpeech = stripGameTags(speech) || message;
    callbacks.onChunk?.(message, message, safeReasoning);
    for (const sentence of splitIntoSentences(safeSpeech)) {
        if (sentence.trim()) callbacks.onSentence?.(sentence, message, safeReasoning, safeSpeech, 'answer');
    }
    callbacks.onComplete?.(message, history, safeReasoning, safeSpeech);
    return { success: true, message, reasoning: safeReasoning, speech: safeSpeech, history };
}

/** 游戏回合缓冲模型输出，避免标签的半截流进入聊天或 TTS。 */
async function runGameAwareChat({ chat, gameService, displayId, content, userText = content,
    options, callbacks, internalSignal = false }) {
    if (!shouldUseGameBridge(displayId, content, gameService, internalSignal)) {
        return chat.chatStream(content, options, callbacks);
    }
    const systemPrompt = [options.systemPrompt, GAME_PROMPT].filter(Boolean).join('\n\n');
    let input = content;
    let version = gameService.snapshot(displayId)?.revision;
    let invalidAiMoves = 0;
    let missingAiMoves = 0;
    let missingStart = 0;
    let lastHistory = [];
    const contextKey = [displayId, chat.getActiveProfile?.() || '', options.mode || '',
        options.target || '', options.sessionId || ''].join('|');
    const initialState = gameService.snapshot(displayId);
    const needsRecovery = initialState && recoveredContexts.get(contextKey) !== initialState.gameId;
    if (needsRecovery) {
        // 服务器重启或聊天上下文切换后只补一次权威棋盘；常规回合继续传增量。
        input = `${gameService.gmSnapshot(displayId)}\n${content}`;
    }
    for (let turn = 0; turn < 7; turn += 1) {
        const response = await chat.chatStream(input, { ...options, systemPrompt }, {});
        if (!response?.success) {
            callbacks.onError?.(response?.error || '游戏聊天失败');
            return response;
        }
        if (needsRecovery) recoveredContexts.set(contextKey, initialState.gameId);
        lastHistory = response.history || lastHistory;
        const tags = extractGameTags(response.message);
        if (tags.length === 0) {
            const state = gameService.snapshot(displayId);
            if (!state && /五子棋|五字棋/.test(String(userText)) && missingStart < 2) {
                missingStart += 1;
                input = '<Game:五子棋,GM,错误,尚未开局>\n用户要玩五子棋，请先调用一条开局标签。';
                continue;
            }
            if (state?.turn === 'AI' && state.result === '进行中' && missingAiMoves < 2) {
                missingAiMoves += 1;
                input = '<Game:五子棋,GM,错误,轮到AI落子>\n请先调用一条 AI 落子标签，不要只叙述。';
                continue;
            }
            const finalText = !state ? '五子棋尚未开局，请重试。'
                : state.turn === 'AI' && state.result === '进行中'
                ? `${stripGameTags(response.message)}\n当前轮到 AI，落子暂未完成。`
                : response.message;
            return emitFinal(finalText, response.reasoning, response.speech, callbacks, lastHistory,
                chat.splitIntoSentences);
        }
        if (tags.length !== 1 || !tags[0].call) {
            input = '<Game:五子棋,GM,错误,标签格式无效>\n请只生成一条合法标签，然后等待 GM。';
            continue;
        }
        const call = tags[0].call;
        const result = gameService.apply(displayId, call, { expectedVersion: version, userText });
        version = gameService.snapshot(displayId)?.revision;
        if (result.ok && call.operation === '开局') {
            recoveredContexts.set(contextKey, gameService.snapshot(displayId)?.gameId);
        }
        if (!result.ok && call.actor === 'AI' && call.operation === '落子') {
            invalidAiMoves += 1;
            if (invalidAiMoves > 2) {
                return emitFinal('AI 落子未成功，棋局仍停留在 AI 回合，请稍后重试。', '', '', callbacks,
                    lastHistory, chat.splitIntoSentences);
            }
        }
        input = `${result.code === '版本过期' ? gameService.gmSnapshot(displayId) : result.gm}\n${result.ok ? '根据权威结果继续：若轮到 AI，请先选择合法空位并调用一条 AI 落子标签；否则直接用自然语言回复用户。'
            : '操作失败，请核对用户原话与当前轮次。不要编造用户操作；可重新选择 AI 棋步，或向用户说明错误。'}`;
    }
    return emitFinal('游戏操作次数达到上限，请查看棋盘后重试。', '', '', callbacks, lastHistory,
        chat.splitIntoSentences);
}

module.exports = { runGameAwareChat, shouldUseGameBridge, GAME_PROMPT };
