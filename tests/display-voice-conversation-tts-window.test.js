'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const timerStart = source.indexOf('function getDisplayConversationRemainingMs(');
const timerEnd = source.indexOf('function normalizeDisplayChatVoiceContext(', timerStart);
const playbackStart = source.indexOf('function clearDisplayConversationTtsPlaybackKey(');
const playbackEnd = source.indexOf('function restoreOfflineChatSelection(', playbackStart);
assert.ok(timerStart >= 0 && timerEnd > timerStart && playbackStart >= 0 && playbackEnd > playbackStart);

function createTimerHarness() {
    const displayId = 'display-1';
    const displayData = { state: { voiceConversation: {
        state: 'activeGroup', windowType: 'temporary', expiresAt: 31000,
        timerPaused: false, remainingMs: null
    } } };
    const displayClients = new Map([[displayId, displayData]]);
    const displayConversationTimers = new Map([[displayId, 1]]);
    const displayConversationTtsPlaybackKeys = new Map();
    const displayConversationTtsGenerationTokens = new Map();
    const messages = [];
    let nextTimer = 1;
    const context = {
        Date: { now: () => 1000 },
        displayClients, displayConversationTimers,
        displayConversationTtsPlaybackKeys, displayConversationTtsGenerationTokens,
        clearDisplayConversationTimer: id => displayConversationTimers.delete(id),
        getVoiceConversationWindowMs: () => 30000,
        setDisplayConversationState: (id, state, reason) => {
            displayClients.get(id).state.voiceConversation = state;
            messages.push({ reason, state });
        },
        setTimeout: () => ++nextTimer,
        isDisplayVoiceListeningEnabled: () => true,
        log: () => {}
    };
    vm.runInNewContext(source.slice(timerStart, timerEnd), context);
    vm.runInNewContext(source.slice(playbackStart, playbackEnd), context);
    return { context, displayId, displayData, displayConversationTimers,
        displayConversationTtsPlaybackKeys, messages };
}

test('分段生成期间和段间空队列事件不启动临时窗口，末段播完后完整计时', () => {
    const harness = createTimerHarness();
    const { context, displayId, displayData, displayConversationTimers,
        displayConversationTtsPlaybackKeys } = harness;
    const token = context.beginDisplayConversationTtsGeneration(displayId);
    assert.equal(displayData.state.voiceConversation.timerPaused, true);
    assert.equal(displayConversationTimers.has(displayId), false);
    assert.equal(context.handleVoiceConversationTtsFinished(displayId, displayData), false);

    const firstPlaybackKey = `${displayId}:first-sentence`;
    displayConversationTtsPlaybackKeys.set(displayId, new Set([firstPlaybackKey]));
    context.clearDisplayConversationTtsPlaybackKey(displayId, firstPlaybackKey);
    assert.equal(displayConversationTimers.has(displayId), false);
    assert.equal(context.handleVoiceConversationTtsFinished(displayId, displayData), false);

    const playbackKey = `${displayId}:last-sentence`;
    displayConversationTtsPlaybackKeys.set(displayId, new Set([playbackKey]));
    context.endDisplayConversationTtsGeneration(displayId, token);
    assert.equal(displayConversationTimers.has(displayId), false);
    assert.equal(context.handleVoiceConversationTtsFinished(displayId, displayData), false);

    context.clearDisplayConversationTtsPlaybackKey(displayId, playbackKey);
    assert.equal(displayData.state.voiceConversation.timerPaused, false);
    assert.equal(displayData.state.voiceConversation.expiresAt, 31000);
    assert.equal(displayConversationTimers.has(displayId), true);
    const timer = displayConversationTimers.get(displayId);
    assert.equal(context.handleVoiceConversationTtsFinished(displayId, displayData), false);
    assert.equal(displayConversationTimers.get(displayId), timer);
});

test('生成失败且无音频时释放暂停，不让临时窗口永久冻结', () => {
    const { context, displayId, displayData, displayConversationTimers } = createTimerHarness();
    const token = context.beginDisplayConversationTtsGeneration(displayId);
    context.endDisplayConversationTtsGeneration(displayId, token);
    assert.equal(displayData.state.voiceConversation.timerPaused, false);
    assert.equal(displayConversationTimers.has(displayId), true);
});

test('普通聊天流和语音命令分句均覆盖完整生成区间', () => {
    const chatStart = source.indexOf('async function handleChatMessage(options)');
    const chatEnd = source.indexOf('async function sendSearchTts(', chatStart);
    const chatHandler = source.slice(chatStart, chatEnd);
    assert.match(chatHandler, /beginDisplayConversationTtsGeneration\(voiceOriginDisplayId\)/u);
    assert.match(chatHandler, /finally\s*\{[\s\S]*ttsScheduler\.waitForIdle\(\)[\s\S]*Promise\.allSettled\(pendingTtsDeliveryPromises\)[\s\S]*endDisplayConversationTtsGeneration\(voiceOriginDisplayId, voiceGenerationToken\)/u);
    assert.match(chatHandler, /pendingTtsDeliveryPromises\.push\(deliveryPromise\)/u);
    const voiceTtsStart = source.indexOf('async function sendVoiceTtsSentences(');
    const voiceTtsEnd = source.indexOf('async function sendControlVoiceTtsSentences(', voiceTtsStart);
    const voiceTtsHandler = source.slice(voiceTtsStart, voiceTtsEnd);
    assert.match(voiceTtsHandler, /beginDisplayConversationTtsGeneration\(conversationDisplayId\)/u);
    assert.match(voiceTtsHandler, /finally\s*\{\s*endDisplayConversationTtsGeneration\(conversationDisplayId, generationToken\)/u);
});
