const { randomUUID } = require('node:crypto');
const { createGomokuGameService } = require('./gomoku-game-service');
const { runGameAwareChat } = require('./game-chat-bridge');

/**
 * 为独立调用者装配与正式聊天相同的游戏桥接和权威棋局。
 * 棋局文件路径由调用方指定，避免演练误写正式显示端的持久化数据。
 */
function createGameChatSession({ filePath, displayId, chat: chatService = null, roleName = null,
    onModelRequest, onEvent = () => {},
    getAvailableGames = () => ['五子棋'] }) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('filePath 必须是棋局文件路径');
    if (typeof displayId !== 'string' || !displayId.trim()) throw new TypeError('displayId 必须是非空字符串');
    if (chatService) {
        if (typeof chatService.chatStream !== 'function'
            || typeof chatService.splitIntoSentences !== 'function') {
            throw new TypeError('chat 必须提供 chatStream 和 splitIntoSentences');
        }
    } else if (typeof onModelRequest !== 'function') {
        throw new TypeError('onModelRequest 必须是函数');
    }
    if (typeof onEvent !== 'function') throw new TypeError('onEvent 必须是函数');
    if (typeof getAvailableGames !== 'function') throw new TypeError('getAvailableGames 必须是函数');
    if (roleName && !chatService) throw new TypeError('选择角色需要传入真实聊天服务');

    let active = false;
    let currentEvents = [];
    let modelSequence = 0;
    const roleSessionId = `game-chat-${randomUUID()}`;
    const emit = (type, fields = {}) => {
        const event = { type, ...fields };
        currentEvents.push(event);
        onEvent(event);
    };
    const gameService = createGomokuGameService({ filePath, onUpdate: (id, update) => {
        emit('gameUpdate', { displayId: id, update });
    } });
    const simulatedChat = {
        splitIntoSentences: value => [String(value || '')],
        async chatStream(input, options) {
            modelSequence += 1;
            const request = { sequence: modelSequence, input, systemPrompt: options.systemPrompt || '' };
            emit('modelRequest', request);
            try {
                const answer = await onModelRequest(request);
                const response = typeof answer === 'string' ? { message: answer } : answer;
                if (!response || typeof response.message !== 'string') {
                    throw new TypeError('目标 AI 必须返回字符串或包含 message 字符串的对象');
                }
                const reasoning = String(response.reasoning || '');
                // 独立入口接收完整模型回复，不把整段文本伪装成一次流式增量。
                // 这样旧版正文内调用仍由桥接层在回合结束时按既有规则解析。
                return { success: true, message: response.message, reasoning,
                    speech: response.speech || '', history: response.history || [] };
            } catch (error) {
                return { success: false, error: error.message || String(error) };
            }
        }
    };
    const chat = chatService ? {
        splitIntoSentences: chatService.splitIntoSentences.bind(chatService),
        getActiveProfile: chatService.getActiveProfile?.bind(chatService),
        async chatStream(input, options, callbacks) {
            modelSequence += 1;
            emit('modelRequest', { sequence: modelSequence, input, systemPrompt: options.systemPrompt || '' });
            // 正式聊天服务自行构造 System/历史与流式请求；此处仅转发原始参数。
            return chatService.chatStream(input, options, callbacks);
        }
    } : simulatedChat;

    /** 一次用户输入可产生多次模型续接，直到游戏桥返回最终聊天。 */
    async function sendUser(content, options = {}) {
        if (active) throw new Error('当前会话仍在处理上一轮');
        if (typeof content !== 'string' || !content.trim()) throw new TypeError('用户文本必须是非空字符串');
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('options 必须是对象');
        }
        active = true;
        currentEvents = [];
        try {
            let chatOptions = options;
            if (roleName) {
                const template = chatService.getTemplateByName?.(roleName);
                if (!template?.content) throw new Error(`聊天角色不存在或没有设定：${roleName}`);
                // 沿用正式 private 角色会话的选项；System 文本由原聊天服务统一构建。
                chatOptions = { ...options, mode: 'private', target: roleName,
                    templateTarget: roleName, sessionId: options.sessionId || roleSessionId,
                    systemPrompt: template.content,
                    includeHistory: options.includeHistory ?? true,
                    contextCount: options.contextCount ?? 100 };
            }
            const result = await runGameAwareChat({ chat, gameService, displayId, content,
                userText: content, options: chatOptions, getAvailableGames, callbacks: {
                    onGameProtocol: entry => emit('gameProtocol', entry),
                    onChunk: (chunk, message, reasoning) => emit('chatChunk', { chunk, message, reasoning }),
                    onSentence: (sentence, message, reasoning, speech, phase) => {
                        emit('chatSentence', { sentence, message, reasoning, speech, phase });
                    },
                    onComplete: (message, history, reasoning, speech, gameTrace) => {
                        emit('chatComplete', { message, reasoning, speech, gameTrace });
                    },
                    onError: error => emit('chatError', { error })
                } });
            return { result, events: currentEvents.slice(), snapshot: gameService.snapshot(displayId) };
        } finally {
            active = false;
        }
    }

    return { sendUser, snapshot: () => gameService.snapshot(displayId) };
}

module.exports = { createGameChatSession };
