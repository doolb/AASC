'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('聊天 TTS 协议包含会话代次和 think/answer 阶段打断', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const filter = read('src/external/llm/think-output-filter.js');
    const llm = read('src/external/llm/llm-service.js');
    const agentTts = read('src/apps/server/modules/chat/agent-chat-tts.js');

    assert.match(server, /chatTtsGenerationStates/);
    assert.match(server, /function\s+buildChatTtsConversationId/);
    assert.match(server, /function\s+stopChatTtsPlayback/);
    assert.match(server, /chatTtsPhase/);
    assert.match(server, /phase:\s*'think'/);
    assert.match(server, /stopChatTtsPlayback\(\{[\s\S]*phase:\s*'think'/);
    assert.match(filter, /speechSegments/);
    assert.match(llm, /onSentence\?\.\(text, fullMessage, fullReasoning, fullSpeech, pendingSpeech\.phase\)/);
    assert.match(agentTts, /isTtsCurrent/);
});

test('显示端和控制端只清理当前聊天会话的 TTS', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const displayChat = read('src/apps/web-mediacenter/ui/public/js/display-chat.js');
    const stage = read('src/apps/web-mediacenter/ui/public/js/display-stage.js');
    const chat = read('src/apps/web-mediacenter/ui/public/js/chat.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');

    assert.match(display, /id="displayChatTtsStop"/);
    assert.match(display, /function\s+stopChatTtsPlayback\(conversationId, phase = null\)/);
    assert.match(display, /data\.chatOnly && data\.chatTtsConversationId/);
    assert.match(displayChat, /function\s+stopConversationTts/);
    assert.match(displayChat, /chatOnly:\s*true/);
    assert.match(stage, /root\.DisplayChat\?\.stopConversationTts/);
    assert.match(chat, /stopChatTts\(\{ phase = null, notify = false, sendRemote = true \}/);
    assert.match(chat, /handleStopChatTts/);
    assert.match(websocket, /data\.type === 'stopChatTts'/);
});

test('Offline APK 只在前台按十分钟周期检查更新', () => {
    const activity = read('src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt');

    assert.match(activity, /OFFLINE_UPDATE_CHECK_INTERVAL_MS = 10 \* 60 \* 1_000L/);
    assert.match(activity, /onResume\(\)[\s\S]*runOfflineUpdateChecksIfReady\(\)[\s\S]*scheduleOfflineUpdateChecks\(\)/);
    assert.match(activity, /onPause\(\)[\s\S]*removeCallbacks\(offlineUpdateCheckRunnable\)/);
    assert.match(activity, /mainHandler\.postDelayed\(this, OFFLINE_UPDATE_CHECK_INTERVAL_MS/);
    assert.match(activity, /if \(!activityResumed\) return/);
});
