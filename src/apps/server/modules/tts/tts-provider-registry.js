"use strict";
const { createQwenChatProvider } = require('./qwen-chat-tts');
const { createDoubaoChatProvider } = require('./doubao-chat-tts');
const { QWEN_AUDIO_31_MODEL, normalizeQwenApiVoice } = require('../chat2api/chat2api-qwen-tts-models');
const { listQwenAudio31Voices } = require('../chat2api/chat2api-qwen-audio-voices');
const VOICE_CATALOGS=Object.freeze({'qwen-api':Object.freeze(listQwenAudio31Voices().map(voice=>voice.id)),'doubao-api':['zh_female_vv_uranus_bigtts']});
// 业务层只选择模型和显式音色；API连接、凭据、下载与协议均归Chat2API。
function createProviderRegistry({systemGenerate,systemVoices=async()=>[],qwenChat=null,chat2ApiSpeechService}={}) {
 const apiProvider=id=>({
  async generate(request,settings){
   if(!chat2ApiSpeechService)throw new Error('Chat2API语音服务不可用，请配置API账号');
   const model=id==='qwen-api' ? `qwen-api/${QWEN_AUDIO_31_MODEL}` : settings.model||'doubaapi/tts';
   const explicit=request.parameterOverrides||{...(request.voice?{voice:request.voice}:{}),speed:Math.pow(2,(request.speed??0)/10),volume:request.volume??100};
   const result=await chat2ApiSpeechService.generate({input:request.text,...explicit,model,...(id==='qwen-api' && explicit.voice ? {voice:normalizeQwenApiVoice(explicit.voice)} : {}),response_format:'wav'},
    {timeoutMs:request.timeoutMs,signal:request.signal,parameterDefaults:request.parameterDefaults,expectedProviderId:id==='qwen-api'?'qwen-api':'doubaapi',legacyReplyContext:{businessType:request.businessType,userText:request.userText}});
   return result.audio;
  },
  async voices(settings={}){
   const model=id==='qwen-api' ? `qwen-api/${QWEN_AUDIO_31_MODEL}` : settings.model||'doubaapi/tts';
   if(!chat2ApiSpeechService?.voices)throw new Error('Chat2API音色服务不可用');
   return chat2ApiSpeechService.voices(model);
  }
 });
 return Object.freeze({system:{generate:systemGenerate,voices:systemVoices},'qwen-api':apiProvider('qwen-api'),'doubao-api':apiProvider('doubao-api'),
  'qwen-chat':qwenChat||createQwenChatProvider({speechService:chat2ApiSpeechService}),'doubao-chat':createDoubaoChatProvider({speechService:chat2ApiSpeechService})});
}
module.exports={createProviderRegistry,VOICE_CATALOGS};
