'use strict';
const {assertChatContent,normalizeTtsInput}=require('./chat2api-content');
const {applicationError,validateParameters,parseSystemControls}=require('./chat2api-system-controls');
const {canonicalProviderId,getSpeechBinding}=require('./chat2api-model-capabilities');
const {randomUUID}=require('node:crypto');
const {assertFixedQwenTtsModel,normalizeQwenApiVoice}=require('./chat2api-qwen-tts-models');
function createChat2ApiApplicationService({modelMapper,speechService}={}) {
  const plan=async(request,{defaultModel,parameterDefaults={}}={})=>{
    if(!request||typeof request!=='object'||Array.isArray(request))throw applicationError('invalid_request_error','请求必须是对象');
    const requestedModel=request.model??defaultModel;
    if(typeof requestedModel!=='string'||!requestedModel.trim())throw applicationError('invalid_request_error','缺少model');
    assertChatContent(request.input);
    const mapping=modelMapper?await modelMapper.resolveModel(requestedModel):{actualModel:requestedModel};
    const parsed=parseSystemControls(request.instructions);
    const owner=canonicalProviderId(mapping.preferredProviderId);
    const binding=getSpeechBinding(mapping.actualModel,owner,mapping.application);
    if(binding)assertFixedQwenTtsModel(binding.providerId,binding.upstreamModel);
    const application=parsed.controls.application||mapping.application||(binding?'tts':'chat');
    if(mapping.application&&mapping.application!==application)throw applicationError('unsupported_application','请求应用与模型映射不一致');
    const explicit=Object.fromEntries(['voice','speed','volume'].filter(k=>request[k]!==undefined).map(k=>[k,request[k]]));
    if(request.response_format!==undefined)explicit.format=request.response_format;
    for(const [key,value] of Object.entries(explicit))if(parsed.controls[key]!==undefined&&value!==parsed.controls[key])throw applicationError('conflicting_parameters','显式参数与系统控制块冲突');
    const {application:unused,...controlParameters}=parsed.controls;
    const parameters=validateParameters({...mapping.parameters,...controlParameters,...explicit});
    if(application==='chat') {
      if(binding||Object.keys(parameters).length)throw applicationError('unsupported_application','该模型或合成参数不能用于聊天');
      if(request.output_modalities!==undefined&&(!Array.isArray(request.output_modalities)||request.output_modalities.length!==1||request.output_modalities[0]!=='text'))throw applicationError('unsupported_modality','聊天输出目前仅文字');
      return {application,requestedModel,instructions:parsed.instructions,preferredProviderId:owner,preferredAccountId:mapping.preferredAccountId};
    }
    if(!binding)throw applicationError('unsupported_application','该模型未登记语音应用');
    if(owner&&owner!==binding.providerId)throw applicationError('model_provider_conflict','模型与Provider映射冲突');
    if(request.stream===true||['tools','previous_response_id','conversation','pi_context','piContext'].some(k=>request[k]!==undefined)
      ||request.metadata?.aasc_context_owner==='pi'||request.metadata?.aasc_pi_session_id!==undefined||request.metadata?.aasc_pi_context_mode!==undefined)throw applicationError('unsupported_tts_option','TTS不接受流式、工具或聊天续接参数');
    if(parsed.instructions)throw applicationError('unsupported_instruction','该TTS模型不接受自然语言风格指令');
    if(request.output_modalities!==undefined&&(!Array.isArray(request.output_modalities)||request.output_modalities.length!==1||request.output_modalities[0]!=='audio'))throw applicationError('unsupported_modality','TTS输出仅音频');
    const text=normalizeTtsInput(request.input);
    if(binding.providerId==='qwen-api'&&Array.from(text).length>600)throw applicationError('invalid_speech_request','Qwen TTS单次文本不能超过600字符');
    const speechParameters={voice:binding.voice,speed:1,volume:100,format:'wav',...validateParameters(parameterDefaults),...parameters};
    if(binding.providerId==='qwen-api')speechParameters.voice=normalizeQwenApiVoice(speechParameters.voice);
    return {application,requestedModel,...binding,text,preferredProviderId:binding.providerId,preferredAccountId:mapping.preferredAccountId,
      parameters:speechParameters,instructions:''};
  };
  const createAudioResponse=async(request,planned,options={})=>{
    if(!speechService)throw Object.assign(new Error('语音服务不可用'),{statusCode:503,code:'speech_unavailable'});
    const result=await speechService.generate(request,{...options,resolvedPlan:planned});
    return {body:{id:`resp_${randomUUID().replaceAll('-','')}`,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:planned.requestedModel,
      output:[{id:`msg_${randomUUID().replaceAll('-','')}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_audio',format:'wav',mime_type:'audio/wav',data:result.audio.toString('base64')}]}],output_text:''}};
  };
  return {plan,createAudioResponse};
}
module.exports={createChat2ApiApplicationService};
