'use strict';

const assert = require('assert');
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

console.log('display-voice-builtins.test.js: 10/10 passed');
