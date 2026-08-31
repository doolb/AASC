'use strict';

const REPAIR_CONFIRMATIONS = new Set(['确认', '是', '好的']);
const REPAIR_CANCELLATIONS = new Set(['取消', '拒绝']);

function createRepairModeState() {
    return {
        state: 'inactive',
        role: null,
        pendingText: null,
        expiresAt: null
    };
}

function normalizeRepairInput(text) {
    return String(text || '')
        .trim()
        .replace(/[\s。，！？、；：,.!?;:]+$/gu, '');
}

function beginRepairModeEntry(currentState, options = {}) {
    const state = { ...createRepairModeState(), ...(currentState || {}) };
    if (!options.passwordConfigured) {
        return { state, event: { type: 'passwordUnavailable' } };
    }

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const timeoutMs = Number.isFinite(options.passwordTimeoutMs) ? options.passwordTimeoutMs : 30000;
    return {
        state: {
            ...state,
            state: 'awaitingPassword',
            role: options.role || null,
            pendingText: null,
            expiresAt: now + timeoutMs
        },
        event: { type: 'passwordRequired' }
    };
}

function verifyRepairModePassword(currentState, password, expectedPassword, options = {}) {
    const state = { ...createRepairModeState(), ...(currentState || {}) };
    if (state.state !== 'awaitingPassword') return { state, event: null };

    if (normalizeRepairInput(password) !== normalizeRepairInput(expectedPassword)) {
        return { state: createRepairModeState(), event: { type: 'passwordRejected' } };
    }
    if (options.roleAvailable === false) {
        return { state: createRepairModeState(), event: { type: 'roleUnavailable' } };
    }

    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const timeoutMs = Number.isFinite(options.sessionTimeoutMs) ? options.sessionTimeoutMs : 180000;
    return {
        state: {
            ...state,
            state: 'active',
            pendingText: null,
            expiresAt: now + timeoutMs
        },
        event: { type: 'entered' }
    };
}

function handleRepairModeInput(currentState, text, now = Date.now()) {
    const state = { ...createRepairModeState(), ...(currentState || {}) };
    if (state.state !== 'active') return { state, event: null };

    const normalizedText = normalizeRepairInput(text);
    if (normalizedText === '退出修复模式') {
        return { state: createRepairModeState(), event: { type: 'exited' } };
    }
    if (!normalizedText) return { state, event: null };

    if (state.pendingText) {
        if (REPAIR_CONFIRMATIONS.has(normalizedText)) {
            return {
                state: { ...state, pendingText: null },
                event: { type: 'confirmed', role: state.role, text: state.pendingText }
            };
        }
        if (REPAIR_CANCELLATIONS.has(normalizedText)) {
            return {
                state: { ...state, pendingText: null },
                event: { type: 'cancelled' }
            };
        }
        return { state, event: { type: 'confirmationRequired', text: state.pendingText, repeat: true } };
    }

    return {
        state: { ...state, pendingText: String(text).trim() },
        event: { type: 'confirmationRequired', text: String(text).trim() }
    };
}

module.exports = {
    REPAIR_CONFIRMATIONS,
    REPAIR_CANCELLATIONS,
    createRepairModeState,
    normalizeRepairInput,
    beginRepairModeEntry,
    verifyRepairModePassword,
    handleRepairModeInput
};
