'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);
const config = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../config/config.json'),
    'utf8'
));

assert.match(server, /handleRepairModeDisplayInput\(displayId, data\.text\.trim\(\)\)/);
assert.match(server, /verifyRepairModePassword\(currentState, text, repairConfig\.password/);
assert.match(server, /aiRoles\.list\(\)\.some/);
assert.match(server, /aiRoles\.chat\(role, text/);
assert.match(server, /allowRepairModeTts: true/);
assert.match(server, /data\.type === 'tts'[\s\S]*?options\.allowRepairModeTts !== true/);
assert.match(server, /getDisplayIds: getOnlineVoicePlaybackDisplayIds/);
assert.match(server, /generateTTS: \(ttsText\) => generateTtsWithFallback\(ttsText\)/);
assert.equal(typeof config.repairMode?.password, 'string');
assert.equal(config.repairMode?.role, 'mainfront');

console.log('repair-mode-server-contract.test.js: contract checks passed');
