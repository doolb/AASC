const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiQwenHistoryService, normalizeConversation } = require('./chat2api-qwen-history-service');

const createDataStore = (accounts, account = accounts[0]) => ({
  listAccounts: async () => accounts,
  getAccount: async () => account,
});

test('Qwen 网页会话导入保存原始记录并生成可复用的标准消息', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-qwen-history-'));
  const outputDir = path.join(projectRoot, 'tmp', 'qwen-web-import');
  await fs.mkdir(outputDir, { recursive: true, mode: 0o755 });
  await fs.chmod(outputDir, 0o755);
  const requests = [];
  const httpClient = {
    request: async (options) => {
      requests.push(options);
      const url = new URL(options.url);
      if (url.pathname === '/api/v2/session/page/list') {
        assert.equal(options.method, 'POST');
        assert.equal(options.data.limit, 1);
        return {
          status: 200,
          data: { data: { list: [{ session_id: 'session/1', title: '测试会话', modifiedTime: '2026-09-03T10:00:00Z' }], have_next_page: false } },
        };
      }
      if (url.pathname === '/api/v1/session/top/list') {
        assert.equal(options.method, 'POST');
        assert.deepEqual(options.data, { biz_id: 'ai_qwen' });
        return {
          status: 200,
          data: { data: [{ session_id: 'session/1', top: true }] },
        };
      }
      if (url.pathname === '/api/v1/session/get') {
        assert.deepEqual(options.data, { session_id: 'session/1' });
        return { status: 200, data: { data: { title: '详情标题' } } };
      }
      if (url.pathname === '/api/v1/session/msg/list') {
        assert.equal(url.searchParams.get('session_id'), 'session/1');
        return {
          status: 200,
          data: {
            data: {
              list: [{
                req_id: 'request-1',
                created_at: '2026-09-03T10:00:01Z',
                request_messages: [{ content: '你好' }],
                response_messages: [{ mime_type: 'text/plain', content: '你好，我是 Qwen。', meta_data: { debug_ticket: 'ticket-value' } }],
              }],
              has_next_page: false,
            },
          },
        };
      }
      throw new Error(`unexpected URL: ${options.url}`);
    },
  };
  const service = createChat2ApiQwenHistoryService({
    dataStore: createDataStore([
      { accountId: 'qwen-1', providerId: 'qwen', enabled: true, status: 'active' },
    ], { accountId: 'qwen-1', providerId: 'qwen', credentials: { ticket: 'ticket-value', cookie: 'XSRF-TOKEN=%ZZ' } }),
    providerRegistry: { getProvider: async () => ({ id: 'qwen', historyApiEndpoint: 'https://qwen-history.test' }) },
    httpClient,
    projectRoot,
  });

  try {
    const result = await service.importConversations({ limit: 1 });
    assert.equal(result.total, 1);
    assert.equal(result.imported, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.indexFile, 'tmp/qwen-web-import/index.json');
    assert.equal((await fs.stat(outputDir)).mode & 0o777, 0o700);
    assert.equal(requests.every((request) => request.headers.Cookie.includes('tongyi_sso_ticket=ticket-value')), true);
    assert.equal(requests.every((request) => request.headers['X-Xsrf-Token'] === '%ZZ'), true);

    const index = JSON.parse(await fs.readFile(path.join(projectRoot, result.indexFile), 'utf8'));
    assert.equal(index.files.length, 1);
    assert.equal(index.files[0].pinned, true);
    const conversation = JSON.parse(await fs.readFile(path.join(projectRoot, index.files[0].file), 'utf8')).conversation;
    assert.equal(conversation.title, '测试会话');
    assert.equal(conversation.pinned, true);
    assert.deepEqual(conversation.nativeState, { sessionId: 'session/1', parentReqId: 'request-1' });
    assert.deepEqual(conversation.messages.map(({ role, content }) => ({ role, content })), [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，我是 Qwen。' },
    ]);
    assert.deepEqual(conversation.raw.session, { title: '详情标题' });
    const exportedText = await fs.readFile(path.join(projectRoot, index.files[0].file), 'utf8');
    assert.doesNotMatch(exportedText, /ticket-value/);
    assert.match(exportedText, /REDACTED_QWEN_CREDENTIAL/);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('Qwen 网页会话导入在多个账号时要求明确指定账号', async () => {
  const accounts = [
    { accountId: 'qwen-1', providerId: 'qwen', enabled: true, status: 'active' },
    { accountId: 'qwen-2', providerId: 'qwen', enabled: true, status: 'active' },
  ];
  const service = createChat2ApiQwenHistoryService({
    dataStore: createDataStore(accounts),
    providerRegistry: { getProvider: async () => ({ id: 'qwen' }) },
    httpClient: { request: async () => { throw new Error('must not request'); } },
    projectRoot: os.tmpdir(),
  });

  await assert.rejects(() => service.importConversations(), /多个 Qwen 账号/);
});

test('Qwen 会话标准化按请求时间排序并使用最后一轮原生请求标识', () => {
  const conversation = normalizeConversation({
    id: 'session-ordered',
    metadata: { title: '排序测试' },
    turns: [
      { req_id: 'request-new', request_timestamp: 200, request_messages: [{ content: '后一句' }], response_messages: [{ content: '后回答' }] },
      { req_id: 'request-old', request_timestamp: 100, request_messages: [{ content: '前一句' }], response_messages: [{ content: '前回答' }] },
    ],
  });

  assert.deepEqual(conversation.messages.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: '前一句' },
    { role: 'assistant', content: '前回答' },
    { role: 'user', content: '后一句' },
    { role: 'assistant', content: '后回答' },
  ]);
  assert.equal(conversation.nativeState.parentReqId, 'request-new');
});
