'use strict';
const { randomUUID } = require('node:crypto');
const { normalizeDoubaoCredentials } = require('./chat2api-doubao-chat-adapter');
const { inspectNativeVideos } = require('./chat2api-native-videos');
const { mergeOutputVideos } = require('../../../../core/utils/chat-output-videos');

/** 官网IM单会话读取：仅取本次用户消息关联的视频作品，不再次发送生成消息。 */
async function readDoubaoVideoResult({ account, upstream, http, signal }) {
    const credentials=normalizeDoubaoCredentials(account.credentials);
    const cookies=Object.fromEntries(credentials.cookie.split(';').map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim(),part.slice(i+1).trim()]}));
    const profile=credentials.nodeProfile;
    const response=await http.request({method:'POST',url:'https://www.doubao.com/im/chain/single',
        params:{aid:'497858',device_platform:'web',doubao_device_platform:'web',web_platform:'browser',device_id:profile.deviceId,web_id:profile.webId,tea_uuid:profile.webId,fp:profile.fp,pc_version:profile.pcVersion,...(cookies.msToken?{msToken:cookies.msToken}:{})},
        headers:{Cookie:credentials.cookie,Origin:'https://www.doubao.com',Referer:'https://www.doubao.com/',
            'Content-Type':'application/json; encoding=utf-8',Accept:'application/json','X-Flow-Csrf-Token':cookies.passport_csrf_token||cookies.passport_csrf_token_default,'User-Agent':profile.userAgent},
        data:{cmd:3100,sequence_id:randomUUID(),channel:2,version:'1',uplink_body:{pull_singe_chain_uplink_body:{conversation_id:upstream.conversationId,conversation_type:upstream.conversationType||3,
            anchor_index:Number.MAX_SAFE_INTEGER,direction:1,limit:20,ext:{},filter:{index_list:[]},evaluate_ab_params:'',evaluate_common_params:'',option:{lazy_load_strategy:0}}}},
        signal,timeout:30000,maxRedirects:0,maxContentLength:4*1024*1024});
    const body=typeof response.data==='string'?JSON.parse(response.data):response.data;
    if(body.status_code!==0||body.cmd!==3100)throw Object.assign(new Error('豆包视频作品查询失败'),{code:'doubao_video_query',statusCode:502});
    let videos=[];let pending=false;let failure;
    for(const message of body.downlink_body?.pull_singe_chain_downlink_body?.messages||[]){
        if(String(message.conversation_id)!==String(upstream.conversationId))continue;
        const result=inspectNativeVideos('doubaochat',{message},{messageId:upstream.messageId,taskId:upstream.taskId});
        if(!result.started)continue;
        videos=mergeOutputVideos(videos,result.videos);pending||=result.pending;failure||=result.error;
    }
    return {videos,done:videos.length>0&&!pending,...(failure?{error:failure}:{})};
}
module.exports={readDoubaoVideoResult};
