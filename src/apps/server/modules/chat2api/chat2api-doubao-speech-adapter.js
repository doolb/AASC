'use strict';
const WebSocket = require('ws');
const { createDoubaoSpeechQueue } = require('./chat2api-doubao-speech-queue');
const { decodeOggOpusToWav } = require('../../../../external/tts/tts-opus-decoder');
const { wrapPcm, validateWav, MAX_AUDIO_BYTES } = require('../../../../external/tts/tts-wav');
const { encodeSpeechRequest,decodeSpeechResponse,createTextTtsSession,doubaoSpeechError,
    DOUBAO_SPEECH_ENDPOINT,DOUBAO_SPEECH_APPKEY } = require('./chat2api-doubao-speech-protocol');

// 本模块独立于尚未发布的文字适配器；已知Cookie字段只进固定官方WS握手，不进入任何日志。
function getDoubaoSpeechCredential(account) {
    const cookie=typeof account==='string'?account:account?.credentials?.cookie;
    const allowed=new Set(['sessionid','passport_csrf_token','passport_csrf_token_default','msToken','ttwid','s_v_web_id']);
    if(typeof cookie!=='string'||!cookie||cookie.length>16384||/[^\x20-\x7e]/u.test(cookie))throw doubaoSpeechError('doubao_speech_credentials');
    const values=new Map();
    for(const segment of cookie.split(';')){const part=segment.trim(),index=part.indexOf('=');
        const name=part.slice(0,index),value=part.slice(index+1);
        if(index<1||!allowed.has(name)||values.has(name)||!value||value.length>4096
            ||!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/u.test(value))throw doubaoSpeechError('doubao_speech_credentials');
        values.set(name,value);
    }
    if(!/^[a-zA-Z0-9_-]{16,512}$/u.test(values.get('sessionid')||''))throw doubaoSpeechError('doubao_speech_credentials');
    return [...values].map(([name,value])=>`${name}=${value}`).join('; ');
}

function createDoubaoSpeechAdapter({createSocket=(url,options)=>new WebSocket(url,options),decodeAudio=decodeOggOpusToWav}={}) {
    const queue=createDoubaoSpeechQueue();
    return { async generate(request,credential,{accountId,signal,deadline=Date.now()+60000}={}) {
        if(signal?.aborted)throw doubaoSpeechError('doubao_speech_cancelled');
        if(!Number.isFinite(deadline)||deadline<=Date.now())throw doubaoSpeechError('doubao_speech_timeout');
        if(typeof accountId!=='string'||!accountId)throw doubaoSpeechError('doubao_speech_binding');
        const cookie=getDoubaoSpeechCredential(credential);
        const pending=queue.acquire(accountId,{signal,deadline});
        const release=typeof pending==='function'?pending:await pending;
        const check=()=>{if(signal?.aborted)throw doubaoSpeechError('doubao_speech_cancelled');
            if(Date.now()>=deadline)throw doubaoSpeechError('doubao_speech_timeout')};
        try {
            check();
            const sentences=await new Promise((resolve,reject)=>{
                let socket,timer,heartbeat,settled=false,phase='connecting',taskId='',sessionId='',events=0,total=0,lastPong=Date.now();
                let chunks=[],sentenceBytes=0;const complete=[];
                const cleanup=()=>{
                    clearTimeout(timer);clearInterval(heartbeat);signal?.removeEventListener('abort',abort);
                    if(!socket)return;
                    for(const [name,fn] of [['open',open],['message',message],['error',error],['close',close],['unexpected-response',handshake]])socket.removeListener(name,fn);
                    // ws在握手终止后会异步发error，保护到close；不打印底层异常及带凭据URL。
                    const ignore=()=>{};socket.once('error',ignore);socket.once('close',()=>socket.removeListener('error',ignore));
                    try{socket.terminate()}catch{}
                };
                const finish=(failure)=>{if(settled)return;settled=true;cleanup();chunks=[];
                    if(failure){complete.length=0;reject(failure)}else resolve(complete)};
                const send=(event,payload)=>{socket.send(encodeSpeechRequest({appkey:DOUBAO_SPEECH_APPKEY,namespace:'VoiceGenie',
                    event,payload:payload===undefined?'{}':JSON.stringify(payload),...(taskId?{task_id:taskId}:{}),...(sessionId?{session_id:sessionId}:{})}))};
                const abort=()=>finish(doubaoSpeechError('doubao_speech_cancelled'));
                const error=()=>finish(doubaoSpeechError('doubao_speech_upstream'));
                const close=()=>finish(doubaoSpeechError('doubao_speech_incomplete'));
                const handshake=(req,response)=>{const status=response?.statusCode;
                    req?.destroy();response?.destroy();finish(doubaoSpeechError(({401:'doubao_speech_auth',403:'doubao_speech_risk',429:'doubao_speech_rate'})[status]));};
                const open=()=>{if(settled)return;try{check();phase='task';send('StartTask');
                    heartbeat=setInterval(()=>{if(settled)return;try{check();if(Date.now()-lastPong>12000)throw doubaoSpeechError('doubao_speech_timeout');send('Ping')}catch(failure){finish(failure)}},8000);
                }catch(failure){finish(failure)}};
                const message=(bytes,isBinary)=>{if(settled)return;try{
                    check();if(isBinary===false||++events>10000)throw doubaoSpeechError('doubao_speech_protocol');
                    const event=decodeSpeechResponse(bytes);
                    // 官网VoiceGenie实际成功帧使用20000000；兼容旧帧省略状态字段时decoder提供的0。
                    // 只接受这两个明确成功值，未知非零值仍拒绝，避免误把上游失败推进到下一阶段。
                    if(event.status_code !== 0 && event.status_code !== 20000000)throw doubaoSpeechError(({401:'doubao_speech_auth',403:'doubao_speech_risk',429:'doubao_speech_rate'})[event.status_code]);
                    if(event.namespace!=='VoiceGenie')throw doubaoSpeechError('doubao_speech_protocol');
                    if(event.event==='Pong'){lastPong=Date.now();return;}
                    if(taskId&&event.task_id!==taskId)throw doubaoSpeechError('doubao_speech_protocol');
                    if(sessionId&&event.session_id&&event.session_id!==sessionId)throw doubaoSpeechError('doubao_speech_protocol');
                    switch(event.event){
                        case 'TaskStarted':
                            if(phase!=='task'||!/^[\w-]{1,128}$/u.test(event.task_id||''))throw doubaoSpeechError('doubao_speech_protocol');
                            taskId=event.task_id;phase='session';send('StartSession',createTextTtsSession());break;
                        case 'SessionStarted':
                            if(phase!=='session')throw doubaoSpeechError('doubao_speech_protocol');
                            sessionId=event.session_id||'';phase='between';send('BidirectionalTTS',{text:request.text});send('EndTTS');break;
                        case 'TTSSentenceStart':
                            if(phase!=='between'||complete.length>=64)throw doubaoSpeechError('doubao_speech_protocol');
                            phase='sentence';chunks=[];sentenceBytes=0;break;
                        case 'TTSResponse':
                            if(phase!=='sentence'||!event.data.length)throw doubaoSpeechError('doubao_speech_protocol');
                            total+=event.data.length;sentenceBytes+=event.data.length;
                            if(total>MAX_AUDIO_BYTES)throw doubaoSpeechError('doubao_speech_limit');
                            chunks.push(Buffer.from(event.data));break;
                        case 'TTSSentenceEnd':
                            if(phase!=='sentence'||!sentenceBytes)throw doubaoSpeechError('doubao_speech_protocol');
                            complete.push(Buffer.concat(chunks,sentenceBytes));chunks=[];phase='between';break;
                        case 'TTSEnded':
                            if(phase!=='between'||!complete.length)throw doubaoSpeechError('doubao_speech_incomplete');
                            finish();break;
                        case 'SessionFailed':case 'TaskFailed':throw doubaoSpeechError('doubao_speech_upstream');
                        default:throw doubaoSpeechError('doubao_speech_protocol');
                    }
                }catch(failure){finish(failure.code?.startsWith('doubao_speech_')?failure:doubaoSpeechError('doubao_speech_protocol'))}};
                try {
                    const url=new URL(DOUBAO_SPEECH_ENDPOINT);
                    for(const [key,value] of Object.entries({api_app_key:DOUBAO_SPEECH_APPKEY,namespace:'VoiceGenie',version_code:'20800',language:'zh',
                        device_platform:'web',pkg_type:'release_version',pc_version:'3.9.0',region:'CN',sys_region:'CN',samantha_web:'1','use-olympus-account':'1'}))url.searchParams.set(key,value);
                    socket=createSocket(url.toString(),{headers:{Cookie:cookie,Origin:'https://www.doubao.com'},followRedirects:false,
                        maxPayload:1024*1024,handshakeTimeout:Math.min(10000,deadline-Date.now())});
                    socket.on('open',open);socket.on('message',message);socket.on('error',error);socket.on('close',close);socket.on('unexpected-response',handshake);
                    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(doubaoSpeechError('doubao_speech_timeout')),Math.min(60000,deadline-Date.now()));
                    if(signal?.aborted)abort();
                }catch{finish(doubaoSpeechError('doubao_speech_upstream'))}
            });
            const pcm=[];let sampleRate,totalBytes=0;
            for(const sentence of sentences){check();let audio;
                try{audio=await decodeAudio(sentence,{signal,deadline})}catch{check();throw doubaoSpeechError('doubao_speech_audio')}
                check();const {format,samples}=validateWav(audio);const rate=format.readUInt32LE(4);
                if(format.readUInt16LE(0)!==1||format.readUInt16LE(2)!==1||format.readUInt16LE(14)!==16
                    ||(sampleRate!==undefined&&sampleRate!==rate))throw doubaoSpeechError('doubao_speech_audio');
                sampleRate=rate;totalBytes+=samples.length;
                // 分句各自合法仍可能超过任务总时长；单声道PCM16每个样本占2字节。
                if(totalBytes+44>MAX_AUDIO_BYTES||totalBytes/2>sampleRate*120)throw doubaoSpeechError('doubao_speech_limit');pcm.push(samples);
            }
            check();return wrapPcm(Buffer.concat(pcm,totalBytes),sampleRate);
        }catch(failure){if(failure.code?.startsWith('doubao_speech_'))throw failure;throw doubaoSpeechError('doubao_speech_audio')}
        finally{release()}
    }};
}
module.exports={createDoubaoSpeechAdapter,getDoubaoSpeechCredential};
