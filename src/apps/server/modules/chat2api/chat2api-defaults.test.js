const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_MODEL_MAPPINGS } = require('./chat2api-default-model-mappings');
const { createChat2ApiModelMapper } = require('./chat2api-model-mapper');
const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiProviderRegistry } = require('./chat2api-provider-registry');
const { createChat2ApiLoadBalancer } = require('./chat2api-load-balancer');
const { createChat2ApiCoreAdapter } = require('./chat2api-core-adapter');

async function fixture(t, rows = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-defaults-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyDataPath = path.join(root, 'legacy.json');
  await fs.writeFile(legacyDataPath, JSON.stringify({ accounts: rows }));
  const options = { rootDir: path.join(root, 'store'), legacyDataPath, restoreLegacyAccounts: true };
  return { root, options, store: createChat2ApiDataStore(options) };
}
const legacyQwen = { id: 'legacy-qwen', name: '虚构测试账号', providerId: 'qwen', credentials: { ticket: 'synthetic-ticket' }, enabled: true, status: 'active' };

test('空映射使用含三档专用别名的内置规则，未知模型保持原值', async () => {
  const mapper = createChat2ApiModelMapper({ dataStore: { readCollection: async () => [] } });
  assert.equal(DEFAULT_MODEL_MAPPINGS.length, 13);
  for (const rule of DEFAULT_MODEL_MAPPINGS) {
    const resolved = await mapper.resolveModel(rule.model.toUpperCase());
    assert.equal(resolved.actualModel, rule.actualModel);
    assert.equal(resolved.preferredProviderId, rule.providerId);
  }
  assert.equal((await mapper.resolveModel('custom-unknown')).actualModel, 'custom-unknown');
  assert.equal((await mapper.resolveModel('aasc-qwen-mini')).actualModel, 'Qwen3.6-Flash');
  assert.equal((await mapper.resolveModel('Qwen3.6-Flash')).actualModel, 'Qwen3.7');
});

test('自定义精确与通配规则覆盖内置及Provider规则，保留账号偏好', async () => {
  const mapper = createChat2ApiModelMapper({ dataStore: { readCollection: async () => [
    { model: 'doubao*', actualModel: 'doubao-think', providerId: 'doubaochat', preferredAccountId: 'chosen' },
    { model: 'Qwen3.6', actualModel: 'custom-upstream', providerId: 'qwen' }
  ] } });
  assert.equal((await mapper.resolveModel('doubao-expert')).preferredAccountId, 'chosen');
  assert.equal((await mapper.resolveModel('Qwen3.6', { id: 'qwen', modelMappings: { 'Qwen3.6': 'Qwen' } })).actualModel, 'custom-upstream');
});

test('有效默认列表只读，保存覆盖大小写去重，删除后恢复默认', async t => {
  const { store, options } = await fixture(t);
  assert.equal((await store.listEffectiveModelMappings()).length, 13);
  assert.deepEqual(await store.listModelMappings(), []);
  await assert.rejects(fs.stat(path.join(options.rootDir, 'model-mappings.json')), { code: 'ENOENT' });
  await store.saveModelMapping({ model: 'Qwen3.6-Flash', actualModel: 'first', providerId: 'qwen', builtinDefault: true });
  await store.saveModelMapping({ model: 'qwen3.6-flash', actualModel: 'custom', providerId: 'qwen' });
  assert.equal((await store.listModelMappings()).length, 1);
  assert.equal((await store.listModelMappings())[0].builtinDefault, undefined);
  await store.deleteModelMapping('QWEN3.6-FLASH');
  assert.equal((await store.listEffectiveModelMappings()).find(row => row.model === 'Qwen3.6-Flash').actualModel, 'Qwen3.7');
});

test('旧资料并发恢复一次，删除后重新创建存储也不复活', async t => {
  const { store, options } = await fixture(t, [legacyQwen]);
  const batches = await Promise.all(Array.from({ length: 8 }, () => store.listAccounts()));
  assert.ok(batches.every(rows => rows.length === 1 && rows[0].secretConfigured));
  assert.equal((await store.getAccount('legacy-qwen')).credentials.ticket, 'synthetic-ticket');
  await store.deleteAccount('legacy-qwen');
  assert.deepEqual(await createChat2ApiDataStore(options).listAccounts(), []);
});

test('已有禁用账号不被旧资料替换，自定义目录不隐式恢复', async t => {
  const { store, options } = await fixture(t, [legacyQwen]);
  await store.saveAccount({ accountId: 'current', providerId: 'qwen', enabled: false, credentials: { ticket: 'synthetic-current' } });
  const rows = await store.listAccounts();
  assert.deepEqual(rows.map(row => row.accountId), ['current']);
  assert.equal(rows[0].enabled, false);
  const isolated = createChat2ApiDataStore({ ...options, rootDir: path.join(options.rootDir, '../isolated'), restoreLegacyAccounts: undefined });
  assert.deepEqual(await isolated.listAccounts(), []);
});

test('虚构旧账号无需映射和账号指定即可完成真实调度，无资料时提示登录', async t => {
  const { store } = await fixture(t, [legacyQwen]);
  const providerRegistry = createChat2ApiProviderRegistry({ dataStore: store });
  const modelMapper = createChat2ApiModelMapper({ dataStore: store });
  const loadBalancer = createChat2ApiLoadBalancer({ dataStore: store, providerRegistry, modelMapper });
  let calls = 0;
  const core = createChat2ApiCoreAdapter({ dataStore: store, providerRegistry, modelMapper, loadBalancer,
    providerAdapters: { qwen: async ({ actualModel, account }) => {
      calls += 1; assert.equal(actualModel, 'Qwen3.7'); assert.equal(account.accountId, 'legacy-qwen');
      return { body: { choices: [{ message: { role: 'assistant', content: 'OK' } }] } };
    } } });
  assert.ok((await core.listModels()).data.some(row => row.id === 'Qwen3.6-Flash'));
  const result = await core.forwardChatCompletion({ model: 'Qwen3.6-Flash', messages: [{ role: 'user', content: '虚构测试' }] });
  assert.equal(result.body.choices[0].message.content, 'OK'); assert.equal(calls, 1);
  await store.deleteAccount('legacy-qwen');
  await assert.rejects(core.forwardChatCompletion({ model: 'Qwen3.6-Flash', messages: [{ role: 'user', content: '虚构测试' }] }), /请先.*登录/);
});
