'use strict';

const assert = require('assert');
const {
    isBuiltinVoiceCommand
} = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

assert.strictEqual(isBuiltinVoiceCommand('现在几点？'), true);
assert.strictEqual(isBuiltinVoiceCommand('请告诉我今天天气怎么样'), true);
assert.strictEqual(isBuiltinVoiceCommand('你好，今天过得怎么样'), false);
assert.strictEqual(isBuiltinVoiceCommand('你好小爱'), false);
assert.strictEqual(isBuiltinVoiceCommand('退出私聊'), false);

console.log('display-voice-builtins.test.js: 5/5 passed');
