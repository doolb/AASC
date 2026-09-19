'use strict';

// 临时会话历史的默认范围：最多保留 10 组已结束会话，模型请求携带当前组和最近 2 组历史。
const DEFAULT_TEMPORARY_HISTORY_GROUPS = 10;
const DEFAULT_TEMPORARY_CONTEXT_GROUPS = 3;
const MIN_TEMPORARY_HISTORY_GROUPS = 1;
const MAX_TEMPORARY_HISTORY_GROUPS = 100;
const MIN_TEMPORARY_CONTEXT_GROUPS = 1;
const MAX_TEMPORARY_CONTEXT_GROUPS = 20;

function normalizeGroupLimit(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.min(maximum, Math.max(minimum, number)));
}

function normalizeTemporaryConversationHistoryConfig(config = {}) {
    return {
        temporaryHistoryGroups: normalizeGroupLimit(
            config.temporaryHistoryGroups,
            DEFAULT_TEMPORARY_HISTORY_GROUPS,
            MIN_TEMPORARY_HISTORY_GROUPS,
            MAX_TEMPORARY_HISTORY_GROUPS
        ),
        temporaryContextGroups: normalizeGroupLimit(
            config.temporaryContextGroups,
            DEFAULT_TEMPORARY_CONTEXT_GROUPS,
            MIN_TEMPORARY_CONTEXT_GROUPS,
            MAX_TEMPORARY_CONTEXT_GROUPS
        )
    };
}

function normalizeTemporaryHistoryMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message?.mode === 'temporary' && String(message.sessionId || '').trim())
        .map(message => ({ ...message }))
        .sort((left, right) => {
            const timestampDiff = Number(left.timestamp || 0) - Number(right.timestamp || 0);
            if (timestampDiff !== 0) return timestampDiff;
            return String(left.id || '').localeCompare(String(right.id || ''));
        });
}

function groupTemporaryConversationMessages(messages) {
    const groups = new Map();
    for (const message of normalizeTemporaryHistoryMessages(messages)) {
        const sessionId = String(message.sessionId).trim();
        if (!groups.has(sessionId)) {
            groups.set(sessionId, {
                sessionId,
                startedAt: Number(message.timestamp || 0),
                endedAt: Number(message.timestamp || 0),
                messages: []
            });
        }
        const group = groups.get(sessionId);
        group.startedAt = Math.min(group.startedAt, Number(message.timestamp || 0));
        group.endedAt = Math.max(group.endedAt, Number(message.timestamp || 0));
        group.messages.push(message);
    }
    return [...groups.values()].sort((left, right) => {
        const timestampDiff = left.endedAt - right.endedAt;
        if (timestampDiff !== 0) return timestampDiff;
        return left.sessionId.localeCompare(right.sessionId);
    });
}

/**
 * 根据当前临时会话 ID选择历史上下文。
 * 当前会话组始终优先保留，contextGroups 表示发送给模型的会话组总数，
 * historyGroups 只限制已结束历史组数量，避免把当前正在进行的会话误算为历史。
 */
function selectTemporaryConversationHistory(messages, currentSessionId, config = {}) {
    const limits = normalizeTemporaryConversationHistoryConfig(config);
    const groups = groupTemporaryConversationMessages(messages);
    const normalizedCurrentId = String(currentSessionId || '').trim();
    const currentGroup = groups.find(group => group.sessionId === normalizedCurrentId) || null;
    const historicalGroups = groups
        .filter(group => group.sessionId !== normalizedCurrentId)
        .slice(-limits.temporaryHistoryGroups);
    const contextHistoryCount = Math.max(
        0,
        limits.temporaryContextGroups - (currentGroup ? 1 : 0)
    );
    const contextGroups = historicalGroups.slice(-contextHistoryCount);
    if (currentGroup) contextGroups.push(currentGroup);

    return {
        ...limits,
        groups,
        historicalGroups,
        contextGroups,
        messages: contextGroups.flatMap(group => group.messages)
    };
}

function getTemporaryConversationHistoryGroups(messages, currentSessionId, config = {}) {
    const selected = selectTemporaryConversationHistory(messages, currentSessionId, config);
    return selected.historicalGroups.slice().reverse().map(group => {
        const roleMessage = group.messages.find(message => message.roleName);
        const assistantMessage = group.messages.find(message => (
            message.role === 'assistant' && message.name && message.name !== '助手'
        ));
        return {
            sessionId: group.sessionId,
            startedAt: group.startedAt,
            endedAt: group.endedAt,
            roleName: roleMessage?.roleName || assistantMessage?.name || null,
            messageCount: group.messages.length,
            messages: group.messages.map(message => ({ ...message }))
        };
    });
}

module.exports = {
    DEFAULT_TEMPORARY_HISTORY_GROUPS,
    DEFAULT_TEMPORARY_CONTEXT_GROUPS,
    MIN_TEMPORARY_HISTORY_GROUPS,
    MAX_TEMPORARY_HISTORY_GROUPS,
    MIN_TEMPORARY_CONTEXT_GROUPS,
    MAX_TEMPORARY_CONTEXT_GROUPS,
    normalizeGroupLimit,
    normalizeTemporaryConversationHistoryConfig,
    normalizeTemporaryHistoryMessages,
    groupTemporaryConversationMessages,
    selectTemporaryConversationHistory,
    getTemporaryConversationHistoryGroups
};
