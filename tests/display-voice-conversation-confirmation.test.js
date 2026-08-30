'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const voiceCommand = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

assert.strictEqual(typeof voiceCommand.getConversationConfirmationMode, 'function');
assert.strictEqual(typeof voiceCommand.setConversationConfirmationMode, 'function');
assert.ok(voiceCommand.getBuiltinVoiceCommands().some(command => command.examples.includes('开启自动确认')));
assert.ok(voiceCommand.getBuiltinVoiceCommands().some(command => command.examples.includes('开启对话确认')));
assert.deepStrictEqual(voiceCommand.handleSystemCommand('开启对话确认'), {
    type: 'conversationConfirmationMode',
    mode: 'manual'
});
assert.deepStrictEqual(voiceCommand.handleSystemCommand('开启自动确认'), {
    type: 'conversationConfirmationMode',
    mode: 'auto'
});
assert.deepStrictEqual(voiceCommand.handleSystemCommand('关闭对话确认'), {
    type: 'conversationConfirmationMode',
    mode: 'off'
});

const serverSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);
assert.match(serverSource, /conversationConfirmationMode/u);
assert.match(serverSource, /getConversationConfirmationConfig/u);
assert.match(serverSource, /setConversationConfirmationConfig/u);
assert.match(serverSource, /conversationConfirmation/u);
assert.match(serverSource, /createPendingConversationConfirmation/u);
assert.match(serverSource, /handlePendingConversationConfirmation/u);
assert.match(serverSource, /onPlaybackStarted/u);
assert.match(serverSource, /handleConversationConfirmationPlaybackFinished/u);
assert.doesNotMatch(serverSource, /playbackTargetIds\.includes\(displayId\)/u);
const ttsFinishedHandlerStart = serverSource.indexOf("data.type === 'voiceConversationTtsFinished'");
const ttsFinishedHandlerEnd = serverSource.indexOf("data.type === 'voiceTtsPlaybackFinished'", ttsFinishedHandlerStart);
assert.doesNotMatch(
    serverSource.slice(ttsFinishedHandlerStart, ttsFinishedHandlerEnd),
    /beginAutoConversationConfirmationWindow/u,
    '自动确认不能使用来源显示端的会话 TTS 完成事件提前启动'
);

const displaySource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'),
    'utf8'
);
assert.match(displaySource, /conversationConfirmation/u);
assert.match(displaySource, /showVoiceResponsePopup/u);
assert.match(displaySource, /voice-conversation-countdown-confirmation/u);
assert.doesNotMatch(displaySource, /5秒内无回复将自动确认/u);
assert.match(displaySource, /请说确认或取消/u);
const displayCss = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/css/display.css'),
    'utf8'
);
assert.match(displayCss, /voice-conversation-countdown[\s\S]*background:/u);
const confirmationCountdownCssStart = displayCss.indexOf('.voice-conversation-countdown-confirmation');
const confirmationCountdownCssEnd = displayCss.indexOf('#voiceStatus', confirmationCountdownCssStart);
const confirmationCountdownCss = displayCss.slice(confirmationCountdownCssStart, confirmationCountdownCssEnd);
assert.match(confirmationCountdownCss, /background:\s*#991b1b/u);
assert.match(confirmationCountdownCss, /color:\s*#fff/u);
assert.match(confirmationCountdownCss, /font-weight:\s*700/u);
assert.match(displayCss, /:root\[data-theme-mode="light"\]\s+\.voice-conversation-countdown-confirmation[\s\S]*background:\s*#fee2e2/u);
assert.match(displayCss, /:root\[data-theme-mode="light"\]\s+\.voice-conversation-countdown-confirmation[\s\S]*color:\s*#991b1b/u);

const deviceListSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/device-list.js'),
    'utf8'
);
const voiceprintPanelSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js'),
    'utf8'
);
const websocketSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/websocket.js'),
    'utf8'
);
const uploadSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/upload.html'),
    'utf8'
);
const displayPanelStart = uploadSource.indexOf('<section class="panel" id="panel-display"');
const displayPanelEnd = uploadSource.indexOf('<section class="panel" id="panel-task"', displayPanelStart);
const voiceprintPanelStart = uploadSource.indexOf('<section class="panel" id="panel-voiceprint"');
const voiceprintPanelEnd = uploadSource.indexOf('</section>', voiceprintPanelStart);
const displayPanelHtml = uploadSource.slice(displayPanelStart, displayPanelEnd);
const voiceprintPanelHtml = uploadSource.slice(voiceprintPanelStart, voiceprintPanelEnd);

assert.doesNotMatch(displayPanelHtml, /voiceConversationConfirmationPanel/u);
assert.match(voiceprintPanelHtml, /voiceConversationConfirmationPanel/u);
assert.match(voiceprintPanelHtml, /语音对话确认/u);
assert.match(voiceprintPanelSource, /renderConversationConfirmationPanel/u);
assert.match(voiceprintPanelSource, /setConversationConfirmationMode/u);
assert.match(voiceprintPanelSource, /handleConversationConfirmationConfig/u);
assert.doesNotMatch(deviceListSource, /renderConversationConfirmationPanel|handleConversationConfirmationConfig/u);
assert.match(websocketSource, /VoiceprintPanel\.handleConversationConfirmationConfig/u);
assert.match(voiceprintPanelHtml, /class="control-item voiceprint-card"/u);
assert.ok(
    (voiceprintPanelHtml.match(/class="control-item voiceprint-card"/gu) || []).length >= 6,
    '声纹页面主要设置应统一使用大卡片'
);
assert.match(uploadSource, /voice-confirmation-settings/u);
assert.match(fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/css/upload.css'),
    'utf8'
), /\.voiceprint-card/u);

console.log('display-voice-conversation-confirmation.test.js: 10/10 passed');
