'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    isBuiltinVoiceCommand,
    getBuiltinVoiceCommands,
    getVoiceCommandHelpText
} = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

assert.strictEqual(isBuiltinVoiceCommand('现在几点？'), true);
assert.strictEqual(isBuiltinVoiceCommand('系统。'), true);
assert.strictEqual(isBuiltinVoiceCommand('请告诉我今天天气怎么样'), true);
assert.strictEqual(isBuiltinVoiceCommand('你好，今天过得怎么样'), false);
assert.strictEqual(isBuiltinVoiceCommand('你好小爱'), false);
assert.strictEqual(isBuiltinVoiceCommand('退出私聊'), false);

const builtinCommands = getBuiltinVoiceCommands();
assert.ok(builtinCommands.some(command => command.examples.includes('系统')));
const helpText = getVoiceCommandHelpText({
    commands: {
        '早安': ['报时', '今日提醒']
    }
});
assert.match(helpText, /现在几点/);
assert.match(helpText, /早安/);
assert.match(helpText, /今日提醒/);

const serverSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);
const helpStart = serverSource.indexOf("if (result.type === 'showHelp')");
const helpEnd = serverSource.indexOf("} else if (result.type === 'commandMode')", helpStart);
assert.ok(helpStart >= 0 && helpEnd > helpStart, '应能定位系统帮助处理分支');
const helpHandler = serverSource.slice(helpStart, helpEnd);
assert.match(helpHandler, /sendVoiceInputTtsSentences\(helpTTS\)/);
assert.match(helpHandler, /sendVoiceCommandTtsSentences\(helpTTS, targetDisplayId\)/);
assert.doesNotMatch(helpHandler, /sendVoiceInputTts\(helpTTS\)/);
const responseIndex = helpHandler.indexOf("action: 'response'");
const ttsWaitIndex = helpHandler.indexOf('await sendVoiceInputTtsSentences(helpTTS)');
const directedTtsWaitIndex = helpHandler.indexOf('await sendVoiceCommandTtsSentences(helpTTS, targetDisplayId)');
assert.ok(responseIndex >= 0, '系统帮助应向目标显示端发送完整响应文本');
assert.ok(responseIndex < ttsWaitIndex, '显示端系统帮助弹窗应先于通用 TTS 生成下发');
assert.ok(responseIndex < directedTtsWaitIndex, '控制端系统帮助弹窗应先于定向 TTS 生成下发');

console.log('display-voice-builtins.test.js: 16/16 passed');
