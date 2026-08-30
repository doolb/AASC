const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

test('控制端 Chat2API 弹窗包含登录、账号和 API Key 管理流程', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8');
  assert.match(source, /window\.Chat2APIControl/);
  assert.match(source, /\/api\/chat2api\/oauth\/start/);
  assert.match(source, /\/api\/chat2api\/oauth\/complete/);
  assert.match(source, /window\.open/);
  assert.match(source, /\/api\/chat2api\/api-keys/);
});
