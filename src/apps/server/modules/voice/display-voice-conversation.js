'use strict';

// 显示端语音会话的纯状态逻辑。服务端和单元测试共用，避免把唤醒词判断散落在 WebSocket 分支中。
const CONVERSATION_TIMEOUT_MS = 180000;

function createConversationState(listeningEnabled = true) {
    return {
        state: listeningEnabled ? 'waitingWake' : 'disabled',
        target: null,
        lastValidInputAt: null
    };
}

function normalizeConversationText(text) {
    return String(text || '')
        .trim()
        .replace(/[\s。，！？、；：,.!?;:]+$/gu, '')
        .replace(/[\s。，！？、；：,.!?;:]+/gu, '');
}

function uniqueAssistantNames(assistants) {
    return [...new Set((Array.isArray(assistants) ? assistants : [])
        .map(name => String(name || '').trim())
        .filter(Boolean))];
}

function parseConversationCommand(text, assistants) {
    const normalized = normalizeConversationText(text);
    const names = uniqueAssistantNames(assistants);

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
        if (normalized === `${name}开始对话`) {
            return { type: 'wake', mode: 'private', target: name };
        }
        if (normalized === `${name}你好进入群聊模式`
            || normalized === `你好${name}进入群聊模式`) {
            return { type: 'wake', mode: 'group', target: null };
        }
        if (normalized === `你好${name}` || normalized === `${name}你好`) {
            return { type: 'wake', mode: 'group', target: null };
        }
    }

    return null;
}

function reduceConversationInput(currentState, text, assistants, now = Date.now()) {
    const state = { ...createConversationState(true), ...(currentState || {}) };
    if (state.state === 'disabled') {
        return { accepted: false, state, event: null };
    }

    const command = parseConversationCommand(text, assistants);
    if (state.state === 'waitingWake') {
        if (!command || command.type !== 'wake') {
            return { accepted: false, state, event: null };
        }
        const nextState = {
            ...state,
            state: command.mode === 'private' ? 'activePrivate' : 'activeGroup',
            target: command.target,
            lastValidInputAt: now
        };
        return { accepted: true, state: nextState, event: command };
    }

    if (command?.type === 'end') {
        return {
            accepted: true,
            state: createConversationState(true),
            event: command
        };
    }
    if (command?.type === 'group') {
        return {
            accepted: true,
            state: { ...state, state: 'activeGroup', target: null, lastValidInputAt: now },
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
        state: { ...state, lastValidInputAt: now },
        event: { type: 'input' }
    };
}

function isConversationExpired(state, now = Date.now()) {
    return state?.state === 'activeGroup'
        || state?.state === 'activePrivate'
        ? Number.isFinite(state.lastValidInputAt)
            && now - state.lastValidInputAt >= CONVERSATION_TIMEOUT_MS
        : false;
}

module.exports = {
    CONVERSATION_TIMEOUT_MS,
    createConversationState,
    normalizeConversationText,
    parseConversationCommand,
    reduceConversationInput,
    isConversationExpired
};
