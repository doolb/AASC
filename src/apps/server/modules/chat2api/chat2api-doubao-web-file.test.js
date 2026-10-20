'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { awsHeaders, crc32, createDoubaoWebFileService } = require('./chat2api-doubao-web-file');

const account = { providerId: 'doubaochat', accountId: 'account-1', enabled: true,
  credentials: { cookie: 'sessionid=dummy_session_123456789; passport_csrf_token=dummy_csrf_123456789; s_v_web_id=fingerprint123', nodeProfile: {
    deviceId: '123456789', webId: '987654321', fp: 'fingerprint123',
    userAgent: 'Mozilla/5.0 Test Browser 1.0',
  } } };
const json = body => ({ status: 200, data: Readable.from([JSON.stringify(body)]) });

test('文件上传 AWS V4 签名与参考实现固定样例一致', () => {
  const url = 'https://www.doubao.com/top/v1?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=5&NeedFallback=true&FileSize=9&FileExtension=.txt&s=jdnfglwfkl';
  const headers = awsHeaders({ method: 'GET', url, accessKey: 'AKID', secretKey: 'SECRET',
    sessionToken: 'token', now: new Date('2026-10-20T00:00:00Z') });
  assert.match(headers.Authorization, /Signature=8433fb3b937830bd605e8a77eaeba220ae59ce45094fc825f29a204356e38889$/u);
  assert.equal(crc32(Buffer.from('123456789')), 'cbf43926');
});

test('文件上传依次执行准备、签名申请、存储上传与提交', async () => {
  const paths = [];
  const bridge = { request: async ({ prepared }) => {
    const url = new URL(prepared.url);
    paths.push(`${prepared.method || 'POST'} ${url.pathname} ${url.searchParams.get('Action') || ''}`);
    if (url.pathname === '/alice/resource/prepare_upload') return json({ code: 0, data: {
      service_id: '5', upload_auth_token: { access_key: 'AKID', secret_key: 'SECRET', session_token: 'token' },
    } });
    if (url.searchParams.get('Action') === 'ApplyImageUpload') return json({ Result: { UploadAddress: {
      StoreInfos: [{ StoreUri: 'bucket/object.txt', Auth: 'upload-auth' }],
      UploadHosts: ['tos-mya2lf.vodupload.com'], SessionKey: 'session-key',
    } } });
    return json({ Result: { Results: [{ UriStatus: 2000 }] } });
  } };
  let upload;
  const service = createDoubaoWebFileService({ bridge,
    dataStore: { readCollection: async () => [account] }, accountId: account.accountId,
    fetchClient: async (url, options) => {
      upload = { url, options };
      return { ok: true, json: async () => ({ code: 2000 }) };
    } });
  const result = await service.upload({ filename: 'note.txt', data: Buffer.from('123456789') });
  assert.deepEqual(paths, ['POST /alice/resource/prepare_upload ', 'GET /top/v1 ApplyImageUpload',
    'POST /top/v1 CommitImageUpload']);
  assert.equal(upload.url, 'https://tos-mya2lf.vodupload.com/upload/v1/bucket/object.txt');
  assert.equal(upload.options.headers['Content-CRC32'], 'cbf43926');
  assert.deepEqual(result, { uri: 'bucket/object.txt', name: 'note.txt', size: 9, file_type: 'txt' });
});

test('文件下载地址只能按文件 URI 查询且不允许任意路径', async () => {
  const service = createDoubaoWebFileService({ bridge: { request: async () => json({ code: 0,
    data: { file_urls: [{ main_url: 'https://cdn.example/file' }] } }) },
  dataStore: { readCollection: async () => [account] } });
  assert.deepEqual(await service.downloadUrl('bucket/object.txt'), {
    url: 'https://cdn.example/file', uri: 'bucket/object.txt', expires_in: 3600,
  });
  await assert.rejects(() => service.downloadUrl('../secret'), { code: 'doubao_file_uri' });
});

test('文件问答构造附件消息，并等官网完整 SSE 后返回正文', async () => {
  const requests = [];
  const sse = [
    'event: SSE_ACK\ndata: {"ack_client_meta":{"conversation_id":"conversation1"}}\n\n',
    'event: STREAM_MSG_NOTIFY\ndata: {"message":{"content_block":[{"block_type":10000,"block_id":"block1","content":{"text_block":{"text":"文件摘要"}}}]}}\n\n',
    'event: SSE_REPLY_END\ndata: {}\n\n',
  ].join('');
  const service = createDoubaoWebFileService({ accountId: account.accountId,
    dataStore: { readCollection: async () => [account] },
    bridge: { request: async input => {
      requests.push(input);
      return { status: 200, headers: { 'content-type': 'text/event-stream' },
        data: Readable.from([sse]) };
    } } });
  const result = await service.chatWithFile({ fileId: 'bucket/object.txt', prompt: '请摘要',
    fileName: 'object.txt', fileSize: 9 });
  assert.equal(result.text, '文件摘要');
  assert.equal(result.conversationId, 'conversation1');
  const blocks = requests[0].prepared.data.messages[0].content_block;
  assert.equal(blocks[0].block_type, 10052);
  assert.equal(blocks[0].content.attachment_block.attachments[0].file.uri, 'bucket/object.txt');
  assert.equal(blocks[1].content.text_block.text, '请摘要');
  await assert.rejects(() => service.chatWithFile({ fileId: '../bad', prompt: '读文件' }),
    { code: 'doubao_file_uri' });
});
