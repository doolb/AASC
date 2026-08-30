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
  assert.match(source, /chat2apiSaveConfig/);
  assert.match(source, /data-chat2api-account-toggle/);
  assert.match(source, /导入原 Chat2API 数据/);
  assert.match(source, new RegExp('/api/chat2api/import/legacy/preview'));
  assert.match(source, new RegExp('/api/chat2api/import/legacy/merge'));
  assert.match(source, new RegExp('api/chat2api-gateway'));
  assert.match(source, /instanceId/);
  assert.match(source, /chat2apiConfigDebugRawTraffic/);
  assert.match(source, /chat2apiConfigRawTrafficMaxBytes/);
  assert.match(source, /debugRawTraffic/);
  assert.match(source, /rawTrafficMaxBytes/);
});

test('控制端 Chat2API 账户管理使用主题语义样式', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8');
  const uploadSource = fs.readFileSync(path.join(__dirname, '..', 'upload.html'), 'utf8');
  const styleSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'chat2api.css'), 'utf8');

  assert.doesNotMatch(source, /style=/);
  assert.match(source, /chat2api-modal/);
  assert.match(source, /chat2api-dialog/);
  assert.match(source, /chat2api-section/);
  assert.match(uploadSource, /css\/chat2api\.css/);
  assert.match(styleSource, /\.chat2api-modal/);
  assert.match(styleSource, /var\(--bg-primary\)/);
  assert.match(styleSource, /var\(--text-primary\)/);
  assert.match(styleSource, /var\(--input-background\)/);
});

test('控制端 Chat2API 支持手动编辑模型映射', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8');

  assert.match(source, /chat2apiMappingEditor/);
  assert.match(source, /chat2apiMappingModel/);
  assert.match(source, /chat2apiMappingActualModel/);
  assert.match(source, /chat2apiMappingProvider/);
  assert.match(source, /chat2apiMappingAccount/);
  assert.match(source, /data-chat2api-mapping-edit/);
  assert.match(source, /async saveModelMapping/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /method: 'POST'/);
  assert.match(source, /model-mappings/);
});
