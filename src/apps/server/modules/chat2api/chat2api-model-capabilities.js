'use strict';
const {QWEN_VOICE}=require('./chat2api-qwen-speech-adapter');
const {QWEN_AUDIO_31_MODEL,QWEN_WEB_TTS_MODEL,QWEN_API_DEFAULT_VOICE}=require('./chat2api-qwen-tts-models');
const {DOUBAO_SPEECH_VOICE}=require('./chat2api-doubao-speech-protocol');
const canonicalProviderId=id=>({doubao:'doubaochat','doubao-api':'doubaapi','qwen-chat':'qwen'})[id]||id;
const bindings=new Map();
function register(ids,binding){for(const id of ids)bindings.set(id.toLowerCase(),Object.freeze(binding));}
register(['qwen-chat',QWEN_WEB_TTS_MODEL],{providerId:'qwen',speechModel:QWEN_WEB_TTS_MODEL,upstreamModel:QWEN_WEB_TTS_MODEL,voice:QWEN_VOICE});
register(['MINI_MAX'],{providerId:'qwen',speechModel:'MINI_MAX',upstreamModel:'MINI_MAX',voice:QWEN_VOICE});
register(['doubao-chat'],{providerId:'doubaochat',speechModel:'doubao-chat',upstreamModel:'doubao-chat',voice:DOUBAO_SPEECH_VOICE});
for(const model of [QWEN_AUDIO_31_MODEL,'qwen-audio-3.0-tts-flash','qwen-audio-3.0-tts-plus','qwen3-tts-flash'])register([model,`qwen-api/${model}`],{providerId:'qwen-api',speechModel:`qwen-api/${model}`,upstreamModel:model,voice:model===QWEN_AUDIO_31_MODEL?QWEN_API_DEFAULT_VOICE:'Cherry'});
register(['doubaapi/tts','doubao-api/tts'],{providerId:'doubaapi',speechModel:'doubaapi/tts',upstreamModel:'',voice:'zh_female_vv_uranus_bigtts'});
// 已登记别名按确切名称解析；旧Qwen绑定保留识别以明确拒绝，豆包API仍允许显式应用映射。
function getSpeechBinding(model,providerId,application) {
  const known=bindings.get(String(model||'').toLowerCase());
  if(known)return {...known};
  const owner=canonicalProviderId(providerId);
  if(application==='tts'&&['qwen-api','doubaapi'].includes(owner)&&typeof model==='string'&&/^[\w.\/-]{1,200}$/u.test(model))return {providerId:owner,speechModel:model,upstreamModel:model,voice:owner==='qwen-api'?'Cherry':'zh_female_vv_uranus_bigtts'};
  return null;
}
// 历史绑定仅用于识别并拒绝请求；公开目录只暴露仍可生成的固定引擎。
const isSupportedSpeechBinding=b=>!b||!['qwen','qwen-api'].includes(b.providerId)||b.upstreamModel===(b.providerId==='qwen'?QWEN_WEB_TTS_MODEL:QWEN_AUDIO_31_MODEL);
const listSpeechModels=()=>[...bindings].filter(([id,b])=>id===b.speechModel.toLowerCase()&&isSupportedSpeechBinding(b)).map(([id,b])=>({id:b.speechModel,providerId:b.providerId,application:'tts',input_modalities:['text'],output_modalities:['audio'],stream:false}));
module.exports={canonicalProviderId,getSpeechBinding,listSpeechModels,isSupportedSpeechBinding};
