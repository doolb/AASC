const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname,
  '../../../android-display/app/src/main/java/com/aasc/display/DoubaoWebViewNodePrepare.kt'),'utf8');
const script = source.match(/val script = """([\s\S]*?)"""\.trimIndent\(\)/u)[1];
const { createDoubaoChatAdapter } = require('./chat2api-doubao-chat-adapter');
const { Readable } = require('node:stream');

test('实际APK签名脚本通过SDK取得新参数，准备消息不访问网络',async()=>{
  let network=0;
  const context={Request,Response,Headers,URL,setTimeout,clearTimeout,
    location:{href:'https://www.doubao.com/chat/',origin:'https://www.doubao.com'},
    navigator:{userAgent:'Mozilla/5.0 Android test',userAgentData:{brands:[{brand:'Chromium',version:'132'}],mobile:true,platform:'Android'}},
    fetch:async()=>{network++;return new Response('{}');}};
  context.window=context;vm.runInNewContext(script,context);
  const bottom=context.fetch;
  // 模拟官网SDK签名后再调用文档开始时保留的fetch引用，覆盖真实入口的调用关系。
  context.fetch=(url,options)=>bottom(url+'&a_bogus=current_sdk_signature',options);
  const body=JSON.stringify({option:{unique_key:'current'},messages:['早']});
  const prepared=await context.__aascDoubaoPrepareRequest('https://www.doubao.com/chat/completion?aid=497858',{
    method:'POST',headers:{'content-type':'application/json'},body});
  assert.equal(network,0);
  assert.match(prepared.url,/a_bogus=current_sdk_signature/u);
  assert.equal(prepared.headers['sec-ch-ua-mobile'],'?1');
  assert.equal(prepared.headers['user-agent'],context.navigator.userAgent);
  assert.equal('cookie' in prepared.headers,false);
  assert.equal('body' in prepared,false);
  // SDK丢失本轮标识也必须拒绝，不能穿透到网络把准备操作变成发送。
  context.fetch=(url,options)=>bottom(url,{...options,body:'{}'});
  await assert.rejects(context.__aascDoubaoPrepareRequest('https://www.doubao.com/chat/completion',{
    method:'POST',headers:{},body}));
  assert.equal(network,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(context.__aascDoubaoPrepareRequest('https://www.doubao.com/chat/completion',{
    method:'POST',headers:{},body,signal:controller.signal}));
  assert.equal(network,0);
});

test('直连先取得当次签名，再由Node HTTP2发消息；准备失败不发送',async()=>{
  const credentials={cookie:'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456',
    nodeProfile:{deviceId:'123',webId:'456',fp:'verify_mock_123456',userAgent:'Mozilla/5.0 Android WebView test'}};
  const input={account:{accountId:'test',providerId:'doubaochat',credentials},provider:{id:'doubaochat'},
    request:{model:'doubao',messages:[{role:'user',content:'早'}]},actualModel:'doubao'};
  let preparedCount=0,sentCount=0;
  const adapter=createDoubaoChatAdapter({prepareNodeRequest:async args=>{
    preparedCount++;assert.equal(sentCount,0);
    assert.equal(args.prepared.data.messages[0].content_block[0].content.text_block.text,'早');
    return {...args.prepared,doubaoHttp2:true,url:args.prepared.url+'&a_bogus=fresh'};
  },httpClient:{request(){throw Error('不能切换其它传输');}},http2Client:{request:async args=>{
    sentCount++;assert.equal(preparedCount,1);assert.match(args.url,/a_bogus=fresh/u);
    return {status:200,headers:{'content-type':'text/event-stream'},data:Readable.from([
      'event: CHUNK_DELTA\ndata: {"text":"早上好"}\n\nevent: SSE_REPLY_END\ndata: {}\n\n'])};
  }}});
  assert.equal((await adapter(input)).body.choices[0].message.content,'早上好');
  assert.equal(sentCount,1);
  const failed=createDoubaoChatAdapter({prepareNodeRequest:async()=>{throw Object.assign(Error('prepare'),{code:'doubao_android_prepare'});},
    httpClient:{request(){throw Error('不得发送');}},http2Client:{request(){throw Error('不得发送');}}});
  await assert.rejects(()=>failed(input),e=>e.code==='doubao_android_prepare');
});
