'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config/config.json'), 'utf8'));
const serviceSource = fs.readFileSync(
    path.join(projectRoot, 'src/external/llm/llm-service.js'),
    'utf8'
);

const restoredProfile = config.chat?.llmProfiles?.find((profile) => profile.name === 'qwen3.5');
assert.ok(restoredProfile, 'qwen3.5 profile 必须保留，避免历史记录失去对应配置');
assert.equal(config.chat.activeProfile, 'qwen3.5');
assert.equal(restoredProfile.model, 'Qwen3.6-Flash');
assert.match(serviceSource, /历史展示不能绑定当前 profile/u);

const historyFunction = serviceSource.match(/function getHistory\(\) \{[\s\S]*?\n\}/u)?.[0] || '';
assert.match(historyFunction, /all\.push\(\.\.\.messages\)/u);
assert.doesNotMatch(historyFunction, /message\.profileName === activeProfile/u);

console.log('chat-history-profile-compatibility.test.js: contract checks passed');
