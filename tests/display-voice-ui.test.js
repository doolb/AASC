const assert = require('assert');
const fs = require('fs');

const displayHtml = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/display.html',
    'utf8'
);
const displayCss = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/css/display.css',
    'utf8'
);

const statusStart = displayHtml.indexOf('function updateVoiceStatusDisplay()');
const statusEnd = displayHtml.indexOf('function updateVoiceTextDisplay', statusStart);
const statusBody = displayHtml.slice(statusStart, statusEnd);

assert.ok(statusStart >= 0, '显示端应存在语音状态刷新函数');
assert.match(statusBody, /voiceStatus\.textContent\s*=/);
assert.match(statusBody, /未就绪/);
assert.match(statusBody, /监听中/);
assert.match(statusBody, /暂停监听/);
assert.match(statusBody, /ttsRecordingPaused/);
assert.match(statusBody, /setStatus\('paused'/);
assert.match(statusBody, /voiceStatus\.dataset\.state/);
assert.match(displayCss, /\.voice-status-paused\s*\{[\s\S]*?background:\s*#e67e22/);
assert.match(displayCss, /\.voice-status-listening\s*\{[\s\S]*?background:\s*#16a34a/);
assert.match(displayCss, /\.voice-status-paused\s*\{[\s\S]*?color:/);

const statusMarkupIndex = displayHtml.indexOf('id="voiceStatus"');
const statusRowMarkupIndex = displayHtml.indexOf('id="voiceStatusRow"');
const monitorMarkupIndex = displayHtml.indexOf('id="monitorWrapper"');
const voiceTextMarkupIndex = displayHtml.indexOf('id="voiceTextDisplay"');
assert.ok(statusRowMarkupIndex < statusMarkupIndex, '状态行应包含监听状态');
assert.ok(statusMarkupIndex < monitorMarkupIndex, '语音状态应排在柱状图前面');
assert.ok(monitorMarkupIndex < voiceTextMarkupIndex, '柱状图应排在最近识别文本前面');

const rotationStart = displayHtml.indexOf('function applyRotation()');
const rotationEnd = displayHtml.indexOf('// 媒体名、连接状态', rotationStart);
const rotationBody = displayHtml.slice(rotationStart, rotationEnd);

assert.ok(rotationStart >= 0, '显示端应存在旋转布局函数');
assert.match(rotationBody, /monitorWrapper\.style\.transform\s*=\s*['"]rotate\(/);
assert.match(rotationBody, /monitorWrapper\.style\.transformOrigin/);
assert.match(rotationBody, /currentRotation === 90/);
assert.match(rotationBody, /currentRotation === 180/);
assert.match(rotationBody, /currentRotation === 270/);
assert.match(displayHtml, /function applyVoiceTopCenterLayout\(rotationLayout\)/);
assert.match(rotationBody, /applyVoiceTopCenterLayout\(rotationLayout\)/);
const rotationScheduleStart = displayHtml.indexOf('function scheduleRotationTextLayout()');
const rotationScheduleEnd = displayHtml.indexOf('// 监听状态和柱状图组成单行语音状态区', rotationScheduleStart);
const rotationScheduleBody = displayHtml.slice(rotationScheduleStart, rotationScheduleEnd);
assert.doesNotMatch(rotationScheduleBody, /applyVoiceTopCenterLayout\(/, '文本更新时不应重置语音文字锚点');
assert.match(rotationScheduleBody, /applyVoiceCenteredAnchor\(voiceTextDisplay/u, '文本更新时应同步稳定语音文字锚点');
assert.match(displayHtml, /\[voiceStatusRow, voiceTextDisplay\][\s\S]*?element\.style\.left\s*=\s*'50%'/);
assert.match(displayCss, /\.voice-status-row\s*\{[\s\S]*?display:\s*flex[\s\S]*?justify-content:\s*center[\s\S]*?flex-wrap:\s*nowrap/);
assert.match(displayCss, /\.monitor-wrapper\s*\{[\s\S]*?position:\s*static[\s\S]*?align-items:\s*center/);
assert.match(displayCss, /#voiceStatus\s*\{[\s\S]*?white-space:\s*nowrap[\s\S]*?max-width:\s*180px/);
assert.match(displayHtml, /element\.style\.right\s*=\s*offset/);
assert.match(displayHtml, /element\.style\.top\s*=\s*'50%'/);
assert.match(displayHtml, /translateX\(-50%\)/);
assert.match(displayHtml, /element\.style\.transform = 'rotate\(90deg\)'/);
assert.match(displayHtml, /element\.style\.transform = 'rotate\(270deg\)'/);
assert.match(displayHtml, /const VOICE_MONITOR_WIDTH\s*=\s*140/);
assert.match(displayHtml, /monitorWrapper\.style\.width\s*=\s*`\$\{VOICE_MONITOR_WIDTH\}px`/);
assert.match(displayHtml, /voiceStatusRow[\s\S]*?voiceTextDisplay[\s\S]*?element\.style\.top\s*=\s*offset/);

const monitorStart = displayHtml.indexOf('function drawMonitor');
const monitorEnd = displayHtml.indexOf('function sendCanvasSize', monitorStart);
const monitorBody = displayHtml.slice(monitorStart, monitorEnd);

assert.ok(monitorStart >= 0, '显示端应存在音频监视图绘制函数');
assert.match(monitorBody, /function animateMonitor\(timestamp/);
assert.match(monitorBody, /requestAnimationFrame\(animateMonitor\)/);
assert.match(monitorBody, /monitorDataArray\s*=\s*new Uint8Array/);
assert.match(monitorBody, /drawIdleMonitor\(monitorTime\)/);
assert.doesNotMatch(monitorBody, /const data\s*=\s*new Uint8Array\(analyser\.frequencyBinCount\)/);

assert.match(displayCss, /\.voice-status-paused\s*\{/);
assert.match(displayCss, /#voiceStatus[\s\S]*?transition:/);
assert.match(displayHtml, /<canvas id="mini-monitor" width="140" height="50">/);

console.log('display-voice-ui.test.js: voice state, rotation and monitor contracts passed');
