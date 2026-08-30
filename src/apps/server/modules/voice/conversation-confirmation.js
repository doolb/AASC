'use strict';

const MANUAL_CONFIRMATION_TIMEOUT_MS = 30000;
const AUTO_CONFIRMATION_WINDOW_MS = 7000;
const VALID_MODES = new Set(['off', 'manual', 'auto']);

function normalizeConversationConfirmationMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return VALID_MODES.has(mode) ? mode : 'off';
}

function parseConversationConfirmationAction(text) {
    const normalized = String(text || '')
        .trim()
        .replace(/[。，！？、；：,.!?;:]+$/gu, '');
    if (normalized.includes('取消') || normalized.includes('拒绝')) return 'cancel';
    if (['确认', '确认添加', '是', '好的'].includes(normalized)) return 'confirm';
    return null;
}

function createPendingConversationConfirmation(text, displayId, mode, now = Date.now()) {
    const normalizedMode = normalizeConversationConfirmationMode(mode);
    return {
        id: `conversation_${now}_${Math.random().toString(36).slice(2, 8)}`,
        displayId: displayId || null,
        text: String(text || ''),
        mode: normalizedMode,
        createdAt: now,
        expiresAt: normalizedMode === 'manual' ? now + MANUAL_CONFIRMATION_TIMEOUT_MS : null,
        cancelUntil: null,
        status: 'pending'
    };
}

function markConversationConfirmationTtsFinished(record, now = Date.now()) {
    if (!record || record.status !== 'pending' || record.mode !== 'auto') {
        return record;
    }
    return {
        ...record,
        cancelUntil: now + AUTO_CONFIRMATION_WINDOW_MS
    };
}

function isConversationConfirmationExpired(record, now = Date.now()) {
    if (!record || record.status !== 'pending') return true;
    if (record.mode === 'manual') {
        return Number.isFinite(record.expiresAt) && now >= record.expiresAt;
    }
    if (record.mode === 'auto') {
        return Number.isFinite(record.cancelUntil) && now >= record.cancelUntil;
    }
    return true;
}

function resolveConversationConfirmation(record, action, now = Date.now()) {
    if (!record || record.status !== 'pending') {
        return { action: 'pending', record };
    }

    if (action === 'cancel') {
        if (record.mode === 'auto' && !Number.isFinite(record.cancelUntil)) {
            return { action: 'pending', record };
        }
        if (isConversationConfirmationExpired(record, now)) {
            return { action: 'confirm', record };
        }
        return { action: 'cancel', record };
    }

    if (action === 'confirm') {
        if (isConversationConfirmationExpired(record, now)) {
            return { action: record.mode === 'auto' ? 'confirm' : 'cancel', record };
        }
        return { action: 'confirm', record };
    }

    if (action === 'timeout' && isConversationConfirmationExpired(record, now)) {
        return { action: record.mode === 'auto' ? 'confirm' : 'cancel', record };
    }

    return { action: 'pending', record };
}

module.exports = {
    AUTO_CONFIRMATION_WINDOW_MS,
    MANUAL_CONFIRMATION_TIMEOUT_MS,
    createPendingConversationConfirmation,
    isConversationConfirmationExpired,
    markConversationConfirmationTtsFinished,
    normalizeConversationConfirmationMode,
    parseConversationConfirmationAction,
    resolveConversationConfirmation
};
