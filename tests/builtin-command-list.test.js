'use strict';

const assert = require('assert');
const fs = require('fs');

const voiceCommand = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');
const serverJs = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
const chatJs = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/chat.js', 'utf8');
const websocketJs = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/websocket.js', 'utf8');
const uploadHtml = fs.readFileSync('src/apps/web-mediacenter/ui/public/upload.html', 'utf8');

assert.strictEqual(typeof voiceCommand.getBuiltinVoiceCommands, 'function');
const commands = voiceCommand.getBuiltinVoiceCommands();
assert.ok(commands.length > 0);
assert.ok(commands.some(command => command.examples.includes('现在几点')));
assert.ok(commands.every(command => Array.isArray(command.examples)));
assert.ok(commands.every(command => typeof command.description === 'string' && command.description));

assert.match(serverJs, /getBuiltinVoiceCommands/);
assert.match(serverJs, /type: 'builtinVoiceCommands'/);
assert.match(chatJs, /builtinCommands/);
assert.match(chatJs, /loadBuiltinCommands\(\)/);
assert.match(chatJs, /renderBuiltinCommands\(\)/);
assert.match(websocketJs, /data\.type === 'builtinVoiceCommands'/);
assert.match(uploadHtml, /id="builtinVoiceCommandsList"/);

console.log('builtin-command-list.test.js: 10/10 passed');
