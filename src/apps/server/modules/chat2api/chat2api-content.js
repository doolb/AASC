'use strict';
const {applicationError}=require('./chat2api-system-controls');
const TEXT_TYPES=new Set(['text','input_text','output_text']);
// 在旧extractText之前检查所有内容片段，媒体不能被当作空字符串而误报成功。
function assertTextOnly(input) {
  if(input===undefined||input===null||typeof input==='string')return;
  if(!Array.isArray(input))throw applicationError('invalid_input','input内容格式不合法');
  for(const item of input) {
    if(!item||typeof item!=='object')throw applicationError('invalid_input','内容片段必须是对象');
    if(item.type&&['input_image','image_url','image','input_audio','audio','input_video','video','video_url'].includes(item.type))throw applicationError('unsupported_modality','该模型的媒体能力尚未接入');
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
/** 聊天允许独立图片片段；语音入口继续使用严格的纯文本校验。 */
function imageUrl(part) { return part.type === 'input_image' ? part.image_url : part.image_url?.url; }
function assertChatContent(input) {
  if(input===undefined||input===null||typeof input==='string')return;
  if(!Array.isArray(input))throw applicationError('invalid_input','input内容格式不合法');
  for(const item of input) {
    if(!item||typeof item!=='object')throw applicationError('invalid_input','内容片段必须是对象');
    if (['input_video', 'video_url'].includes(item.type)) {
      const id = item.file_id || item.video_url?.file_id;
      if (!/^chat_file_[a-f0-9-]{36}$/.test(id || '')) throw applicationError('invalid_input','视频请先通过/v1/chat/files上传，再传file_id');
      continue;
    }
    if(['input_image','image_url'].includes(item.type)) {
      const url=imageUrl(item);
      if(typeof url!=='string'||url.length>28*1024*1024||!/^https:\/\/[^\s]+$|^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url))throw applicationError('invalid_input','图片需使用HTTPS或有效图片Data URL');
      continue;
    }
    if(['input_audio','audio','input_video','video','image'].includes(item.type))throw applicationError('unsupported_modality','该媒体上传能力尚未接入');
    if(item.type&&!TEXT_TYPES.has(item.type)&&!['message','function_call','function_call_output'].includes(item.type))throw applicationError('invalid_input','未知内容类型');
    if(TEXT_TYPES.has(item.type)&&typeof item.text!=='string')throw applicationError('invalid_input','文字片段缺少文本');
    if(item.content!==undefined)assertChatContent(item.content);
    if(item.type==='function_call_output')assertTextOnly(item.output);
  }
}
function normalizeChatContent(content) {
  if(!Array.isArray(content))return content;
  // 旧纯文字请求仍输出字符串，避免改变工具与原生文字适配器的契约。
  if(!content.some(p=>['input_image','image_url','input_video','video_url'].includes(p?.type)))return content.map(p=>p.text||'').join('');
  return content.map(p=>['input_video','video_url'].includes(p.type) ? {type:'video_url',video_url:{file_id:p.file_id||p.video_url?.file_id}} : ['input_image','image_url'].includes(p.type)
    ? {type:'image_url',image_url:{url:imageUrl(p),...((p.detail||p.image_url?.detail)?{detail:p.detail||p.image_url.detail}:{})}}
    : {type:'text',text:p.text||''});
}
function collectImages(messages=[]) { return messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>['input_image','image_url'].includes(p?.type)).map(imageUrl):[]); }
function collectVideos(messages=[]) { return [...new Set(messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>['input_video','video_url'].includes(p?.type)).map(p=>p.file_id||p.video_url?.file_id):[]))]; }
module.exports={assertTextOnly,assertChatContent,normalizeChatContent,collectImages,collectVideos,normalizeTtsInput};
