'use strict';
const {QWEN_VOICE}=require('./chat2api-qwen-speech-adapter');
const {DOUBAO_SPEECH_VOICE}=require('./chat2api-doubao-speech-protocol');
const canonicalProviderId=id=>({doubao:'doubaochat','doubao-api':'doubaapi','qwen-chat':'qwen'})[id]||id;
const bindings=new Map();
function register(ids,binding){for(const id of ids)bindings.set(id.toLowerCase(),Object.freeze(binding));}
register(['qwen-chat','QUARK_VOICE'],{providerId:'qwen',speechModel:'QUARK_VOICE',upstreamModel:'QUARK_VOICE',voice:QWEN_VOICE});
register(['MINI_MAX'],{providerId:'qwen',speechModel:'MINI_MAX',upstreamModel:'MINI_MAX',voice:QWEN_VOICE});
register(['doubao-chat'],{providerId:'doubaochat',speechModel:'doubao-chat',upstreamModel:'doubao-chat',voice:DOUBAO_SPEECH_VOICE});
for(const model of ['qwen-audio-3.1-tts-flash','qwen-audio-3.0-tts-flash','qwen-audio-3.0-tts-plus','qwen3-tts-flash'])register([model,`qwen-api/${model}`],{providerId:'qwen-api',speechModel:`qwen-api/${model}`,upstreamModel:model,voice:model==='qwen-audio-3.1-tts-flash'?'qiaoxiaojiao_v3.1':'Cherry'});
register(['doubaapi/tts','doubao-api/tts'],{providerId:'doubaapi',speechModel:'doubaapi/tts',upstreamModel:'',voice:'zh_female_vv_uranus_bigtts'});
// 已登记别名按确切名称解析；显式API应用映射可登记用户自己的模型，不开放任意前缀直通。
function getSpeechBinding(model,providerId,application) {
  const known=bindings.get(String(model||'').toLowerCase());
  if(known)return {...known};
  const owner=canonicalProviderId(providerId);
  if(application==='tts'&&['qwen-api','doubaapi'].includes(owner)&&typeof model==='string'&&/^[\w.\/-]{1,200}$/u.test(model))return {providerId:owner,speechModel:model,upstreamModel:model,voice:owner==='qwen-api'?'Cherry':'zh_female_vv_uranus_bigtts'};
  return null;
}
const listSpeechModels=()=>[...bindings].filter(([id,b])=>id===b.speechModel.toLowerCase()).map(([id,b])=>({id:b.speechModel,providerId:b.providerId,application:'tts',input_modalities:['text'],output_modalities:['audio'],stream:false}));
module.exports={canonicalProviderId,getSpeechBinding,listSpeechModels};
