const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const source = fs.readFileSync(path.resolve(__dirname,
  '../../../android-display/app/src/main/java/com/aasc/display/Chat2ApiDoubaoRequestCapture.kt'), 'utf8');
// 执行实际随APK发布的脚本，使用原生Request/Response复现立即消费竞态。
const script = source.match(/val script = """([\s\S]*?)"""\.trimIndent\(\)/u)[1];
const run = async ({ requestObject = true, old = false, ack = '12345678', error = false,
  authorize = true, cleanupFails = false } = {}) => {
  const posts = [], deletions = [];
  const responseText = `${ack ? `event: SSE_ACK\ndata: ${JSON.stringify({ ack_client_meta: { conversation_id: ack } })}\n\n` : ''}`
    + `event: CHUNK_DELTA\ndata: {"text":"早上好"}\n\n`
    + (error ? 'event: STREAM_ERROR\ndata: {"code":1}\n\n' : 'event: SSE_REPLY_END\ndata: {}\n\n');
  const bridge = { postMessage(raw) {
    const value = JSON.parse(raw); posts.push(value);
    if (value.type === 'sample' && authorize) queueMicrotask(() => bridge.onmessage({
      data: JSON.stringify({ type: 'cleanup', sampleId: value.sampleId }),
    }));
  } };
  const context = { Request, Response, Headers, URL, URLSearchParams, TextDecoder, AbortController,
    crypto: webcrypto, setTimeout, clearTimeout, navigator: { userAgent: 'Mozilla/5.0 Android WebView test' },
    location: { origin: 'https://www.doubao.com', href: 'https://www.doubao.com/chat' },
    AASCDoubaoCapture: bridge,
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('/im/conversation/')) {
        deletions.push({ url, ...init });
        return Response.json({ status_code: cleanupFails && deletions.length === 1 ? 712012002 : 0 });
      }
      // 原始fetch立即消费Request，观察器若晚克隆会抛错。
      if (input instanceof Request) await input.text();
      return new Response(responseText, { headers: { 'content-type': 'text/event-stream' } });
    },
  };
  context.window = context;
  vm.runInNewContext(script, context);
  const body = JSON.stringify({ client_meta: { conversation_id: old ? 'old-id' : '' },
    option: { need_create_conversation: !old }, messages: [{ content_block: [{ content: { text_block: { text: '早' } } }] }] });
  const url = 'https://www.doubao.com/chat/completion?aid=497858&device_id=123&web_id=456&fp=verify_test&a_bogus=old';
  const init = { method: 'POST', body, headers: { 'content-type': 'application/json; encoding=utf-8' } };
  const response = await context.fetch(requestObject ? new Request(url, init) : url, requestObject ? undefined : init);
  assert.equal(await response.text(), responseText, '官网立即读取原响应不受影响');
  for (let i = 0; i < 50 && !posts.some(item => item.type === 'cleanup'); i++) {
    if ((old || !ack || error || !authorize) && i > 5) break;
    await delay(5);
  }
  return { posts, deletions, context };
};
for (const requestObject of [true, false]) test(`Android真实捕获脚本先克隆再消费，Request=${requestObject}`, async () => {
  const result = await run({ requestObject });
  assert.equal(result.posts[0].type, 'sample');
  assert.equal(result.posts[0].headers['user-agent'], 'Mozilla/5.0 Android WebView test');
  assert.equal(result.posts.at(-1).success, true);
  assert.equal(result.deletions.length, 1);
  const deletion = result.deletions[0];
  assert.equal(deletion.headers['Content-Type'], 'application/json; encoding=utf-8');
  assert.equal(new URL(deletion.url, 'https://www.doubao.com').searchParams.has('a_bogus'), false);
  assert.deepEqual(JSON.parse(deletion.body).uplink_body.batch_delete_user_conversation_uplink_body,
    { conversation_id: ['12345678'], delete_all: false, conversation_type: 3 });
});
test('旧会话、失败流、缺少ACK及未授权样本不删除', async () => {
  for (const options of [{ old: true }, { error: true }, { ack: '' }, { ack: 'unsafe/id' }, { authorize: false }]) {
    const result = await run(options);
    await result.context.__aascDoubaoRetryCleanup();
    assert.equal(result.deletions.length, 0);
  }
});
test('删除业务失败保留样本，重试同一个ID；成功后不重复删除', async () => {
  const result = await run({ cleanupFails: true });
  assert.equal(result.posts.at(-1).success, false);
  await result.context.__aascDoubaoRetryCleanup();
  assert.equal(result.posts.at(-1).success, true);
  assert.equal(result.deletions.length, 2);
  assert.deepEqual(JSON.parse(result.deletions[0].body).uplink_body,
    JSON.parse(result.deletions[1].body).uplink_body);
  await result.context.__aascDoubaoRetryCleanup();
  assert.equal(result.deletions.length, 2);
});
