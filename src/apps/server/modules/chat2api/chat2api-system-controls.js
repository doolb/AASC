'use strict';
const applicationError=(code,message)=>Object.assign(new Error(message),{statusCode:400,code});
const PARAMETER_KEYS=new Set(['voice','speed','volume','format']);
// 系统控制面只接收明确的应用及合成参数，绝不把任意字段透传为上游请求。
function validateParameters(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!PARAMETER_KEYS.has(k)))throw applicationError('invalid_system_controls','合成参数不合法');
  const result={...value};
  if(result.voice!==undefined&&(typeof result.voice!=='string'||!result.voice.trim()||result.voice.length>512||/[\r\n\x00-\x1f]/u.test(result.voice)))throw applicationError('invalid_system_controls','音色参数不合法');
  if(result.voice!==undefined)result.voice=result.voice.trim();
  for(const [key,min,max] of [['speed',0.25,4],['volume',0,100]])if(result[key]!==undefined&&(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<min||result[key]>max))throw applicationError('invalid_system_controls','合成参数超出范围');
  if(result.format!==undefined&&result.format!=='wav')throw applicationError('invalid_system_controls','语音仅支持WAV');
  return result;
}
function parseSystemControls(instructions) {
  if(instructions===undefined||instructions===null)return {controls:{},instructions:''};
  if(typeof instructions!=='string')throw applicationError('invalid_system_controls','instructions必须是字符串');
  if(!instructions.startsWith('<chat2api>'))return {controls:{},instructions};
  const end=instructions.indexOf('</chat2api>');
  if(end<0||Buffer.byteLength(instructions.slice(0,end),'utf8')>4096||instructions.slice(end+11).includes('<chat2api>'))throw applicationError('invalid_system_controls','系统控制块不合法');
  let controls;
  try {controls=JSON.parse(instructions.slice('<chat2api>'.length,end));}catch(error){throw applicationError('invalid_system_controls','系统控制块JSON不合法');}
  if(!controls||typeof controls!=='object'||Array.isArray(controls))throw applicationError('invalid_system_controls','系统控制块必须是对象');
  const {application,...parameters}=controls;
  if(application!==undefined&&!['chat','tts'].includes(application))throw applicationError('unsupported_application','应用尚未接入');
  return {controls:{...(application?{application}:{}),...validateParameters(parameters)},instructions:instructions.slice(end+11).trim()};
}
function validateMappingExtension(mapping) {
  if(mapping.application!==undefined&&!['chat','tts'].includes(mapping.application))throw applicationError('unsupported_application','模型映射应用不合法');
  if(mapping.parameters!==undefined)validateParameters(mapping.parameters);
  return mapping;
}
module.exports={applicationError,validateParameters,parseSystemControls,validateMappingExtension};
