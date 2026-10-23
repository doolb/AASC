'use strict';

/** 棋局属于业务聊天范围；模型配置切换不改变聊天归属。 */
function normalizeGameChatScope(value = {}) {
    const mode = value.mode || 'group';
    return { mode,
        target: ['private', 'role'].includes(mode) ? String(value.target || value.templateTarget || '') : null,
        sessionId: ['private', 'temporary'].includes(mode) ? String(value.sessionId || 'default') : null };
}

function matchesGameChatScope(owner, requested) {
    if (!owner) return false;
    const scope = normalizeGameChatScope(requested);
    const normalized = normalizeGameChatScope(owner);
    return normalized.mode === scope.mode && normalized.target === scope.target
        && (!requested.sessionId || normalized.sessionId === scope.sessionId);
}

module.exports = { normalizeGameChatScope, matchesGameChatScope };
