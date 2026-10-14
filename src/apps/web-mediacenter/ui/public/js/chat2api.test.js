const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('node:vm');

const nativeControlFixture = () => {
  const context = { window: {}, document: { getElementById: () => null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8'), context);
  const control = context.window.Chat2APIControl;
  control.loginSession = { state: 'sample-state', providerId: 'doubaochat' };
  const requests = [], messages = [];
  let refreshes = 0;
  control.request = async (endpoint, options) => {
    requests.push({ endpoint, body: JSON.parse(options.body) });
    return { account: { accountInfo: { credentialVerification: 'format-only' } } };
  };
  control.message = text => messages.push(text);
  control.refresh = async () => { refreshes++; control.message(''); };
  return { control, requests, messages, refreshes: () => refreshes };
};

test('Android完成回调提交原生凭据一次，刷新后保留保存提示', async () => {
  for (const providerId of ['doubaochat', 'qwen']) {
    const fixture = nativeControlFixture();
    fixture.control.loginSession.providerId = providerId;
    await fixture.control.completeNativeLogin({ success: true, state: 'sample-state', providerId, credentials: { cookie: 'fictional-cookie' } });
    assert.deepEqual(fixture.requests, [{ endpoint: '/api/chat2api/oauth/complete', body: {
      state: 'sample-state', providerId, credentials: { cookie: 'fictional-cookie' },
    } }]);
    assert.equal(fixture.refreshes(), 1);
    assert.equal(fixture.control.loginSession, null);
    assert.match(fixture.messages.at(-1), /账号已保存/);
  }
});

test('Android取消、错会话、保存失败保留等待会话且不误报成功', async () => {
  for (const packet of [{ success: false }, { success: true, state: 'wrong', providerId: 'doubaochat' }]) {
    const fixture = nativeControlFixture();
    await fixture.control.completeNativeLogin(packet);
    assert.equal(fixture.requests.length, 0);
    assert.ok(fixture.control.loginSession);
  }
  const fixture = nativeControlFixture();
  fixture.control.request = async () => { throw new Error('模拟保存失败'); };
  await fixture.control.completeNativeLogin({ success: true, state: 'sample-state', providerId: 'doubaochat', credentials: {} });
  assert.ok(fixture.control.loginSession);
  assert.equal(fixture.refreshes(), 0);
  assert.equal(fixture.messages.at(-1), '模拟保存失败');
});

test('豆包验证按钮按指定账号复验，重复点击只请求一次，状态不夸大聊天能力', async () => {
  const { control, messages } = nativeControlFixture();
  assert.equal(control.accountStatus({ providerId: 'doubaochat', accountInfo: { credentialVerification: 'conversation-list' } }), '会话列表已验证');
  assert.equal(control.accountStatus({ providerId: 'qwen-api' }), '已配置，未远端验证');
  let release;
  const calls = [];
  control.request = async (endpoint, options) => {
    calls.push({ endpoint, method: options.method });
    return new Promise(resolve => { release = resolve; });
  };
  const pending = control.verifyAccount('doubao:test@example.com');
  await control.verifyAccount('doubao:test@example.com');
  assert.equal(calls.length, 1);
  release({ account: { providerId: 'doubaochat', accountInfo: { credentialVerification: 'format-only', credentialVerificationError: 'risk' } } });
  await pending;
  assert.deepEqual(calls, [{ endpoint: '/api/chat2api/accounts/doubao%3Atest%40example.com/verify', method: 'POST' }]);
  assert.match(messages.at(-1), /未验证/);
  assert.match(fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8'), /data-chat2api-account-verify/);
});

test('控制端 Chat2API 弹窗包含登录、账号和 API Key 管理流程', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8');
  assert.match(source, /window\.Chat2APIControl/);
  assert.match(source, /\/api\/chat2api\/oauth\/start/);
  assert.match(source, /\/api\/chat2api\/oauth\/complete/);
  assert.match(source, /window\.open/);
  assert.match(source, /\/api\/chat2api\/api-keys/);
  assert.match(source, /chat2apiSaveConfig/);
  assert.match(source, /chat2apiExportConfig/);
  assert.match(source, /chat2apiImportConfig/);
  assert.match(source, /chat2apiExportAccounts/);
  assert.match(source, /chat2apiImportAccounts/);
  assert.match(source, new RegExp('/api/chat2api/accounts/export'));
  assert.match(source, new RegExp('/api/chat2api/accounts/import/preview'));
  assert.match(source, new RegExp('/api/chat2api/accounts/import/merge'));
  assert.match(source, /openChat2ApiAccountWeb/);
  assert.match(source, /data-chat2api-account-web/);
  assert.match(source, new RegExp('/api/chat2api/export'));
  assert.match(source, new RegExp('/api/chat2api/import/preview'));
  assert.match(source, new RegExp('/api/chat2api/import/merge'));
  assert.match(source, /data-chat2api-account-toggle/);
  assert.match(source, /导入原 Chat2API 数据/);
  assert.match(source, new RegExp('/api/chat2api/import/legacy/preview'));
  assert.match(source, new RegExp('/api/chat2api/import/legacy/merge'));
  assert.match(source, new RegExp('api/chat2api-gateway'));
  assert.match(source, /instanceId/);
  assert.match(source, /chat2apiConfigDebugRawTraffic/);
  assert.match(source, /chat2apiConfigRawTrafficMaxBytes/);
  assert.match(source, /chat2apiConfigRawTrafficMode/);
  assert.match(source, /debugRawTraffic/);
  assert.match(source, /rawTrafficMaxBytes/);
  assert.match(source, /rawTrafficMode/);
  assert.match(source, /compact/);
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

test('控制端显示 Android 控制端开关并发送按设备的更新消息', () => {
  const source = fs.readFileSync(path.join(__dirname, 'display-list.js'), 'utf8');

  assert.match(source, /setAndroidControlPage/);
  assert.match(source, /androidControlPageOpen/);
  assert.match(source, /开放 Android 控制端/);
});

test('Chat2API Android 登录优先调用 NativeControl，未提供桥接时保留手工回退', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8');

  assert.match(source, /openChat2ApiLogin/);
  assert.match(source, /completeNativeLogin/);
  assert.match(source, /window\.open/);
});

test('Chat2API 导出在 Android WebView 优先交给原生 Download 保存并保留浏览器回退', () => {
  const source = fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8');

  assert.match(source, /saveDownloadFile/);
  assert.match(source, /saveExportBlob/);
  assert.match(source, /blobToBase64/);
  assert.match(source, /chat2api-accounts-\$\{stamp\}\.json/);
  assert.match(source, /chat2api-config-\$\{stamp\}\.json/);
});

test('模型映射编辑保存往返合成默认值，旧文字映射不新增应用字段', async () => {
  const suffixes = ['Editor', 'Model', 'ActualModel', 'Provider', 'Account', 'Application', 'Voice', 'Speed', 'Volume', 'Format', 'EditorTitle', 'Cancel'];
  const inputs = Object.fromEntries(suffixes.map(name => {
    let inputValue = '';
    return [`chat2apiMapping${name}`, { get value() { return inputValue; }, set value(value) { inputValue = String(value); }, focus() {} }];
  }));
  const context = { window: {}, document: { getElementById: id => inputs[id] || null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'chat2api.js'), 'utf8'), context);
  const control = context.window.Chat2APIControl;
  const writes = [];
  // 只替代管理 API 网络边界；编辑器填值、收集字段及校验仍运行正式实现。
  control.request = async (endpoint, options) => writes.push({ endpoint, options: JSON.parse(options.body) });
  control.refresh = async () => {};
  const mapping = { model: 'qiaoxiaojiao', actualModel: 'qwen-api/qwen-audio-3.1-tts-flash',
    preferredProviderId: 'qwen-api', preferredAccountId: 'sample-account', application: 'tts',
    parameters: { voice: 'qiaoxiaojiao_v3.1', speed: 1.25, volume: 0, format: 'wav' } };
  control.openMappingEditor(mapping);
  await control.saveModelMapping();
  assert.deepEqual(writes[0], { endpoint: '/api/chat2api/model-mappings', options: mapping });
  control.openMappingEditor({ model: 'qwen3.6flash', actualModel: 'Qwen3.6', preferredProviderId: 'qwen' });
  await control.saveModelMapping();
  assert.deepEqual(writes[1].options, { model: 'qwen3.6flash', actualModel: 'Qwen3.6', preferredProviderId: 'qwen' });
});
