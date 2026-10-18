'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createChat2ApiDataStore}=require('./chat2api-data-store');
const {createChat2ApiSpeechService}=require('./chat2api-speech-service');
const {createChat2ApiRuntime}=require('./chat2api-runtime');
const {createChat2ApiResponsesService}=require('./chat2api-responses-service');
const {wrapPcm}=require('../../../../external/tts/tts-wav');
const {createProviderError}=require('../tts/tts-provider-errors');
const audio=wrapPcm(Buffer.from([1,0,2,0]));
test('Responses规划与合成共享总预算，慢规划超时不会调用合成，挂起规划可以取消',async()=>{
 let generated=0;
 const service=createChat2ApiResponsesService({sessionStore:{get:async()=>null,save:async()=>{},withLock:async(id,fn)=>fn()},coreAdapter:{forwardChatCompletion:async()=>{throw new Error("不得进入chat");}},speechTimeoutMs:20,applicationService:{
   plan:async()=>{await new Promise(resolve=>setTimeout(resolve,45));return {application:'tts'};},
   createAudioResponse:async()=>{generated++;return {body:{status:'completed'}};}
 }});
 await assert.rejects(service.createResponse({model:'voice',input:'x'}),e=>e.statusCode===504);
 await new Promise(resolve=>setTimeout(resolve,50));assert.equal(generated,0);
 const controller=new AbortController();
 const hanging=createChat2ApiResponsesService({sessionStore:{get:async()=>null,save:async()=>{},withLock:async(id,fn)=>fn()},coreAdapter:{forwardChatCompletion:async()=>{throw new Error("不得进入chat");}},applicationService:{plan:()=>new Promise(()=>{}),createAudioResponse:async()=>{generated++;}}});
 const result=hanging.createResponse({model:'voice',input:'x'},{signal:controller.signal}).catch(error=>error);
 controller.abort();
 const error=await Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve({code:'pending'}),100))]);
 assert.equal(error.statusCode,499);assert.equal(generated,0);
 let remaining;
 const shared=createChat2ApiResponsesService({sessionStore:{get:async()=>null,save:async()=>{},withLock:async(id,fn)=>fn()},coreAdapter:{forwardChatCompletion:async()=>{throw new Error("不得进入chat");}},speechTimeoutMs:100,applicationService:{
   plan:async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {application:'tts'};},
   createAudioResponse:async(request,plan,options)=>{remaining=options.timeoutMs;return {body:{}};}
 }});
 await shared.createResponse({model:'voice',input:'x'});assert.ok(remaining>0&&remaining<=90);
});
test('映射默认音色优先于业务默认，取消会中止统一API任务',async t=>{
 const {dataStore}=await fixture(t);let entered;const begun=new Promise(resolve=>{entered=resolve});
 const controller=new AbortController();let stopped=false;
 const service=createChat2ApiSpeechService({dataStore,apiAdapters:{'qwen-api':{generate:request=>new Promise((resolve,reject)=>{
   assert.equal(request.voice,'qiaoxiaojiao_v3.1');entered();request.signal.addEventListener('abort',()=>{stopped=true;reject(new Error('private'));},{once:true});
 })}}});
 const job=service.generate({model:'qiaoxiaojiao',input:'x'},{signal:controller.signal,parameterDefaults:{voice:'old-default'}});
 await begun;controller.abort();await assert.rejects(job,e=>e.code==='speech_cancelled');assert.equal(stopped,true);
});
async function fixture(t){
 const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-unified-'));t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
 const dataStore=createChat2ApiDataStore({rootDir});
 await dataStore.saveAccount({accountId:'one',providerId:'qwen-api',credentials:{apiKey:'fictional-key'}});
 await dataStore.saveModelMapping({model:'qiaoxiaojiao',actualModel:'qwen-api/qwen-audio-3.1-tts-flash',application:'tts',parameters:{voice:'qiaoxiaojiao_v3.1'},preferredAccountId:'one'});
 return {rootDir,dataStore};
}
test('Qwen API 连续频率限流保留同音色分句并最终合成，不因一次重试失败而丢句',async t=>{
 const {dataStore}=await fixture(t);const seen=[];
 const service=createChat2ApiSpeechService({dataStore,qwenApiRateGate:{waitForStart:async(accountId,model)=>{
   assert.equal(accountId,'one');assert.equal(model,'qwen-audio-3.1-tts-flash');
 }},apiAdapters:{'qwen-api':{generate:async request=>{
   seen.push(request.voice);
   if(seen.length<3)throw createProviderError('qwen-api',{code:'Throttling.RateQuota'},429);
   return audio;
 }}}});
 assert.deepEqual(await service.generate({model:'qiaoxiaojiao',input:'持续播报'}),{audio,contentType:'audio/wav'});
 assert.deepEqual(seen,['qiaoxiaojiao_v3.1','qiaoxiaojiao_v3.1','qiaoxiaojiao_v3.1']);
});
test('Qwen API 限流等待可取消，其他错误不反复发送',async t=>{
 const {dataStore}=await fixture(t);let attempts=0;
 const controller=new AbortController();
 const rateLimited=createChat2ApiSpeechService({dataStore,qwenApiRateGate:{waitForStart:async()=>{}},apiAdapters:{'qwen-api':{
   generate:async()=>{attempts++;controller.abort();throw createProviderError('qwen-api',{code:'Throttling.RateQuota'},429);}
 }}});
 await assert.rejects(rateLimited.generate({model:'qiaoxiaojiao',input:'会取消'},{signal:controller.signal}),error=>error.code==='speech_cancelled');
 assert.equal(attempts,1);
 const failed=createChat2ApiSpeechService({dataStore,qwenApiRateGate:{waitForStart:async()=>{}},apiAdapters:{'qwen-api':{
   generate:async()=>{attempts++;throw createProviderError('qwen-api',{code:'InvalidParameter'},400);}
 }}});
 await assert.rejects(failed.generate({model:'qiaoxiaojiao',input:'其他错误'}),error=>error.httpStatus===400);
 assert.equal(attempts,2);
});
test('统一speech使用映射模型音色和同Provider凭据，显式覆盖默认且格式真实',async t=>{
 const {dataStore}=await fixture(t);const calls=[];
 const service=createChat2ApiSpeechService({dataStore,apiAdapters:{'qwen-api':{generate:async(...args)=>{calls.push(args);return audio;}}}});
 assert.deepEqual(await service.generate({model:'qiaoxiaojiao',input:'正文'}),{audio,contentType:'audio/wav'});
 assert.equal(calls[0][0].model,'qwen-audio-3.1-tts-flash');assert.equal(calls[0][0].voice,'qiaoxiaojiao_v3.1');assert.equal(calls[0][1],'fictional-key');
 await service.generate({model:'qiaoxiaojiao',input:'第二句',voice:'another'});assert.equal(calls[1][0].voice,'another');
 await dataStore.updateAccount('one',{enabled:false});
 await assert.rejects(service.generate({model:'qiaoxiaojiao',input:'不能换号'}),e=>e.code==='no_available_speech_account');
});
test('统一Responses返回output_audio，旧speech仍WAV且TTS不建立聊天会话',async t=>{
 const {rootDir,dataStore}=await fixture(t);let calls=0;
 const runtime=createChat2ApiRuntime({rootDir,dataStore,host:'127.0.0.1',port:0,apiSpeechAdapters:{'qwen-api':{generate:async()=>{calls++;return audio;}}}});
 await runtime.start();t.after(()=>runtime.stop());const key=await dataStore.createApiKey({label:'local'});
 const base=`http://127.0.0.1:${runtime.getStatus().address.port}`;
 const post=(route,body)=>fetch(base+route,{method:'POST',headers:{Authorization:`Bearer ${key.value}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await post('/v1/responses',{model:'qiaoxiaojiao',input:'正文'});assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.model,'qiaoxiaojiao');assert.equal(body.output_text,'');
 assert.deepEqual(Buffer.from(body.output[0].content[0].data,'base64'),audio);
 assert.deepEqual(await dataStore.readCollection('responsesSessions',[]),[]);
 const old=await post('/v1/audio/speech',{model:'qiaoxiaojiao',input:'正文'});assert.equal(old.status,200);assert.equal(old.headers.get('content-type'),'audio/wav');
 assert.deepEqual(Buffer.from(await old.arrayBuffer()),audio);
 const bad=await post('/v1/responses',{model:'qiaoxiaojiao',input:[{role:'user',content:[{type:'input_image',image_url:'http://secret'}]}]});
 assert.equal(bad.status,400);assert.equal(calls,2);
});
