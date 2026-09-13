'use strict';

// 显示端语音会话的纯状态逻辑。服务端和单元测试共用，避免把唤醒词判断散落在 WebSocket 分支中。
const TEMPORARY_CONVERSATION_WINDOW_MS = 30000;
const CONVERSATION_TIMEOUT_MS = 180000;

function createConversationState(listeningEnabled = true) {
    return {
        state: listeningEnabled ? 'waitingWake' : 'disabled',
        target: null,
        lastValidInputAt: null,
        windowType: null,
        expiresAt: null,
        timerPaused: false,
        remainingMs: null
    };
}

function normalizeConversationText(text) {
    return String(text || '')
        .trim()
        // 关键词中间允许停顿、空格、常见标点或符号，统一删除后再做精确匹配。
        .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function uniqueAssistantNames(assistants) {
    return [...new Set((Array.isArray(assistants) ? assistants : [])
        .map(name => String(name || '').trim())
        .filter(Boolean))];
}

function findAddressedAssistant(text, assistants) {
    const normalized = normalizeConversationText(text);
    for (const name of uniqueAssistantNames(assistants)) {
        const remaining = normalized.replace(name, '').trim();
        if (normalized.includes(name) && remaining) {
            return name;
        }
    }
    return null;
}

function parseConversationCommand(text, assistants) {
    const normalized = normalizeConversationText(text);
    // 角色名由调用方沿用现有自动匹配结果传入；这里不假设任何默认角色名。
    const names = uniqueAssistantNames(assistants);

    if (normalized === '开始对话') {
        return { type: 'wake', mode: 'group', windowType: 'conversation', target: null };
    }
    if (normalized === '结束对话') {
        return { type: 'end' };
    }
    if (normalized === '退出私聊') {
        return { type: 'group' };
    }
    if (normalized === '进入群聊模式') {
        return { type: 'group' };
    }

    for (const name of names) {
        const normalizedName = normalizeConversationText(name);
        if (!normalizedName) continue;
        if (normalized === normalizedName) {
            return {
                type: 'wake',
                mode: 'group',
                windowType: 'temporary',
                target: null,
                assistantName: name
            };
        }
        if (normalized === `你好${normalizedName}` || normalized === `${normalizedName}你好`) {
            return { type: 'wake', mode: 'private', windowType: 'conversation', target: name };
        }
        if (normalized === `${normalizedName}再见` || normalized === `再见${normalizedName}`) {
            return { type: 'endPrivate', target: name };
        }
    }

    return null;
}

function reduceConversationInput(currentState, text, assistants, now = Date.now(), options = {}) {
    const state = { ...createConversationState(true), ...(currentState || {}) };
    if (state.state === 'disabled') {
        return { accepted: false, state, event: null };
    }

    const isBuiltin = typeof options.isBuiltin === 'function'
        && options.isBuiltin(text) === true;
    const command = parseConversationCommand(text, assistants);
    if (state.state === 'waitingWake') {
        if (command?.type === 'wake') {
            const nextState = {
                ...state,
                state: command.mode === 'private' ? 'activePrivate' : 'activeGroup',
                target: command.target,
                windowType: command.windowType || 'conversation',
                timerPaused: false,
                remainingMs: null,
                lastValidInputAt: now
            };
            return { accepted: true, state: nextState, event: command };
        }

        const addressedAssistant = findAddressedAssistant(text, assistants);
        if (addressedAssistant) {
            const addressedGroupMode = options.addressedGroupMode === 'oneShot'
                ? 'oneShot'
                : 'temporary';
            if (addressedGroupMode === 'temporary') {
                return {
                    accepted: true,
                    state: {
                        ...state,
                        state: 'activeGroup',
                        target: null,
                        windowType: 'temporary',
                        timerPaused: false,
                        remainingMs: null,
                        lastValidInputAt: now
                    },
                    event: {
                        type: 'input',
                        addressedAssistant,
                        temporaryConversationStarted: true
                    }
                };
            }
            return {
                accepted: true,
                // 助手名只作为这一条消息的接受标识，不把等待唤醒升级为持续群聊。
                state,
                event: { type: 'input', addressedAssistant, oneShotGroup: true }
            };
        }
        if (isBuiltin) {
            return {
                accepted: true,
                state,
                event: { type: 'input', bypassWake: true }
            };
        }
        return { accepted: false, state, event: null };
    }

    if (command?.type === 'end') {
        return {
            accepted: true,
            state: createConversationState(true),
            event: command
        };
    }
    if (command?.type === 'endPrivate') {
        if (state.state !== 'activePrivate') {
            return { accepted: false, state, event: null };
        }
        return {
            accepted: true,
            state: createConversationState(true),
            event: command
        };
    }
    if (command?.type === 'group') {
        return {
            accepted: true,
            state: {
                ...state,
                state: 'activeGroup',
                target: null,
                windowType: 'conversation',
                timerPaused: false,
                remainingMs: null,
                lastValidInputAt: now
            },
            event: command
        };
    }
    if (command?.type === 'wake') {
        return {
            accepted: true,
            state: {
                ...state,
                state: command.mode === 'private' ? 'activePrivate' : 'activeGroup',
                target: command.target,
                windowType: command.windowType || 'conversation',
                timerPaused: false,
                remainingMs: null,
                lastValidInputAt: now
            },
            event: command
        };
    }

    if (!String(text || '').trim()) {
        return { accepted: false, state, event: null };
    }

    return {
        accepted: true,
        state: { ...state, lastValidInputAt: now, timerPaused: false, remainingMs: null },
        event: { type: 'input' }
    };
}

function isConversationExpired(state, now = Date.now()) {
    const timeoutMs = state?.windowType === 'temporary'
        ? TEMPORARY_CONVERSATION_WINDOW_MS
        : CONVERSATION_TIMEOUT_MS;
    return state?.state === 'activeGroup'
        || state?.state === 'activePrivate'
        ? Number.isFinite(state.lastValidInputAt)
            && now - state.lastValidInputAt >= timeoutMs
        : false;
}

module.exports = {
    CONVERSATION_TIMEOUT_MS,
    TEMPORARY_CONVERSATION_WINDOW_MS,
    createConversationState,
    normalizeConversationText,
    parseConversationCommand,
    reduceConversationInput,
    isConversationExpired
};
