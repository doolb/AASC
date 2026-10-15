'use strict';
const { validateDoubaoVoice } = require('./chat2api-doubao-voices');
const { TextDecoder } = require('node:util');

// 业务标识和默认音色来自官网公开T57模块，并非用户的登录密钥；首版不自动切换飞书业务标识。
const DOUBAO_SPEECH_ENDPOINT = 'wss://frontier-audio-web-ws.doubao.com/api/v2/sami/voicegenie';
const DOUBAO_SPEECH_APPKEY = 'GOqQpfo1fO7slHv8';
const DOUBAO_SPEECH_VOICE = 'zh_female_wenroutaozi_uranus_bigtts';
const SPEECH_ERRORS = Object.freeze({
    doubao_speech_protocol: [502,'豆包网页语音返回无效协议数据'],
    doubao_speech_credentials: [422,'豆包网页语音凭据格式无效'],
    doubao_speech_auth: [401,'豆包网页登录已失效，请更新所选账号'],
    doubao_speech_risk: [403,'豆包网页语音要求安全验证，请在官网处理'],
    doubao_speech_rate: [429,'豆包网页语音请求过于频繁'],
    doubao_speech_upstream: [502,'豆包网页语音合成失败'],
    doubao_speech_incomplete: [502,'豆包网页语音未完整结束'],
    doubao_speech_audio: [502,'豆包网页语音音频无效或不完整'],
    doubao_speech_limit: [502,'豆包网页语音超过安全容量上限'],
    doubao_speech_cancelled: [499,'豆包网页语音已取消'],
    doubao_speech_timeout: [504,'豆包网页语音生成超时'],
    doubao_speech_busy: [503,'豆包语音等待队列已满，请稍后重试'],
    doubao_speech_binding: [503,'豆包语音账号选择无效，请在Chat2API登录并启用豆包账号']
});
function doubaoSpeechError(code) {
    const safe = Object.hasOwn(SPEECH_ERRORS,code) ? code : 'doubao_speech_upstream';
    const [statusCode,message] = SPEECH_ERRORS[safe]; return Object.assign(new Error(message),{statusCode,code:safe});
}
function invalid() { throw doubaoSpeechError('doubao_speech_protocol'); }
function varint(value) {
    let number=BigInt(value); const bytes=[];
    do { const byte=Number(number&127n);number>>=7n;bytes.push(byte|(number?128:0)); } while(number);
    return Buffer.from(bytes);
}
const REQUEST_FIELDS = Object.freeze({ appkey:2, namespace:3, event:5, payload:6, task_id:8, session_id:10 });
function encodeSpeechRequest(request) {
    const parts=[];
    for(const [key,id] of Object.entries(REQUEST_FIELDS)) {
        if(request[key]===undefined)continue;
        if(typeof request[key]!=='string')invalid();
        const bytes=Buffer.from(request[key]);if(bytes.length>512*1024)invalid();
        parts.push(varint((id<<3)|2),varint(bytes.length),bytes);
    }
    const result=Buffer.concat(parts);if(result.length>512*1024)invalid();return result;
}
const RESPONSE_FIELDS = Object.freeze({1:['task_id',2,128],3:['namespace',2,64],4:['event',2,64],
    5:['status_code',0],8:['data',2,1024*1024],10:['session_id',2,128]});

// 只提取任务身份/事件/音频；status_text、payload、log_id等原文完全不返回到业务层。
function decodeSpeechResponse(bytes) {
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>1024*1024)invalid();
    const result={status_code:0,data:Buffer.alloc(0)};const seen=new Set();let cursor=0,fields=0;
    const read=()=>{let number=0n;for(let index=0;index<10;index++){
        if(cursor>=bytes.length)invalid();const byte=bytes[cursor++];
        if(index===9&&byte>1)invalid();number|=BigInt(byte&127)<<(7n*BigInt(index));if(!(byte&128))return number;
    }invalid()};
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    while(cursor<bytes.length){
        if(++fields>128)invalid();const tag=read();if(tag>0xffffffffn||tag<8n)invalid();
        const id=Number(tag>>3n),wire=Number(tag&7n),field=RESPONSE_FIELDS[id];
        if(field&&(seen.has(id)||field[1]!==wire))invalid();if(field)seen.add(id);
        let value;
        switch(wire){
            case 0:value=read();break;
            case 1:cursor+=8;break;
            case 5:cursor+=4;break;
            case 2:{const size=read();if(size>BigInt(bytes.length-cursor))invalid();
                const length=Number(size);if(field&&length>field[2])invalid();
                value=bytes.subarray(cursor,cursor+length);cursor+=length;break;}
            default:invalid();
        }
        if(cursor>bytes.length)invalid();if(!field)continue;
        if(wire===0){result[field[0]]=Number(BigInt.asIntN(32,value));continue;}
        if(field[0]==='data'){result.data=value;continue;}
        try{result[field[0]]=decoder.decode(value)}catch{invalid()}
    }
    if(!result.event||!/^[A-Za-z]{1,64}$/u.test(result.event))invalid();
    return result;
}

function createTextTtsSession({ voice = DOUBAO_SPEECH_VOICE } = {}) {
    const postProcess={pitch:0,speech_rate:1};const cache={text_type:1,use_cache:true};
    return {business:1,conversation_id:'',request_type:5,enable_text_reading:true,interrupt_type:0,query_mode:2,
        chat:{bot_id:'7338286299411103781',conversation_id:'',question_id:'0',message_id:'',new_conversation:true,extra:{}},
        tts:{speaker:validateDoubaoVoice(voice),audio_config:{bit_rate:32000,format:'ogg_opus',sample_rate:24000},
            extra:{cache_config:cache,network_level:7,post_process:postProcess,music_ext_for_tts:''}},
        extra:{enable_text_simple_report:true,enable_section_report:true,enable_card_simple_report:true,
            enable_image_asr_ctx:true,disable_markdown_filter:true,enable_asr_audio_context:false,is_server_error_retry:false,
            extra:JSON.stringify({post_process:postProcess,cache_config:cache,music_ext_for_tts:'',network_level:7})}};
}
module.exports={encodeSpeechRequest,decodeSpeechResponse,createTextTtsSession,doubaoSpeechError,
    DOUBAO_SPEECH_ENDPOINT,DOUBAO_SPEECH_APPKEY,DOUBAO_SPEECH_VOICE,SPEECH_ERRORS};
