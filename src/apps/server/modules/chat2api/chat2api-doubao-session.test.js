const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { createDoubaoChatAdapter } = require('./chat2api-doubao-chat-adapter');
const { isReadyDoubaoSession, getDoubaoIdentity, createDoubaoSessionFlow } = require('./chat2api-doubao-session');
const cookie = 'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456789';
const nodeProfile = { deviceId:'1234567890123456789',webId:'9876543210123456789',fp:'verify_mock_123456789',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0' };
const account = { accountId:'node-test',providerId:'doubaochat',credentials:{cookie,nodeProfile} };
const provider = { id:'doubaochat',apiEndpoint:'https://www.doubao.com',chatPath:'/chat/completion' };
const input = (extra={}) => ({ account,provider,actualModel:'doubao',request:{model:'doubao',messages:[{role:'user',content:'本轮'}]},...extra });
const event = (name,data={}) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const events = (id='upstream-session') => [event('SSE_ACK',{ack_client_meta:{conversation_id:id,section_id:'unused-section'}}),event('CHUNK_DELTA',{text:'OK'}),event('SSE_REPLY_END',{msg_finish_attr:{}}),event('SSE_REPLY_END',{answer_finish_attr:{}}),event('SSE_REPLY_END',{end_type:0})];
const response = (parts) => ({ status:200,headers:{'content-type':'text/event-stream'},data:Readable.from(parts) });
test('独立状态只保存账号身份摘要，动态CSRF/token不改变身份', () => {
  const identity = getDoubaoIdentity(account);
  assert.match(identity,/^[a-f0-9]{64}$/);
  assert.equal(identity,getDoubaoIdentity({...account,credentials:{...account.credentials,cookie:cookie.replace('mock_csrf_123456789','updated_csrf_123456789')+'; msToken=rotated_real_token'}}));
  assert.notEqual(identity,getDoubaoIdentity({...account,accountId:'another'}));
  assert.notEqual(identity,getDoubaoIdentity({...account,credentials:{...account.credentials,cookie:cookie.replace('mock_session_123456789','updated_session_123456789')}}));
  assert.equal(isReadyDoubaoSession({observedConversationId:'old',conversationId:'unverified'}),false);
  const namedAccount={...account,accountId:'豆包账号@example.test'};
  assert.equal(isReadyDoubaoSession(createDoubaoSessionFlow({account:namedAccount,mode:0,state:{}}).complete('conversation_1')),true);
  assert.throws(()=>createDoubaoSessionFlow({account,mode:0,state:{version:2,transport:'node-http',conversationId:'new-version'}}),error=>error.code==='doubao_session_conflict');
});
test('完整Node首轮提交ready，下一轮只续接同会话且使用已验证null索引', async () => {
  const calls=[];
  const adapter=createDoubaoChatAdapter({httpClient:{request:async call=>{calls.push(call);return response(events())}}});
  const session={nativeState:{}};
  const first=await adapter(input({responseSession:session}));
  assert.equal(isReadyDoubaoSession(first.nativeState),true);
  assert.equal(first.nativeState.conversationId,'upstream-session');
  assert.equal(JSON.stringify(first.nativeState).includes('mock_session'),false);
  const second=await adapter(input({responseSession:{nativeState:{...first.nativeState}}}));
  assert.equal(second.body.choices[0].message.content,'OK');
  assert.equal(calls[1].data.client_meta.conversation_id,'upstream-session');
  assert.equal(calls[1].data.client_meta.local_conversation_id,'');
  assert.equal(calls[1].data.client_meta.last_section_id,'');
  assert.equal(calls[1].data.client_meta.last_message_index,null);
  assert.equal(calls[1].data.option.need_create_conversation,false);
  assert.equal(calls[1].data.ext.sub_conv_firstmet_type,'0');
  assert.equal(calls[1].data.messages[0].content_block[0].content.text_block.text,'User: 本轮');
});
test('ACK及中间结束不能提交；缺最终结束、ACK冲突和空正文都拒绝', async () => {
  for(const parts of [events().slice(0,-1),[event('SSE_ACK',{ack_client_meta:{conversation_id:'one'}}),event('SSE_ACK',{ack_client_meta:{conversation_id:'two'}}),event('CHUNK_DELTA',{text:'OK'}),event('SSE_REPLY_END')],[event('SSE_ACK',{ack_client_meta:{conversation_id:'one'}}),event('SSE_REPLY_END')]]) {
    const session={nativeState:{}};
    const adapter=createDoubaoChatAdapter({httpClient:{request:async()=>response(parts)}});
    await assert.rejects(()=>adapter(input({responseSession:session})),error=>/^doubao_/.test(error.code));
    assert.deepEqual(session.nativeState,{});
  }
});
test('续接须匹配账号/身份/模式/传输，uncertain或坏状态均在发送前拒绝', async () => {
  const state=createDoubaoSessionFlow({account,mode:0,state:{}}).complete('upstream-session');
  let calls=0;
  const adapter=createDoubaoChatAdapter({browserTransport:{request:()=>{calls++;throw Error('must_not_run')}},httpClient:{request:async()=>{calls++;return response(events())}}});
  for(const change of [{account:{...account,accountId:'other'}},{account:{...account,credentials:{...account.credentials,cookie:cookie.replace('mock_session_123456789','other_session_123456789')}}},{actualModel:'doubao-think',request:{model:'doubao-think',messages:[{role:'user',content:'x'}]}},{account:{...account,credentials:{cookie}}},{}]) {
    const saved={...state,...(Object.keys(change).length?{}:{status:'uncertain'})};
    await assert.rejects(()=>adapter(input({...change,responseSession:{nativeState:saved}})),error=>['doubao_session_conflict','doubao_session_uncertain'].includes(error.code));
  }
  await assert.rejects(()=>adapter(input({responseSession:{nativeState:{...state,identityFingerprint:'bad'}}})),error=>error.code==='doubao_session_conflict');
  assert.equal(calls,0);
});
test('旧observed状态不升级，缺ACK首轮不获得复用，思考模式仍按旧语义', async () => {
  const calls=[];
  const adapter=createDoubaoChatAdapter({httpClient:{request:async call=>{calls.push(call);return response([event('CHUNK_DELTA',{text:'OK'}),event('SSE_REPLY_END')])}}});
  const result=await adapter(input({responseSession:{nativeState:{observedConversationId:'old',conversationId:'unverified'}}}));
  assert.equal(calls[0].data.option.need_create_conversation,true);
  assert.equal(isReadyDoubaoSession(result.nativeState),false);
});
test('原生续接缺ACK或返回另一会话都失败且保留原ready状态', async () => {
  const state=createDoubaoSessionFlow({account,mode:0,state:{}}).complete('upstream-session');
  for(const parts of [[event('CHUNK_DELTA',{text:'OK'}),event('SSE_REPLY_END')],events('other-session')]) {
    const session={nativeState:{...state}};
    const adapter=createDoubaoChatAdapter({httpClient:{request:async()=>response(parts)}});
    await assert.rejects(()=>adapter(input({responseSession:session})),error=>error.code==='doubao_protocol_error');
    assert.deepEqual(session.nativeState,state);
    assert.equal(session.doubaoRequestStarted,true);
  }
});
