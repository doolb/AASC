const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, PassThrough } = require('stream');
const { createChat2ApiResponseSessionStore } = require('./chat2api-response-session-store');
const { createChat2ApiResponsesService } = require('./chat2api-responses-service');
const { createChat2ApiCoreAdapter } = require('./chat2api-core-adapter');
const { createDoubaoChatAdapter } = require('./chat2api-doubao-chat-adapter');
const { isReadyDoubaoSession } = require('./chat2api-doubao-session');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (type,data={}) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const parts = (id,text='OK') => [event('SSE_ACK',{ack_client_meta:{conversation_id:id}}),event('CHUNK_DELTA',{text}),event('SSE_REPLY_END')];
const clone = value => JSON.parse(JSON.stringify(value));
const setup = (options={}) => {
  const collections={responsesSessions:[]}, calls=[];
  const account={accountId:'mock-account',providerId:'doubaochat',enabled:true,status:'active',credentials:{
    cookie:'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456789',
    nodeProfile:{deviceId:'1234567890123456789',webId:'9876543210123456789',fp:'verify_mock_123456789',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0'},
  }};
  const provider={id:'doubaochat',enabled:true,apiEndpoint:'https://www.doubao.com',chatPath:'/chat/completion'};
  const dataStore={readCollection:async(name,fallback)=>clone(collections[name]||fallback),writeCollection:async(name,value)=>{if(options.beforeSave)await options.beforeSave(name,value);collections[name]=clone(value)},getAccount:async()=>clone(account),listAccounts:async()=>[{accountId:account.accountId,providerId:'doubaochat',secretConfigured:true}],listDoubaoNodeAccountIds:async()=>[account.accountId]};
  const store=createChat2ApiResponseSessionStore({dataStore});
  const adapter=createDoubaoChatAdapter({limits:{timeoutMs:options.timeoutMs||1000},httpClient:{request:async call=>{
    calls.push(call);
    const id=call.data.client_meta.conversation_id||`mock-upstream-${calls.length}`;
    const source=options.source?.(call,calls.length,id)||Readable.from(parts(id));
    return {status:200,headers:{'content-type':'text/event-stream'},data:source};
  }}});
  const core=createChat2ApiCoreAdapter({dataStore,providerRegistry:{listProviders:async()=>[provider]},modelMapper:{resolveModel:async model=>({actualModel:model})},loadBalancer:{selectAccount:async()=>({provider,account:{accountId:account.accountId}}),markAccountFailed(){}},getDoubaoWebConfig:()=>{throw Error('no_browser')},providerAdapters:{doubaochat:adapter}});
  const service=createChat2ApiResponsesService({sessionStore:store,coreAdapter:core,doubaoSessionTimeoutMs:options.timeoutMs||1000});
  return {service,store,dataStore,collections,calls,core};
};
test('Responses纯Node持久化后重建Store，第二轮仅发送新增input且续同上游',async()=>{
  const f=setup();
  const first=await f.service.createResponse({model:'doubao',input:'第一轮'});
  const stored=await f.store.get(first.body.conversation.id);
  assert.equal(isReadyDoubaoSession(stored.nativeState),true);
  const restored=createChat2ApiResponseSessionStore({dataStore:f.dataStore});
  const service=createChat2ApiResponsesService({sessionStore:restored,coreAdapter:f.core});
  await service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'第二轮'});
  assert.equal(f.calls[1].data.client_meta.conversation_id,stored.nativeState.conversationId);
  assert.equal(f.calls[1].data.messages[0].content_block[0].content.text_block.text,'User: 第二轮');
  assert.equal((await restored.get(stored.conversationId)).history.length,4);
});
test('豆包网页任务接管旧Node对话时重放AASC历史并切换原生传输', async () => {
  const f = setup();
  const first = await f.service.createResponse({ model: 'doubao', input: '第一轮' });
  const old = await f.store.get(first.body.conversation.id);
  let sent;
  const service = createChat2ApiResponsesService({ sessionStore: f.store,
    getDoubaoTransport: () => 'browser-fetch',
    coreAdapter: { forwardChatCompletion: async (request, context) => {
      sent = { request, nativeState: context.responseSession.nativeState };
      return { providerId: 'doubaochat', accountId: old.accountId, actualModel: 'doubao',
        nativeState: { ...old.nativeState, transport: 'browser-fetch', conversationId: 'web-conversation' },
        body: { choices: [{ message: { role: 'assistant', content: '网页续答' } }] } };
    } } });
  const next = await service.createResponse({ model: 'doubao', previous_response_id: first.body.id,
    input: '第二轮' });
  assert.equal(next.body.conversation.id, first.body.conversation.id);
  assert.deepEqual(sent.nativeState, {});
  assert.equal(sent.request.messages.length, 3);
  assert.equal((await f.store.get(first.body.conversation.id)).nativeState.transport, 'browser-fetch');
});
test('豆包流式锁覆盖消费与保存，旧response引用排队后重新读最新状态，不阻塞其它会话',async()=>{
  const pending=new PassThrough();
  const f=setup({source:(_call,index)=>index===2?pending:null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  const second=await f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second',stream:true});
  assert.equal((await second.stream.next()).value.type,'response.created');
  let thirdDone=false;
  const third=f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'third'}).then(value=>{thirdDone=true;return value});
  await tick(); await tick();
  assert.equal(thirdDone,false);
  assert.equal(f.calls.length,2);
  const other=await f.service.createResponse({model:'doubao',input:'other'});
  assert.notEqual(other.body.conversation.id,first.body.conversation.id);
  pending.end(parts('mock-upstream-1','second reply').join(''));
  const events=[];for await(const value of second.stream)events.push(value);
  assert.equal(events.at(-1).type,'response.completed');
  await third;
  assert.equal((await f.store.get(first.body.conversation.id)).history.length,6);
  assert.equal(f.calls.at(-1).data.messages[0].content_block[0].content.text_block.text,'User: third');
});
test('续接流提前return仅标记uncertain并释放锁，不提交半轮历史或自动重发',async()=>{
  const pending=new PassThrough();
  const f=setup({source:(_call,index)=>index===2?pending:null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  const second=await f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second',stream:true});
  await second.stream.return();
  assert.equal(pending.destroyed,true);
  const stored=await f.store.get(first.body.conversation.id);
  assert.equal(stored.nativeState.status,'uncertain');
  assert.equal(stored.history.length,2);
  assert.equal(stored.latestResponseId,first.body.id);
  await assert.rejects(()=>f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'again'}),error=>error.code==='doubao_session_uncertain');
  assert.equal(f.calls.length,2);
  const fresh=await f.service.createResponse({model:'doubao',input:'new conversation'});
  assert.notEqual(fresh.body.conversation.id,stored.conversationId);
});
test('未消费豆包流按原时限取消并释放租约，下一轮明确uncertain',async()=>{
  const pending=new PassThrough();
  const f=setup({timeoutMs:35,source:(_call,index)=>index===2?pending:null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  const second=await f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second',stream:true});
  await new Promise(resolve=>setTimeout(resolve,70));
  const result=await Promise.race([f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'third'}).then(()=> 'unexpected',error=>error.code),new Promise(resolve=>setTimeout(()=>resolve('lock_leaked'),120))]);
  assert.equal(result,'doubao_session_uncertain');
  assert.equal(pending.destroyed,true);
  await second.stream.return();
});
test('续接发送后SSE失败标记uncertain，发送前模式冲突不破坏ready',async()=>{
  let failed=false;
  const f=setup({source:(_call,index)=>failed&&index>1?Readable.from([event('STREAM_ERROR',{error_code:710022004})]):null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  await assert.rejects(()=>f.service.createResponse({model:'doubao-think',previous_response_id:first.body.id,input:'other mode'}),error=>error.code==='doubao_session_conflict');
  assert.equal((await f.store.get(first.body.conversation.id)).nativeState.status,'ready');
  failed=true;
  await assert.rejects(()=>f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second'}),error=>error.code==='doubao_risk_control');
  assert.equal((await f.store.get(first.body.conversation.id)).nativeState.status,'uncertain');
  assert.equal(f.calls.length,2);
});
test('流式取消signal可中断正在读取的next并标记位置不确定，等待请求不发网',async()=>{
  const pending=new PassThrough();
  const f=setup({source:(_call,index)=>index===2?pending:null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  const abort=new AbortController();
  const second=await f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second',stream:true},{signal:abort.signal});
  await second.stream.next();
  const read=second.stream.next();
  const rejected=assert.rejects(()=>read,error=>error.code==='doubao_cancelled');
  abort.abort();await rejected;
  assert.equal((await f.store.get(first.body.conversation.id)).nativeState.status,'uncertain');
  assert.equal(pending.destroyed,true);
});
test('锁租约取消中间排队项不会越过正在执行会话，且withLock互操作',async()=>{
  const f=setup(),abort=new AbortController();
  const first=await f.store.acquireLock('conv_lock');
  const middle=f.store.acquireLock('conv_lock',{signal:abort.signal});
  const rejected=assert.rejects(()=>middle,error=>error.code==='response_session_cancelled');
  let lastGranted=false;
  const last=f.store.acquireLock('conv_lock').then(lease=>{lastGranted=true;return lease});
  abort.abort();await rejected;await tick();
  assert.equal(lastGranted,false);
  first.release();const lease=await last;
  let oldRan=false;const old=f.store.withLock('conv_lock',async()=>{oldRan=true});
  await tick();assert.equal(oldRan,false);lease.release();await old;
});
test('锁租约等待超时/提前取消与容量限制不泄露会话内容',async()=>{
  const f=setup();
  const first=await f.store.acquireLock('conv_limit');
  await assert.rejects(()=>f.store.acquireLock('conv_limit',{timeoutMs:10}),error=>error.code==='response_session_timeout');
  const abort=new AbortController();abort.abort();
  await assert.rejects(()=>f.store.acquireLock('conv_limit',{signal:abort.signal}),error=>error.code==='response_session_cancelled');
  const controllers=Array.from({length:13},()=>new AbortController());
  const waits=controllers.map(controller=>f.store.acquireLock('conv_limit',{signal:controller.signal}).then(lease=>{lease.release();return 'granted'},error=>error.code));
  // 一个已取消的等待项仍排在第一项之后；算入有界链直到第一项释放。
  const extra=await f.store.acquireLock('different_conversation');extra.release();
  const oneMore=f.store.acquireLock('conv_limit').then(lease=>{lease.release();return 'granted'},error=>error.code);
  await assert.rejects(()=>f.store.acquireLock('conv_limit'),error=>error.code==='response_session_busy'&&!error.message.includes('conv_limit'));
  controllers.forEach(controller=>controller.abort());first.release();await Promise.all([...waits,oneMore]);
});
test('不同会话可并行生成，保存整个集合时不丢另一会话',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const f=setup({beforeSave:async()=>gate});
  const first=f.service.createResponse({model:'doubao',input:'A'});
  const second=f.service.createResponse({model:'doubao',input:'B'});
  await tick();await tick();
  assert.equal(f.calls.length,2);
  release();await Promise.all([first,second]);
  assert.equal((await f.store.list()).length,2);
});
test('Pi snapshot明确新建的上游失败不误伤原ready会话',async()=>{
  let fail=false;
  const f=setup({source:()=>fail?Readable.from([event('STREAM_ERROR',{error_code:710022004})]):null});
  const metadata={aasc_context_owner:'pi',aasc_pi_session_id:'pi_test',aasc_pi_context_mode:'snapshot'};
  const first=await f.service.createResponse({model:'doubao',conversation:'pi_test',metadata,input:'first'});
  fail=true;
  await assert.rejects(()=>f.service.createResponse({model:'doubao',conversation:first.body.conversation.id,metadata,input:'snapshot'}),error=>error.code==='doubao_risk_control');
  assert.equal(f.calls[1].data.option.need_create_conversation,true);
  assert.equal((await f.store.get(first.body.conversation.id)).nativeState.status,'ready');
});
test('uncertain保存失败也在当前实例阻断续接，错误不泄露私有路径',async()=>{
  let fail=false;
  const f=setup({beforeSave:async()=>{if(fail)throw Error('private_path_and_cookie_secret')},source:()=>fail?Readable.from([event('STREAM_ERROR',{error_code:710022004})]):null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  fail=true;
  await assert.rejects(()=>f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second'}),error=>error.code==='doubao_session_storage_failed'&&!error.message.includes('private'));
  await assert.rejects(()=>f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'third'}),error=>error.code==='doubao_session_uncertain');
  assert.equal(f.calls.length,2);
});
test('Node流等待期间取消不发送新增请求，也不污染原会话',async()=>{
  const pending=new PassThrough();
  const f=setup({source:(_call,index)=>index===2?pending:null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  const active=await f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second',stream:true});
  const abort=new AbortController();
  const waiting=f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'third'},{signal:abort.signal});
  const rejected=assert.rejects(()=>waiting,error=>error.code==='response_session_cancelled');
  abort.abort();await rejected;
  assert.equal(f.calls.length,2);
  pending.end(parts('mock-upstream-1').join(''));for await(const item of active.stream){}
  assert.equal((await f.store.get(first.body.conversation.id)).nativeState.status,'ready');
  assert.equal((await f.store.get(first.body.conversation.id)).history.length,4);
});
test('Node续接排队也消耗同一次请求总时限，执行阶段不重新获得完整预算',async()=>{
  const pending=new PassThrough();
  const f=setup({timeoutMs:120,source:(_call,index)=>index===2?pending:null});
  const first=await f.service.createResponse({model:'doubao',input:'first'});
  const lease=await f.store.acquireLock(first.body.conversation.id);
  const started=Date.now();
  const waiting=f.service.createResponse({model:'doubao',previous_response_id:first.body.id,input:'second'});
  const rejected=assert.rejects(()=>waiting,error=>error.code==='doubao_timeout');
  await new Promise(resolve=>setTimeout(resolve,60));lease.release();await rejected;
  assert.ok(Date.now()-started<160,'排队后不应重置执行时限');
  assert.ok(f.calls[1].timeout<100,'HTTP握手同样使用剩余时间');
  assert.equal(pending.destroyed,true);
});
test('租约总容量达到256时拒绝新增任务，释放后恢复',async()=>{
  const f=setup(),leases=[];
  try {
    for(let index=0;index<256;index++)leases.push(await f.store.acquireLock(`mock_capacity_${index}`));
    await assert.rejects(()=>f.store.acquireLock('mock_capacity_overflow'),error=>error.code==='response_session_busy');
  } finally {leases.forEach(lease=>lease.release())}
  await tick();
  const next=await f.store.acquireLock('mock_capacity_after_release');next.release();
});
