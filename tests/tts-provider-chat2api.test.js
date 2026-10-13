'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createProviderRegistry}=require('../src/apps/server/modules/tts/tts-provider-registry');
const {normalizeSettings}=require('../src/apps/server/modules/tts/tts-provider-settings');
const {wrapPcm}=require('../src/external/tts/tts-wav');
const audio=wrapPcm(Buffer.from([1,0,2,0]));
test('四路业务全部只调用Chat2API，API旧凭据和端点不传入生成，映射音色不被业务默认覆盖',async()=>{
 const calls=[];const registry=createProviderRegistry({chat2ApiSpeechService:{generate:async(...args)=>{calls.push(args);return {audio};},voices:async()=>[]}});
 for(const [provider,model] of [['qwen-api','qiaoxiaojiao'],['doubao-api',''],['qwen-chat','QUARK_VOICE'],['doubao-chat','doubao-chat']]){
   const settings=normalizeSettings().providers[provider];
   await registry[provider].generate({text:'业务正文',speed:0,volume:100}, {...settings,model,enabled:true,credential:'must-not-forward',endpoint:'http://must-not-fetch'});
 }
 assert.equal(calls.length,4);assert.equal(calls[0][0].model,'qiaoxiaojiao');assert.equal(calls[0][0].voice,undefined);
 assert.equal(calls[1][0].model,'doubaapi/tts');assert.ok(!JSON.stringify(calls).includes('must-not'));
});
test('业务模型配置允许别名，旧API秘密留作回滚但公开配置不泄露端点或重复密钥状态',()=>{
 const settings=normalizeSettings({providers:{'qwen-chat':{model:'custom-voice'},'qwen-api':{model:'qiaoxiaojiao'}}});
 assert.equal(settings.providers['qwen-chat'].model,'custom-voice');
});
