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

// 这里直接验证缓存边界；上层Responses协议、持久化及取消语义由doubao-responses测试覆盖。
const signatureFixture = (hooks = {}) => {
  const account={accountId:'signature-account',providerId:'doubaochat',credentialRevision:'revision-1',credentials:{
    cookie:'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456',
    nodeProfile:{deviceId:'123',webId:'456',fp:'verify_mock_123456',userAgent:'Mozilla/5.0 Android WebView test'},
  }};
  const calls=[],prepares=[];
  let fail=null;
  const adapter=createDoubaoChatAdapter({limits:hooks.limits,signatureStore:hooks.signatureStore,prepareNodeRequest:async options=>{
    prepares.push(options.prepared);
    await hooks.beforePrepare?.(options,prepares.length);
    return {...options.prepared,url:options.prepared.url+'&a_bogus=signature_'+prepares.length,doubaoHttp2:true};
  },http2Client:{request:async call=>{
    calls.push(call);
    await hooks.beforeSend?.(call,calls.length);
    const custom=await hooks.response?.(call,calls.length);if(custom)return custom;
    if(fail?.code)throw Object.assign(Error('mock transport'),{code:fail.code});
    if(fail?.status)return {status:fail.status};
    const id=call.data.client_meta.conversation_id||'upstream_'+calls.length;
    const events=fail?.sse
      ? 'event: STREAM_ERROR\ndata: {"error_code":710022004}\n\n'
      : 'event: SSE_ACK\ndata: '+JSON.stringify({ack_client_meta:{conversation_id:id}})
        +'\n\nevent: STREAM_MSG_NOTIFY\ndata: {"content":{"content_block":[{"block_type":10040,"block_id":"thinking-end","is_finish":true}]}}\n\nevent: CHUNK_DELTA\ndata: {"text":"早上好"}\n\nevent: SSE_REPLY_END\ndata: {}\n\n';
    return {status:200,headers:{'content-type':'text/event-stream'},data:Readable.from([events])};
  }},httpClient:{request(){throw Error('不能回退其它传输');}}});
  const run=async(session,options={})=>{
    // 每次创建新的responseSession对象，模拟Responses只从存储复制nativeState的真实行为。
    const responseSession=session?{aascConversationId:session.id,nativeState:{...session.state}}:undefined;
    const result=await adapter({account:options.account||account,provider:{id:'doubaochat'},actualModel:options.model||'doubao',
      responseSession,request:{model:options.model||'doubao',messages:[{role:'user',content:options.text||'早'}],stream:!!options.stream}});
    if(session&&!options.stream)session.state={...result.nativeState};
    return result;
  };
  return {account,calls,prepares,run,setFailure:value=>{fail=value;}};
};

test('同账号签名跨新会话及上游复用，凭据与账号变化重新准备',async()=>{
  const f=signatureFixture(),session={id:'aasc-a',state:{}};
  await f.run(session);await f.run(session,{text:'晚上好'});
  await f.run({id:'aasc-b',state:{}});
  assert.equal(f.prepares.length,1);
  assert.equal(f.calls[2].data.client_meta.conversation_id,'');
  assert.notEqual(f.calls[0].data.client_meta.local_conversation_id,f.calls[2].data.client_meta.local_conversation_id);
  const revised={...f.account,credentialRevision:'revision-2'};
  await f.run(session,{account:revised});assert.equal(f.prepares.length,2);
  const updated={...revised,credentials:{...revised.credentials,
    cookie:revised.credentials.cookie.replace('mock_csrf_123456789','mock_csrf_987654321')}};
  await f.run(session,{account:updated});assert.equal(f.prepares.length,3);
  assert.equal(f.calls.at(-1).headers.Cookie,updated.credentials.cookie);
  await f.run({id:session.id,state:{}},{account:{...f.account,accountId:'another-account'}});
  assert.equal(f.prepares.length,4);
  session.state={...session.state,conversationId:'new-upstream'};
  await f.run(session,{account:updated});assert.equal(f.prepares.length,4);
  session.state={};await f.run(session,{account:updated});assert.equal(f.prepares.length,4);
  const restarted=signatureFixture();await restarted.run(session,{account:updated});
  assert.equal(restarted.prepares.length,1);
});

test('HTTP与SSE失败最多补发一次；取消不补发且保留已确认签名',async()=>{
  for(const failure of [{status:401},{status:403},{status:429},{sse:true}]){
    const f=signatureFixture(),session={id:'aasc-failure',state:{}};
    await f.run(session);f.setFailure(failure);
    if(failure.sse){
      const result=await f.run(session,{stream:true});
      await assert.rejects(async()=>{for await(const chunk of result.stream)void chunk;},error=>error.code==='doubao_risk_control');
    }else await assert.rejects(()=>f.run(session));
    assert.equal(f.calls.length,3);assert.equal(f.prepares.length,2);
    assert.deepEqual(f.calls[1].data,f.calls[2].data);
    assert.notEqual(f.calls[1].url,f.calls[2].url);
    f.setFailure(null);await f.run(session);
    assert.equal(f.prepares.length,3);
  }
  const f=signatureFixture(),session={id:'aasc-retain',state:{}};
  await f.run(session);f.setFailure({code:'doubao_cancelled'});
  await assert.rejects(()=>f.run(session),error=>error.code==='doubao_cancelled');
  f.setFailure(null);await f.run(session);
  assert.equal(f.prepares.length,1);assert.equal(f.calls.length,3);
});

test('失败首轮不保存，普通无内部会话仍共享账号签名，非原生模式逐次准备',async()=>{
  const f=signatureFixture(),session={id:'aasc-initial',state:{}};
  f.setFailure({status:403});await assert.rejects(()=>f.run(session));
  f.setFailure(null);await f.run(session);
  assert.equal(f.prepares.length,3);
  await f.run();await f.run();assert.equal(f.prepares.length,3);
  for(const model of ['doubao-think','doubao-expert']){
    const other={id:model,state:{}};await f.run(other,{model});await f.run(other,{model});
  }
  assert.equal(f.prepares.length,7);
});

test('签名LRU固定128个账号，近期使用保留，淘汰后重新生成',async()=>{
  const f=signatureFixture(),sessions=[];
  for(let i=0;i<128;i++){
    const session={id:'bounded-'+i,state:{},account:{...f.account,accountId:'account-'+i}};
    sessions.push(session);await f.run(session,{account:session.account});
  }
  await f.run(sessions[0],{account:sessions[0].account});assert.equal(f.prepares.length,128);
  await f.run({id:'bounded-new',state:{}},{account:{...f.account,accountId:'new-account'}});
  await f.run(sessions[0],{account:sessions[0].account});assert.equal(f.prepares.length,129);
  await f.run(sessions[1],{account:sessions[1].account});assert.equal(f.prepares.length,130);
});

test('刷新签名仍受首次总时限约束，超时后不发送第二次网络请求',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const budgets=[];
  const f=signatureFixture({limits:{timeoutMs:120},
    beforePrepare:async(options,index)=>{budgets.push(options.limits.timeoutMs);if(index===2)await gate;},
    beforeSend:async()=>{await new Promise(resolve=>setTimeout(resolve,50));}});
  f.setFailure({status:403});
  try{await assert.rejects(()=>f.run({id:'shared-deadline',state:{}}),error=>error.code==='doubao_timeout');}
  finally{release();}
  assert.equal(f.prepares.length,2);assert.equal(f.calls.length,1);
  assert.ok(budgets[1]<budgets[0]-30);
});

test('刷新签名等待期间cancel或return能够取消第二次发送',async()=>{
  for(const action of ['cancel','return']){
    let entered,release;
    const preparing=new Promise(resolve=>{entered=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const f=signatureFixture({beforePrepare:async(_options,index)=>{if(index===2){entered();await gate;}}});
    f.setFailure({sse:true});
    const result=await f.run({id:'cancel-retry',state:{}},{stream:true});
    const pending=result.stream.next();
    const rejected=assert.rejects(()=>pending,error=>error.code==='doubao_cancelled');
    await preparing;
    if(action==='cancel')result.cancel();else await result.stream.return();
    await rejected;release();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.prepares.length,2);assert.equal(f.calls.length,1);
  }
});

test('本地参数校验失败以及网页兼容失败不触发重新签名补发',async()=>{
  const f=signatureFixture();
  await assert.rejects(()=>f.run({id:'bad-input',state:{}},{model:'invalid'}),error=>error.code==='doubao_unsupported_model');
  assert.equal(f.prepares.length,0);assert.equal(f.calls.length,0);
  let browserCalls=0;
  const adapter=createDoubaoChatAdapter({getTransport:()=> 'browser-fetch',
    prepareNodeRequest:()=>{throw Error('兼容模式不得调用直连签名');},
    browserBridge:{request:async()=>{browserCalls++;return {status:403};}}});
  await assert.rejects(()=>adapter({account:f.account,provider:{id:'doubaochat'},actualModel:'doubao',
    request:{model:'doubao',messages:[{role:'user',content:'早'}]}}),error=>error.code==='doubao_risk_control');
  assert.equal(browserCalls,1);
});

test('并发旧签名迟到失败及其补发失败，不删除另一会话更新的有效签名',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os');
  const {createDoubaoSignatureStore}=require('./chat2api-doubao-signature-store');
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-account-signature-race-'));
  t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
  const disk=createDoubaoSignatureStore({rootDir});
  let entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const f=signatureFixture({signatureStore:disk,response:async call=>{
    const text=call.data.messages[0].content_block[0].content.text_block.text;
    if(text==='slow'){
      if(call.url.endsWith('signature_1')){entered();await gate;}
      return {status:403};
    }
    if(text==='fast'&&call.url.endsWith('signature_1'))return {status:403};
    return null;
  }});
  await f.run({id:'seed',state:{}});
  const slow=f.run({id:'slow',state:{}},{text:'slow'});
  const rejected=assert.rejects(()=>slow,error=>error.code==='doubao_risk_control');
  await waiting;
  try{await f.run({id:'fast',state:{}},{text:'fast'});}
  finally{release();}
  await rejected;
  assert.equal(f.prepares.length,3);
  await f.run({id:'after',state:{}},{text:'after'});
  assert.equal(f.prepares.length,3);assert.match(f.calls.at(-1).url,/signature_2$/u);
  assert.match((await disk.get(JSON.stringify([f.account.accountId,'mode:0']))).url,/signature_2$/u);
});

test('并发从文件读出的同签名副本一起失效，补发失败后不重新载入旧签名',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os');
  const {createDoubaoSignatureStore}=require('./chat2api-doubao-signature-store');
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-signature-copy-race-'));
  t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
  const store=createDoubaoSignatureStore({rootDir});
  await signatureFixture({signatureStore:store}).run({id:'seed',state:{}});
  let entered,release;
  const bEntered=new Promise(resolve=>{entered=resolve;});
  const held=new Promise(resolve=>{release=resolve;});
  const f=signatureFixture({signatureStore:createDoubaoSignatureStore({rootDir}),response:async call=>{
    const text=call.data.messages[0].content_block[0].content.text_block.text;
    if(text==='fail'){await bEntered;return {status:403};}
    if(text==='hold'){entered();await held;throw Object.assign(Error('cancelled'),{code:'doubao_cancelled'});}
    return null;
  }});
  const a=f.run({id:'a',state:{}},{text:'fail'});
  const b=f.run({id:'b',state:{}},{text:'hold'});
  const bRejected=assert.rejects(()=>b,error=>error.code==='doubao_cancelled');
  try{await assert.rejects(()=>a,error=>error.code==='doubao_risk_control');}
  finally{release();}
  await bRejected;
  assert.equal(f.prepares.length,1);
  assert.equal(await store.get(JSON.stringify([f.account.accountId,'mode:0'])),null);
  await f.run({id:'c',state:{}},{text:'after'});
  assert.equal(f.prepares.length,2);
});
