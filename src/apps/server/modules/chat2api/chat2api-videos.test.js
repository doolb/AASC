'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Readable}=require('node:stream');
const {createChat2ApiProviderAdapters}=require('./chat2api-provider-adapters');const {createChat2ApiResponsesService}=require('./chat2api-responses-service');
const {createChat2ApiVideoService}=require('./chat2api-video-service');
const {inspectNativeVideos}=require('./chat2api-native-videos');
const frame=(provider,ready=true)=>provider==='qwen'?{data:{messages:[{mime_type:'multi_load/iframe',meta_data:{multi_load:[{type:'ai_generate_video',content:{status:ready?'complete':'pending',display_list:[{video:{video_url:'https://media.test/a.mp4',cover_url:'https://media.test/a.png'}}]}}]}}]}}:{status:'finish',parts:[{content:[{type:'video',video:[{video_url:'https://media.test/a.mp4',cover_url:'https://media.test/a.png'}]}]}]};
const store=()=>{const map=new Map();return {map,create:async s=>{map.set(s.conversationId,s);return s},get:async id=>map.get(id),findByResponseId:async id=>[...map.values()].find(s=>s.latestResponseId===id),save:async s=>map.set(s.conversationId,s),withLock:async(_id,f)=>f()}};

test('视频作品解析只认明确卡片，生成中的封面/预览不当作完成',()=>{
 assert.equal(inspectNativeVideos('qwen',frame('qwen',false)).videos.length,0);
 assert.equal(inspectNativeVideos('qwen',frame('qwen')).videos.length,1);
 assert.equal(inspectNativeVideos('qwen',{data:{messages:[{meta_data:{multi_load:[{type:'image',content:{video_url:'https://media.test/a.mp4'}}]}}]}}).started,false);
 assert.equal(inspectNativeVideos('doubaochat',{content_block:[{content:{creation_block:{creations:[{video:{url:'https://media.test/a.mp4'}}]}}}]}).videos.length,1);
});
for(const providerId of ['qwen','glm'])for(const stream of [false,true])test(`${providerId}原生仅视频${stream?'流式':'非流式'}经真实Provider/Responses保留作品与原会话续聊`,async()=>{
 let calls=0;let adopted=0;const requests=[];
 const http={request:async config=>{
  if(config.url.includes('user/refresh'))return {status:200,data:{result:{access_token:'access'}}};
  requests.push(config);calls++;return {status:200,headers:{'content-type':'text/event-stream'},data:Readable.from([`data: ${JSON.stringify(frame(providerId))}\n\n`])};}};
 const adapters=createChat2ApiProviderAdapters({httpClient:http,adoptVideoTask:async()=>{adopted++;return {id:'should-not-adopt'}}});
 const sessions=store();const service=createChat2ApiResponsesService({sessionStore:sessions,coreAdapter:{forwardChatCompletion:async(request,options)=>{
  const result=await adapters[providerId]({request,provider:{id:providerId,apiEndpoint:providerId==='qwen'?'https://chat2.qianwen.com':'https://chatglm.cn'},account:{credentials:{refresh_token:'refresh',ticket:'ticket'}},actualModel:providerId==='qwen'?'Qwen':'glm-5.3-flash',responseSession:options.responseSession});
  if(providerId==='glm')options.responseSession.nativeState.conversationId='same';
  // usage或保活空帧不能中断后续视频事件。
  if(result.stream){const source=result.stream;result.stream=(async function*(){yield {choices:[]};yield* source;})();}
  return {...result,providerId,accountId:'one',actualModel:'mock',nativeState:options.responseSession.nativeState};
 }}});
 let previous,conversation;
 for(let i=0;i<2;i++){
  const result=await service.createResponse({model:'mock',input:i?'再说说视频':'生成橘猫视频',stream,...(previous?{previous_response_id:previous}:{})});let body=result.body;
  if(stream){const events=[];for await(const e of result.stream){events.push(e);if(e.type==='response.completed')body=e.response}assert.ok(events.some(e=>e.type==='response.output_videos'));}
  const videos=require('../../../../core/utils/chat-output-videos').extractOutputVideos(body);assert.equal(videos.length,1);assert.equal(body.output_text,'');
  if(i)assert.equal(body.conversation.id,conversation);conversation=body.conversation.id;previous=body.id;
 }
 assert.equal(calls,2);assert.equal(adopted,0);assert.equal(sessions.map.size,1);assert.equal([...sessions.map.values()][0].history.at(-1).videos.length,1);
 assert.equal(requests[1].data.messages.length,1);
});

test('Qwen原生异步视频只注册既有任务，Responses带任务ID正常结束而不阻塞到生成完成',async()=>{
 let adopt=0;const adapters=createChat2ApiProviderAdapters({httpClient:{request:async()=>({status:200,headers:{},data:Readable.from([`data: ${JSON.stringify(frame('qwen',false))}\n\n`])})},adoptVideoTask:async input=>{adopt++;assert.equal(input.providerId,'qwen');assert.ok(input.upstream.reqId);return {id:'video_job'}}});
 const result=await adapters.qwen({request:{model:'Qwen',stream:false,messages:[{role:'user',content:'生成视频'}]},actualModel:'Qwen',account:{accountId:'one',credentials:{ticket:'ticket'}},provider:{apiEndpoint:'https://chat2.qianwen.com'},responseSession:{nativeState:{}}});
 assert.equal(result.body.choices[0].message.video_generation.taskId,'video_job');assert.equal(adopt,1);
});

test('GLM已有视频回复断流不能假完成',async()=>{
 const data=frame('glm');delete data.status;const adapters=createChat2ApiProviderAdapters({httpClient:{request:async()=>({status:200,headers:{},data:Readable.from([`data: ${JSON.stringify(data)}\n\n`])})}});
 await assert.rejects(adapters.glm({request:{model:'glm',messages:[{role:'user',content:'视频'}]},account:{credentials:{}},provider:{apiEndpoint:'https://chatglm.cn'},actualModel:'glm-5.3-flash',responseSession:{nativeState:{}}}),e=>e.code==='video_stream_interrupted');
});

test('千问额度不足立即失败，不进入空任务轮询，也不换账号/模型',async()=>{
 let calls=0;const service=createChat2ApiVideoService({dataStore:{listAccounts:async()=>[{accountId:'one',providerId:'qwen'}],getAccount:async()=>({accountId:'one',providerId:'qwen',credentials:{ticket:'ticket'}})},providerRegistry:{getProvider:async()=>({id:'qwen',apiEndpoint:'https://chat2.qianwen.com'})},http:{request:async config=>{
  if(config.method==='GET')return {status:200,data:'<script>window.__sm_req_token__ = {"nonceId":"nonce","signKey":"key"};</script>'};
  calls++;return {status:200,data:{code:15004,msg:'当前积分不足'}};
 }}});
 const job=await service.create({model:'qwen-happyhorse',prompt:'橘猫眨眼'});await assert.rejects(service.wait(job.id),/积分不足/);assert.equal(calls,1);await service.stop();
});

test('视频HTTP任务创建与查询沿现有API鉴权',async t=>{
 const {createChat2ApiProxyService}=require('./chat2api-proxy-service');let created=0;const id='video_12345678-1234-1234-1234-123456789abc';
 const proxy=createChat2ApiProxyService({host:'127.0.0.1',port:0,config:{enableApiKey:true},dataStore:{validateApiKey:async value=>value==='key'},videoService:{create:async()=>{created++;return {id,status:'queued'}},get:async()=>({id,status:'completed',data:[{url:'https://media.test/a.mp4'}]})}});
 await proxy.start();t.after(()=>proxy.stop());const root=`http://127.0.0.1:${proxy.address().port}/v1/video/generations`;
 assert.equal((await fetch(root,{method:'POST',body:'{}'})).status,401);assert.equal(created,0);
 const result=await fetch(root,{method:'POST',headers:{Authorization:'Bearer key','Content-Type':'application/json'},body:'{}'});assert.equal(result.status,202);assert.equal((await result.json()).id,id);
 const ready=await fetch(root+'/'+id,{headers:{Authorization:'Bearer key'}});assert.equal((await ready.json()).status,'completed');assert.equal(created,1);
});

test('豆包当前IM作品按原消息关联，超大整数任务ID保持精度，不取另一轮视频',async()=>{
 const make=(task,user,url)=>({conversation_id:'conversation',ext:{ai_creation_tool_list:`[{"task_id":${task},"tool_name":"image_to_video","task_type":6,"status":4,"based_message_id_list":[${user}]}]`,creation_material_info:JSON.stringify({[task]:{result:{video:{download_url:url,duration:5}}}})}});
 const own=make('59469883040188418','59457005517946370','https://media.test/own.mp4'),other=make('59469883040188419','59457005517949999','https://media.test/other.mp4');
 const state=inspectNativeVideos('doubaochat',{message:own},{messageId:'59457005517946370'});assert.equal(state.taskId,'59469883040188418');assert.equal(state.videos.length,1);
 const {readDoubaoVideoResult}=require('./chat2api-doubao-video-result');
 const result=await readDoubaoVideoResult({account:{credentials:{cookie:'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; msToken=mock_ms_token; s_v_web_id=verify_mock_123456789',nodeProfile:{deviceId:'1234567890123456789',webId:'9876543210123456789',fp:'verify_mock_123456789',userAgent:'Mozilla/5.0 (Linux; Android 9) Chrome/138.0.0.0'}}},upstream:{conversationId:'conversation',messageId:'59457005517946370'},http:{request:async config=>{
 assert.equal(config.data.cmd,3100);assert.equal(config.url,'https://www.doubao.com/im/chain/single');assert.equal(config.data.messages,undefined);
 return {data:{status_code:0,cmd:3100,downlink_body:{pull_singe_chain_downlink_body:{messages:[own,other]}}}};
 }}});assert.equal(result.done,true);assert.deepEqual(result.videos.map(v=>v.url),['https://media.test/own.mp4']);
});

test('豆包新任务首段只有ACK时转IM查询，创建只一次且不用网页重发',async()=>{
 let sent=0,queried=0;const credentials={cookie:'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; msToken=mock_ms_token; s_v_web_id=verify_mock_123456789',nodeProfile:{deviceId:'1234567890123456789',webId:'9876543210123456789',fp:'verify_mock_123456789',userAgent:'Mozilla/5.0 (Linux; Android 9) Chrome/138.0.0.0'}};
 const account={accountId:'one',providerId:'doubaochat',credentials};
 const service=createChat2ApiVideoService({dataStore:{listAccounts:async()=>[account],getAccount:async()=>account},providerRegistry:{getProvider:async()=>({id:'doubaochat'})},
 browserBridge:{request:async args=>{sent++;assert.equal(args.ephemeral,false);return {status:200,data:Readable.from(['data: '+JSON.stringify({event_type:2002,event_data:JSON.stringify({conversation_id:'own',message_id:'59457005517946370',conversation_type:3})})+'\n\n'])}}},
 http:{request:async config=>{queried++;assert.equal(config.data.cmd,3100);return {data:{status_code:0,cmd:3100,downlink_body:{pull_singe_chain_downlink_body:{messages:[{conversation_id:'own',ext:{ai_creation_tool_list:'[{"task_id":59469883040188418,"tool_name":"image_to_video","task_type":6,"based_message_id_list":[59457005517946370]}]',creation_material_info:'{"59469883040188418":{"result":{"video":{"download_url":"https://media.test/a.mp4"}}}}'}}]}}}}}}});
 const job=await service.create({model:'doubao-video',prompt:'猫眨眼'});const done=await service.wait(job.id);assert.equal(done.data.length,1);assert.equal(sent,1);assert.equal(queried,1);await service.stop();
});
