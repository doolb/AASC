'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createProviderRegistry}=require('../src/apps/server/modules/tts/tts-provider-registry');
const {normalizeSettings}=require('../src/apps/server/modules/tts/tts-provider-settings');
const {wrapPcm}=require('../src/external/tts/tts-wav');
const audio=wrapPcm(Buffer.from([1,0,2,0]));
test('四路业务全部只调用Chat2API，API旧凭据和端点不传入生成，映射音色不被业务默认覆盖',async()=>{
 const calls=[];const registry=createProviderRegistry({chat2ApiSpeechService:{generate:async(...args)=>{calls.push(args);return {audio};},voices:async()=>[]}});
 for(const [provider,model] of [['qwen-api','qiaoxiaojiao'],['doubao-api',''],['qwen-chat','MINI_MAX'],['doubao-chat','doubao-chat']]){
   const settings=normalizeSettings().providers[provider];
   await registry[provider].generate({text:'业务正文',speed:0,volume:100}, {...settings,model,enabled:true,credential:'must-not-forward',endpoint:'http://must-not-fetch'});
 }
 assert.equal(calls.length,4);assert.equal(calls[0][0].model,'qwen-api/qwen-audio-3.1-tts-flash');assert.equal(calls[0][0].voice,undefined);
 assert.equal(calls[2][0].model,'QUARK_VOICE');
 assert.equal(calls[1][0].model,'doubaapi/tts');assert.ok(!JSON.stringify(calls).includes('must-not'));
});
test('业务模型旧别名恢复固定值，新别名配置明确拒绝',()=>{
 const settings=normalizeSettings({providers:{'qwen-chat':{model:'custom-voice'},'qwen-api':{model:'qiaoxiaojiao'}}},{},{recoverLegacyModel:true});
 assert.equal(settings.providers['qwen-chat'].model,'QUARK_VOICE');
 assert.throws(()=>normalizeSettings({providers:{'qwen-api':{model:'qiaoxiaojiao'}}}),/固定/u);
});

// 对应.src/framework/qwen-tts-fixed-models.md：业务调用和音色查询均忽略旧模型，额外参数不能覆盖常量。
test('旧配置和参数覆盖不能改变两路模型，API旧音色生成时恢复乔小娇', async () => {
 const generated=[],queried=[];
 const registry=createProviderRegistry({chat2ApiSpeechService:{
   generate:async request=>{generated.push(request);return {audio};},
   voices:async model=>{queried.push(model);return [];}
 }});
 await registry['qwen-api'].voices({model:'qwen3-tts-flash'});
 assert.deepEqual(queried,['qwen-api/qwen-audio-3.1-tts-flash']);
 for(const provider of ['qwen-api','qwen-chat']) {
   await registry[provider].generate({text:'你好',speed:0,volume:100,parameterOverrides:{model:'MINI_MAX',voice:'Cherry'}},{model:'old-alias'});
 }
 assert.equal(generated[0].model,'qwen-api/qwen-audio-3.1-tts-flash');
 assert.equal(generated[0].voice,'qiaoxiaojiao_v3.1');
 assert.equal(generated[1].model,'QUARK_VOICE');
});
