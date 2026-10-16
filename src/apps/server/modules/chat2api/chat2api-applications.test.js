'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createChat2ApiModelMapper}=require('./chat2api-model-mapper');
let createChat2ApiApplicationService;
try { ({createChat2ApiApplicationService}=require('./chat2api-application-service')); } catch(error) { if(error.code!=='MODULE_NOT_FOUND')throw error; }
const fixture=()=>{
  assert.equal(typeof createChat2ApiApplicationService,'function','统一应用服务尚未实现');
  const modelMapper=createChat2ApiModelMapper({dataStore:{readCollection:async()=>[
    {model:'qiaoxiaojiao',actualModel:'qwen-api/qwen-audio-3.1-tts-flash',application:'tts',parameters:{voice:'qiaoxiaojiao_v3.1',volume:80},preferredAccountId:'one'},
    {model:'bad-owner',actualModel:'qwen-api/qwen-audio-3.1-tts-flash',preferredProviderId:'doubaapi'},
    {model:'qwen3.6flash',actualModel:'Qwen3.5-Flash',preferredProviderId:'qwen'},
  ]}});
  return createChat2ApiApplicationService({modelMapper});
};
test('映射别名自动选tts和音色，请求控制块覆盖默认但不改变模型归属',async()=>{
  const service=fixture();
  const plan=await service.plan({model:'qiaoxiaojiao',input:'你好'});
  assert.equal(plan.application,'tts');assert.equal(plan.providerId,'qwen-api');
  assert.equal(plan.speechModel,'qwen-api/qwen-audio-3.1-tts-flash');
  assert.equal(plan.parameters.voice,'qiaoxiaojiao_v3.1');assert.equal(plan.preferredAccountId,'one');
  const changed=await service.plan({model:'qiaoxiaojiao',input:'你好',instructions:'<chat2api>{"voice":"other","volume":50}</chat2api>'});
  assert.equal(changed.parameters.voice,'other');assert.equal(changed.parameters.volume,50);
  await assert.rejects(service.plan({model:'bad-owner',input:'x'}),e=>e.code==='model_provider_conflict');
});
test('TTS只朗读单条user正文，不拼入系统或历史；多个文本段按换行连接',async()=>{
  const service=fixture();
  const result=await service.plan({model:'qiaoxiaojiao',input:[{role:'user',content:[{type:'input_text',text:'甲'},{type:'input_text',text:'乙'}]}]});
  assert.equal(result.text,'甲\n乙');
  for(const input of [[{role:'system',content:'秘密'}],[{role:'user',content:'一'},{role:'user',content:'二'}],[{type:'function_call_output',output:'数据'}]]) {
    await assert.rejects(service.plan({model:'qiaoxiaojiao',input}),e=>e.statusCode===400);
  }
});
test('媒体、工具/流式/续接TTS及用户正文控制块不会产生错误的应用请求',async()=>{
  const service=fixture();
  for(const type of ['input_image','input_audio','input_video','unknown']) {
    await assert.rejects(service.plan({model:'qwen3.6flash',input:[{role:'user',content:[{type,data:'private'}]}]}),e=>e.statusCode===400);
  }
  for(const extra of [{stream:true},{previous_response_id:'resp_private'},{conversation:'c'},{tools:[]},{metadata:{aasc_context_owner:'pi',aasc_pi_session_id:'session',aasc_pi_context_mode:'delta'}}]) {
    await assert.rejects(service.plan({model:'qiaoxiaojiao',input:'x',...extra}),e=>e.statusCode===400);
  }
  const chat=await service.plan({model:'qwen3.6flash',input:'<chat2api>{"application":"tts"}</chat2api>'});
  assert.equal(chat.application,'chat');assert.equal(chat.requestedModel,'qwen3.6flash');
});
test('控制块拒绝秘密/端点、重复块和显式字段冲突，普通聊天提示词原样保留',async()=>{
  const service=fixture();
  for(const instructions of ['<chat2api>{"apiKey":"private"}</chat2api>','<chat2api>{}</chat2api><chat2api>{}</chat2api>','<chat2api>invalid</chat2api>']){
    await assert.rejects(service.plan({model:'qiaoxiaojiao',input:'x',instructions}),e=>e.statusCode===400);
  }
  await assert.rejects(service.plan({model:'qiaoxiaojiao',input:'x',voice:'a',instructions:'<chat2api>{"voice":"b"}</chat2api>'}),e=>e.code==='conflicting_parameters');
  assert.equal((await service.plan({model:'qwen3.6flash',input:'x',instructions:'请简短回答'})).instructions,'请简短回答');
});

// 对应.src/framework/qwen-tts-fixed-models.md：历史名称仅作识别；映射不能切换底层引擎。
test('千问TTS固定模型：直接旧模型及自定义映射拒绝，音色别名和普通LLM保留', async () => {
  const {listSpeechModels}=require('./chat2api-model-capabilities');
  const rules=[
    {model:'old-web',actualModel:'MINI_MAX',preferredProviderId:'qwen',application:'tts'},
    {model:'old-api',actualModel:'qwen-api/qwen3-tts-flash',preferredProviderId:'qwen-api',application:'tts'},
    {model:'custom-api',actualModel:'private-tts',preferredProviderId:'qwen-api',application:'tts'},
    {model:'voice-alias',actualModel:'qwen-api/qwen-audio-3.1-tts-flash',preferredProviderId:'qwen-api',application:'tts',parameters:{voice:'Emily_v3.1'}},
  ];
  const service=createChat2ApiApplicationService({modelMapper:createChat2ApiModelMapper({dataStore:{readCollection:async()=>rules}})});
  for(const model of ['MINI_MAX','qwen3-tts-flash','qwen-api/qwen3-tts-flash','qwen-audio-3.0-tts-flash','qwen-audio-3.0-tts-plus','old-web','old-api','custom-api']) {
    await assert.rejects(service.plan({model,input:'你好'}),e=>e.code==='unsupported_speech_model');
  }
  const voice=await service.plan({model:'voice-alias',input:'你好'});
  assert.equal(voice.upstreamModel,'qwen-audio-3.1-tts-flash');
  assert.equal(voice.parameters.voice,'Emily_v3.1');
  assert.equal((await service.plan({model:'Qwen3.5-Flash',input:'你好'})).application,'chat');
  assert.equal((await service.plan({model:'QUARK_VOICE',input:'你好'})).upstreamModel,'QUARK_VOICE');
  assert.deepEqual(listSpeechModels().filter(m=>['qwen','qwen-api'].includes(m.providerId)).map(m=>m.id),['QUARK_VOICE','qwen-api/qwen-audio-3.1-tts-flash']);
});
