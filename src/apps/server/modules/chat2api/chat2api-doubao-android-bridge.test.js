'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createDoubaoAndroidBridge } = require('./chat2api-doubao-android-bridge');
const credentials = { cookie: `sessionid=${'s'.repeat(32)}; s_v_web_id=verify_mock_123456`,
  nodeProfile: { deviceId: '123', webId: '456', fp: 'verify_mock_123456',
    userAgent: 'Mozilla/5.0 Android WebView test' } };

test('Android 网页桥按账号身份发送固定官网请求并逐块返回 SSE', async () => {
  let request;
  const bridge = createDoubaoAndroidBridge({ port: 19092, token: 'f'.repeat(64), accountId: 'one',
    fetchClient: async (url, options) => {
      request = { url, options };
      return { ok: true, body: Readable.from([
        '{"type":"response","status":200,"headers":{"content-type":"text/event-stream"}}\n',
        '{"type":"chunk","chunk":"event: SSE_ACK\\ndata: {}\\n\\n"}\n',
        '{"type":"end"}\n',
      ].map(item => Buffer.from(item))) };
    } });
  const response = await bridge.request({ account: { accountId: 'one', providerId: 'doubaochat',
    credentials },
  prepared: { url: 'https://www.doubao.com/chat/completion?aid=1', data: { messages: [] },
    headers: { 'Content-Type': 'application/json; encoding=utf-8' } } });
  let body = '';
  for await (const chunk of response.data) body += chunk.toString();
  assert.equal(response.status, 200);
  assert.match(body, /SSE_ACK/u);
  assert.equal(request.url, 'http://127.0.0.1:19092/fetch');
  assert.equal(JSON.parse(request.options.body).sessionId, 's'.repeat(32));
  assert.equal(JSON.parse(request.options.body).maxBytes, 8 * 1024 * 1024);
  assert.equal(JSON.parse(request.options.body).contentType, 'application/json; encoding=utf-8');
  assert.equal(JSON.parse(request.options.body).restore.nodeProfile.deviceId, '123');
  assert.equal(JSON.parse(request.options.body).restore.cookieSnapshot['https://www.doubao.com'], credentials.cookie);
  assert.equal(request.options.headers.Authorization, `Bearer ${'f'.repeat(64)}`);
  await bridge.stop();
});

test('Android 网页桥拒绝跨来源 URL 与账号错配', async () => {
  const bridge = createDoubaoAndroidBridge({ port: 19092, token: 'f'.repeat(64), accountId: 'one',
    fetchClient: async () => { throw new Error('不应联网'); } });
  const account = { accountId: 'one', providerId: 'doubaochat',
    credentials: { cookie: `sessionid=${'s'.repeat(32)}` } };
  await assert.rejects(() => bridge.request({ account,
    prepared: { url: 'https://example.test/chat/completion', data: {} } }),
  { code: 'doubao_browser_invalid_url' });
  await assert.rejects(() => bridge.request({ account: { ...account, accountId: 'two' },
    prepared: { url: 'https://www.doubao.com/chat/completion', data: {} } }),
  { code: 'doubao_android_account' });
});

test('Android Node签名准备只接收同身份动态参数，Cookie和消息保持在Node', async () => {
  let requested;
  const url = 'https://www.doubao.com/chat/completion?aid=497858&device_id=123&web_id=456&fp=verify_mock_123456';
  let packet = { type: 'prepared', url: url + '&X-Bogus=fresh_x&a_bogus=fresh_a', headers: {
    origin: 'https://www.doubao.com', 'user-agent': credentials.nodeProfile.userAgent,
    'content-type': 'application/json', accept: '*/*',
  } };
  const bridge = createDoubaoAndroidBridge({ port:19092,token:'f'.repeat(64),fetchClient:async (address,options) => {
    requested={address,options};
    return { ok:true,body:Readable.from([Buffer.from(JSON.stringify(packet)+'\n{"type":"end"}\n')]) };
  } });
  const prepared={url,data:{messages:['只在Node发送']},headers:{Cookie:credentials.cookie,'x-flow-trace':'stale'}};
  const args={account:{accountId:'one',providerId:'doubaochat',credentials},prepared};
  const result=await bridge.prepare(args);
  assert.equal(requested.address,'http://127.0.0.1:19092/prepare');
  assert.equal(result.headers.Cookie,credentials.cookie);
  assert.equal(result.headers['x-flow-trace'],undefined);
  assert.equal(result.data,prepared.data);
  assert.equal(result.doubaoHttp2,true);
  for(const change of [{url:packet.url.replace('device_id=123','device_id=999')},
    {headers:{...packet.headers,cookie:'untrusted'}},{headers:{...packet.headers,origin:'https://evil.test'}}]) {
    const saved=packet;packet={...packet,...change};
    await assert.rejects(()=>bridge.prepare(args),error=>error.code==='doubao_android_prepare');packet=saved;
  }
});

test('关闭开关只进入prepare；收到原生关闭确认才成功，旧APK明确提示更新',async()=>{
  const url='https://www.doubao.com/chat/completion?aid=497858&device_id=123&web_id=456&fp=verify_mock_123456';
  let acknowledged=true,lastBody;
  const bridge=createDoubaoAndroidBridge({port:19092,token:'f'.repeat(64),fetchClient:async(address,options)=>{
    lastBody=JSON.parse(options.body);
    const values=address.endsWith('/prepare')?[{type:'prepared',url:url+'&a_bogus=current',headers:{
      origin:'https://www.doubao.com','user-agent':credentials.nodeProfile.userAgent}},
      {type:'end',...(acknowledged?{webViewClosed:true}:{})}]
      :[{type:'response',status:200,headers:{}},{type:'end'}];
    return {ok:true,body:Readable.from(values.map(item=>Buffer.from(JSON.stringify(item)+'\n')))};
  }});
  const args={account:{accountId:'one',providerId:'doubaochat',credentials},
    prepared:{url,data:{messages:[]},headers:{Cookie:credentials.cookie}}};
  await bridge.prepare({...args,closeAfterPrepare:true});assert.equal(lastBody.closeAfterPrepare,true);
  acknowledged=false;
  await assert.rejects(()=>bridge.prepare({...args,closeAfterPrepare:true}),error=>error.code==='doubao_android_upgrade_required');
  await bridge.prepare(args);assert.equal(lastBody.closeAfterPrepare,false);
  const response=await bridge.request({...args,closeAfterPrepare:true});for await(const value of response.data)void value;
  assert.equal(Object.hasOwn(lastBody,'closeAfterPrepare'),false);
});
