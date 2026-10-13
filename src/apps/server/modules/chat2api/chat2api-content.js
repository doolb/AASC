'use strict';
const {applicationError}=require('./chat2api-system-controls');
const TEXT_TYPES=new Set(['text','input_text','output_text']);
// 在旧extractText之前检查所有内容片段，媒体不能被当作空字符串而误报成功。
function assertTextOnly(input) {
  if(input===undefined||input===null||typeof input==='string')return;
  if(!Array.isArray(input))throw applicationError('invalid_input','input内容格式不合法');
  for(const item of input) {
    if(!item||typeof item!=='object')throw applicationError('invalid_input','内容片段必须是对象');
    if(item.type&&['input_image','image_url','image','input_audio','audio','input_video','video'].includes(item.type))throw applicationError('unsupported_modality','该模型的媒体能力尚未接入');
    if(item.type&&!TEXT_TYPES.has(item.type)&&!['message','function_call','function_call_output'].includes(item.type))throw applicationError('invalid_input','未知内容类型');
    if(TEXT_TYPES.has(item.type)&&typeof item.text!=='string')throw applicationError('invalid_input','文字片段缺少文本');
    if(item.content!==undefined)assertTextOnly(item.content);
    if(item.type==='function_call_output')assertTextOnly(item.output);
  }
}
function normalizeTtsInput(input) {
  if(typeof input==='string'&&input.trim())return input;
  if(!Array.isArray(input)||input.length!==1||input[0]?.role!=='user'||(input[0].type&&input[0].type!=='message'))throw applicationError('invalid_tts_input','TTS只接受文本或单条user消息');
  const content=input[0].content;
  if(typeof content==='string'&&content.trim())return content;
  if(!Array.isArray(content)||!content.length||content.some(p=>!p||p.type!=='input_text'||typeof p.text!=='string'||!p.text.trim()))throw applicationError('invalid_tts_input','TTS内容必须为非空文字片段');
  return content.map(p=>p.text).join('\n');
}
module.exports={assertTextOnly,normalizeTtsInput};
