'use strict';

const assert = require('assert');
const {
    AUTO_CONFIRMATION_WINDOW_MS,
    MANUAL_CONFIRMATION_TIMEOUT_MS,
    createPendingConversationConfirmation,
    markConversationConfirmationTtsFinished,
    parseConversationConfirmationAction,
    normalizeConversationConfirmationMode,
    resolveConversationConfirmation
} = require('./conversation-confirmation');

assert.strictEqual(normalizeConversationConfirmationMode('off'), 'off');
assert.strictEqual(normalizeConversationConfirmationMode('manual'), 'manual');
assert.strictEqual(normalizeConversationConfirmationMode('auto'), 'auto');
assert.strictEqual(normalizeConversationConfirmationMode('unknown'), 'off');
assert.strictEqual(parseConversationConfirmationAction('确认。'), 'confirm');
assert.strictEqual(parseConversationConfirmationAction('好的'), 'confirm');
assert.strictEqual(parseConversationConfirmationAction('取消。'), 'cancel');
assert.strictEqual(parseConversationConfirmationAction('拒绝'), 'cancel');
assert.strictEqual(parseConversationConfirmationAction('你好吗'), null);

const manual = createPendingConversationConfirmation('原始语音', 'display-a', 'manual', 1000);
assert.strictEqual(manual.expiresAt, 1000 + MANUAL_CONFIRMATION_TIMEOUT_MS);
assert.deepStrictEqual(resolveConversationConfirmation(manual, 'confirm', 2000), {
    action: 'confirm',
    record: manual
});
assert.deepStrictEqual(resolveConversationConfirmation(manual, 'cancel', 2000), {
    action: 'cancel',
    record: manual
});
assert.deepStrictEqual(resolveConversationConfirmation(manual, 'timeout', manual.expiresAt), {
    action: 'cancel',
    record: manual
});

const auto = createPendingConversationConfirmation('自动确认原文', 'display-a', 'auto', 5000);
assert.strictEqual(auto.cancelUntil, null);
const afterTts = markConversationConfirmationTtsFinished(auto, 9000);
assert.strictEqual(afterTts.cancelUntil, 9000 + AUTO_CONFIRMATION_WINDOW_MS);
assert.deepStrictEqual(resolveConversationConfirmation(afterTts, 'cancel', 10000), {
    action: 'cancel',
    record: afterTts
});
assert.deepStrictEqual(resolveConversationConfirmation(afterTts, 'timeout', afterTts.cancelUntil), {
    action: 'confirm',
    record: afterTts
});

console.log('conversation-confirmation.test.js: 10/10 passed');
