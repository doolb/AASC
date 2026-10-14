'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDoubaoChatProvider } = require('../src/apps/server/modules/tts/doubao-chat-tts');
const { normalizeSettings,redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { validateBusinessProvider } = require('../src/apps/server/modules/tts/tts-provider-policy');
const { normalizeTemplateTts } = require('../src/apps/server/modules/tts/tts-provider-policy');
const { createProviderRegistry } = require('../src/apps/server/modules/tts/tts-provider-registry');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { wrapPcm } = require('../src/external/tts/tts-wav');
const { DOUBAO_SPEECH_VOICE } = require('../src/apps/server/modules/chat2api/chat2api-doubao-speech-protocol');

test('豆包网页TTS默认禁用且上游固定参数，无凭据/账号字段，仅AI/Agent可选',()=>{
    const defaults=normalizeSettings();const value=defaults.providers['doubao-chat'];
    assert.equal(value.enabled,false);assert.equal(value.defaultVoice,DOUBAO_SPEECH_VOICE);
    assert.ok(!Object.hasOwn(value,'credential'));assert.ok(!Object.hasOwn(value,'chat2apiAccountId'));
    assert.equal(validateBusinessProvider('doubao-chat','ai_reply'),'doubao-chat');
    assert.equal(validateBusinessProvider('doubao-chat','agent_reply'),'doubao-chat');
    for(const business of ['text_media','system_broadcast'])assert.throws(()=>validateBusinessProvider('doubao-chat',business));
    for(const patch of [{model:'QUARK_VOICE'},{endpoint:'https://example.com'},{defaultVoice:'other'},
        {credential:'private-cookie'},{chat2apiAccountId:'private-id'}]){
        assert.throws(()=>normalizeSettings({providers:{'doubao-chat':patch}}));
    }
    assert.equal(normalizeSettings({defaultSpeed:2,defaultVolume:90}).defaultSpeed,2);
    assert.equal(normalizeSettings({defaultSpeed:2,defaultVolume:90}).defaultVolume,90);
    assert.ok(!Object.hasOwn(value,'defaultSpeed'));assert.ok(!Object.hasOwn(value,'defaultVolume'));
    assert.ok(!JSON.stringify(redactSettings(defaults)).includes('private'));
    assert.deepEqual(normalizeSettings(defaults),defaults);
});
test('业务薄层接受共享参数但向上游发送固定WAV参数，不降级其它Provider',async()=>{
    const audio=wrapPcm(Buffer.from([1,0]));const calls=[];
    const provider=createDoubaoChatProvider({speechService:{generate:async(...args)=>{calls.push(args);return {audio,contentType:'audio/wav'}}}});
    const settings=normalizeSettings({providers:{'doubao-chat':{enabled:true}}}).providers['doubao-chat'];
    assert.equal(await provider.generate({text:'测试',voice:DOUBAO_SPEECH_VOICE,speed:2,volume:50,timeoutMs:1000},settings),audio);
    assert.deepEqual(calls[0][0],{input:'测试',model:'doubao-chat',voice:DOUBAO_SPEECH_VOICE,speed:1,volume:100,response_format:'wav'});
    await assert.rejects(provider.generate({text:'x',speed:2,volume:50},{...settings,enabled:false}));
    assert.equal(await provider.generate({text:'x',speed:1,volume:80},settings),audio);assert.equal(calls.length,2);
    const failed=createDoubaoChatProvider({speechService:{generate:async()=>{throw new Error('固定上游错误')}}});
    await assert.rejects(failed.generate({text:'x',speed:0,volume:100},settings),/固定上游错误/u);
});
test('现有Registry/ProviderService对新来源仍缓存WAV引用，音色查询不触发合成',async()=>{
    let calls=0;const pcm=Buffer.alloc(16);for(let i=0;i<8;i++)pcm.writeInt16LE(1000,i*2);const audio=wrapPcm(pcm);let stored;
    const settings=normalizeSettings({aiReplyDefault:{provider:'doubao-chat'},defaultSpeed:2,defaultVolume:50,providers:{'doubao-chat':{enabled:true}}});
    const registry=createProviderRegistry({systemGenerate:async()=>{},chat2ApiSpeechService:{generate:async()=>{calls++;return{audio,contentType:'audio/wav'}}}});
    const service=createTtsProviderService({getSettings:()=>settings,registry,storeAudio:bytes=>{stored=bytes;return'tts_mem_demo.wav'}});
    assert.equal(await service.generate({text:'本地测试',businessType:'ai_reply'}),'tts_mem_demo.wav');
    assert.notEqual(stored,audio);assert.equal(stored.readInt16LE(44),500);assert.equal(stored.length,56);
    const voices=await service.voices('doubao-chat');assert.equal(voices[0].id,DOUBAO_SPEECH_VOICE);assert.equal(calls,1);
});

test('豆包业务和模板不能保存其它音色，切换来源时不继承旧来源音色',()=>{
    assert.throws(()=>normalizeSettings({aiReplyDefault:{provider:'doubao-chat',voice:'other'}}));
    assert.throws(()=>normalizeTemplateTts({provider:'doubao-chat',voice:'other'}));
    const previous=normalizeSettings({aiReplyDefault:{provider:'qwen-api',voice:'Cherry'}});
    assert.equal(normalizeSettings({aiReplyDefault:{provider:'doubao-chat'}},previous).aiReplyDefault.voice,null);
});
