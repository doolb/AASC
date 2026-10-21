const { buildGameSystemPrompt } = require('../game/game-chat-bridge');

/** 实际发送与统计查询复用同一份聊天选项，避免私聊100和全局设置各算一套。 */
function resolveChatContextOptions(chat, context = {}) {
    const { mode = 'group', templateTarget = null, temporaryRoleName = null, skipHistory = false } = context;
    let systemPrompt = null;
    let contextCount = 0;
    if (['group', 'temporary'].includes(mode)) {
        systemPrompt = mode === 'temporary' ? chat.getTemplateSystemPrompt(temporaryRoleName) : chat.getGroupSystemPrompt();
        contextCount = mode === 'temporary' ? 10000 : (chat.getConfig().contextCount || 0);
    } else if (templateTarget) {
        const template = chat.getTemplateByName(templateTarget);
        if (template) {
            systemPrompt = template.content;
            contextCount = mode === 'private' ? 100 : (chat.getConfig().contextCount || 0);
        }
    } else {
        contextCount = chat.getConfig().contextCount || 0;
    }
    if (context.systemPrompt && !templateTarget && mode !== 'group') systemPrompt = context.systemPrompt;
    if (skipHistory) contextCount = 0;
    return { systemPrompt, contextCount, includeHistory: contextCount > 0 };
}

function normalizeContextScope(data = {}) {
    const mode = ['group', 'private', 'temporary', 'role'].includes(data.mode) ? data.mode : 'group';
    return { mode, target: ['private', 'role'].includes(mode) && typeof data.target === 'string' ? data.target : null,
        sessionId: ['private', 'temporary'].includes(mode) ? String(data.sessionId || 'default').slice(0, 200) : 'default' };
}

/** 只提供当前聊天管理的统计，不创建会话、不调用模型、不读取或保存配置。 */
function createChatContextUsageService({ chat, getGameSnapshot = () => null, getTemporaryConversation = () => null }) {
    function snapshot(data, displayId = null) {
        const scope = normalizeContextScope(data);
        // 工作角色的独立运行时自行维护上下文，不能套用普通LLM聊天的预算。
        if (scope.mode === 'role') return { scope, usage: null };
        const temporary = scope.mode === 'temporary' ? getTemporaryConversation() : null;
        if (scope.mode === 'temporary' && (!temporary?.id || scope.sessionId !== temporary.id)) return { scope, usage: null };
        const options = { ...scope, templateTarget: scope.mode === 'private' ? scope.target : null,
            temporaryRoleName: temporary?.roleName };
        Object.assign(options, resolveChatContextOptions(chat, options));
        if (temporary) options.historyMessages = temporary.history;
        if (displayId) options.systemPrompt = buildGameSystemPrompt(getGameSnapshot(displayId), options.systemPrompt);
        return { scope, usage: chat.getContextUsage('', options) };
    }
    function handle(ws, data, displayId = null) {
        if (data?.type !== 'getChatContextUsage') return false;
        try {
            const result = snapshot(data, displayId || data.displayId || null);
            ws.send(JSON.stringify({ type: 'chatContextUsage', requestId: data.requestId || null, ...result }));
        } catch (error) {
            ws.send(JSON.stringify({ type: 'chatContextUsage', requestId: data.requestId || null,
                scope: normalizeContextScope(data), usage: null }));
        }
        return true;
    }
    return { handle, snapshot };
}

module.exports = { createChatContextUsageService, resolveChatContextOptions, normalizeContextScope };
