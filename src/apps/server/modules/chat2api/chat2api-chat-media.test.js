'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Readable}=require('node:stream');
const {assertChatContent,normalizeChatContent,assertTextOnly}=require('./chat2api-content');
const {readChatImages}=require('./chat2api-chat-media');
const {createChat2ApiProviderAdapters}=require('./chat2api-provider-adapters');
const url='data:image/png;base64,aGVsbG8=';
const messages=[{role:'user',content:[{type:'text',text:'System:你是助手\nUser:这张图里有什么？'},{type:'image_url',image_url:{url}}]}];

test('Responses照片片段保持独立，视频和无效图片仍拒绝，TTS继续仅接受文字',()=>{
 const input=[{role:'user',content:[{type:'input_text',text:'猫'},{type:'input_image',image_url:url}]}];
 assertChatContent(input);assert.deepEqual(normalizeChatContent(input[0].content),[{type:'text',text:'猫'},{type:'image_url',image_url:{url}}]);
 assert.throws(()=>assertTextOnly(input),e=>e.code==='unsupported_modality');
 assert.throws(()=>assertChatContent([{type:'input_video',video_url:'https://example.com/a.mp4'}]),e=>e.code==='invalid_input');
 assert.throws(()=>assertChatContent([{type:'input_image',image_url:'http://private/image'}]),e=>e.code==='invalid_input');
 assert.throws(()=>readChatImages({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,a'}}]}]}),/图片数据无效/);
});

for(const providerId of ['qwen','glm'])test(`${providerId}上传照片后按现场协议发送，与raw文本和原生会话共存`,async()=>{
 let sent,upload=0;const signal=new AbortController().signal;
 const http={request:async config=>{
   if(config.url.includes('/user/refresh'))return {status:200,data:{result:{access_token:'access'}}};
   if(config.url.endsWith('/file/chat_upload')){
     assert.equal(config.signal,signal);assert.equal(config.data.get('assistant_id'),'65940acff94777010aa6b796');
     upload++;return {data:{status:0,result:{file_id:'file',file_url:'https://images.test/a.png',file_name:'cat.png',file_size:5}}};
   }
   sent=config;return {status:200,headers:{'content-type':'application/json'},data:{choices:[{message:{content:'猫'}}]}};
 }};
 const adapters=createChat2ApiProviderAdapters({httpClient:http,qwenUpload:async(image,options)=>{upload++;assert.equal(image.data.toString(),'hello');assert.equal(options.signal,signal);return {id:'ws',url:'https://images.test/a.png',file_name:'cat.png',file_format:'PNG',file_size:5}}});
 const result=await adapters[providerId]({request:{model:'photo',messages},provider:{id:providerId,apiEndpoint:providerId==='glm'?'https://chatglm.cn':'https://chat2.qianwen.com'},account:{credentials:{refresh_token:'refresh',ticket:'ticket'}},actualModel:providerId==='glm'?'glm-5.3-flash':'Qwen3.5-Flash',context:{signal},responseSession:{nativeState:providerId==='glm'?{conversationId:'existing'}:{sessionId:'existing',parentReqId:'parent'}}});
 assert.ok(result.body);assert.equal(upload,1);
 if(providerId==='qwen'){
   assert.equal(sent.data.session_id,'existing');assert.equal(sent.data.parent_req_id,'parent');
   assert.equal(sent.data.messages[0].mime_type,'image/url');assert.equal(sent.data.messages[0].meta_data.resource_infos[0].id,'ws');
   assert.match(sent.data.messages[1].content,/System:你是助手/);
 }else{
   assert.equal(sent.data.conversation_id,'existing');assert.equal(sent.data.messages.length,1);
   assert.equal(sent.data.messages[0].content[1].type,'image');assert.equal(sent.data.messages[0].content[1].image[0].file_id,'file');
   assert.match(sent.data.messages[0].content[0].text,/System:你是助手/);
 }
});

test('Qwen独立workspace签名和上传顺序，拒绝异常上传主机且不发送账号到OSS',async()=>{
 const {createQwenChatUpload,workspaceSignature}=require('./chat2api-qwen-chat-upload');
 const signed=workspaceSignature({signData:{req_id:'r'},nonce:'n',timestamp:1,authTime:2,base:{deviceId:'d',version:'v'},scene:{tokens:['t'],accessToken:'a'},kp:''});
 assert.equal(signed.headers['clt-acs-request-params'],'req_id,nonce,timestamp');
 assert.equal(signed.headers['clt-acs-sign'],require('node:crypto').createHmac('sha256','t:2').update('d1.0.0rn1').digest('base64'));
 const steps=[];const upload=createQwenChatUpload({signer:async({signData})=>({params:signData,headers:{'clt-acs-sign':'sign'}}),http:{
 post:async(u,_body,options)=>{steps.push(u.includes('callback')?'callback':'token');assert.equal(options.headers['clt-acs-sign'],'sign');return {data:{code:0,data:u.includes('callback')?{ws_gid:'ws',material_url:'https://images.test/a.png'}:{host:'https://bucket.oss-cn-shanghai.aliyuncs.com',object:'key',authorization:'oss-secret'}}}},
 request:async config=>{steps.push('put');assert.equal(config.headers.Cookie,undefined);assert.equal(config.headers.Authorization,'oss-secret');return {status:200}}
 }});
 assert.equal((await upload({data:Buffer.from('hello'),filename:'cat.png',mimeType:'image/png'},{account:{credentials:{ticket:'ticket'}}})).id,'ws');
 assert.deepEqual(steps,['token','put','callback']);
});

for(const stream of [false,true])test(`Responses${stream?'流式':'非流式'}带图续接只转发新增输入且保存图片`,async()=>{
 const sessions=new Map();let count=0;const seen=[];
 const service=require('./chat2api-responses-service').createChat2ApiResponsesService({sessionStore:{create:async s=>{sessions.set(s.conversationId,s);return s},get:async id=>sessions.get(id),save:async s=>sessions.set(s.conversationId,s),findByResponseId:async id=>[...sessions.values()].find(s=>s.latestResponseId===id),withLock:async(_id,fn)=>fn()},coreAdapter:{forwardChatCompletion:async(request)=>{seen.push(request);count++;return {...(stream?{stream:(async function*(){yield {choices:[{delta:{content:'猫'}}]}})()}:{body:{choices:[{message:{content:'猫'}}]}}),providerId:'qwen',accountId:'one',actualModel:'Qwen',nativeState:{sessionId:'same',parentReqId:String(count)}}}}});
 let previous;
 for(const input of [[{role:'user',content:[{type:'input_text',text:'图里有什么？'},{type:'input_image',image_url:url}]}],'颜色呢？']){
  const result=await service.createResponse({model:'Qwen',input,stream,...(previous?{previous_response_id:previous}:{})});let body=result.body;
  if(stream)for await(const event of result.stream)if(event.type==='response.completed')body=event.response;
  previous=body.id;
 }
 assert.equal(seen[0].messages[0].content[1].image_url.url,url);
 assert.equal(seen[1].messages.length,1);assert.equal(seen[1].messages[0].content,'颜色呢？');assert.equal(sessions.size,1);
 assert.equal([...sessions.values()][0].history[0].content[1].image_url.url,url);
});
