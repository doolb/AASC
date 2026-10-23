'use strict';
const { createHash, createHmac, randomUUID } = require('node:crypto');
const { createQwenSigner } = require('./chat2api-qwen-speech-auth');
const { applicationError } = require('./chat2api-system-controls');

/** 官网workspace_api签名：查询字段按原顺序拼值，不把URL或认证头写入错误。 */
function workspaceSignature({ signData, nonce, timestamp, authTime, base, scene, kp }) {
    const data = { ...signData, nonce, timestamp }; const token = scene.tokens.pop();
    const sign = createHmac('sha256', `${token}:${authTime}`)
        .update(`${base.deviceId}1.0.0${kp}${Object.values(data).join('')}`).digest('base64');
    return { params: data, headers: { 'clt-acs-sign': sign, 'clt-acs-reqt': String(authTime),
        'clt-acs-request-params': Object.keys(data).join(','), 'eo-clt-dvidn': base.deviceId,
        'eo-clt-sacsft': token, 'eo-clt-snver': base.version, 'eo-clt-actkn': scene.accessToken,
        'eo-clt-acs-ve': '1.0.0', 'clt-acs-caer': 'vrad', 'eo-clt-acs-kp': kp } };
}
function createQwenChatUpload({ http, signer = createQwenSigner({ businessScene:'workspace_api', buildSignature:workspaceSignature }) }) {
    return async (image,{account,signal}) => {
        const credentials = account.credentials || {};
        const rawCookie = credentials.cookie || credentials.cookies;
        let cookie = typeof rawCookie === 'string' ? rawCookie : Object.entries(rawCookie || {}).map(([key,value])=>`${key}=${value}`).join('; ');
        if (!/(?:^|;\s*)tongyi_sso_ticket=/.test(cookie)) cookie = [cookie, `tongyi_sso_ticket=${credentials.ticket || credentials.tongyi_sso_ticket || ''}`].filter(Boolean).join('; ');
        const headers = { Cookie:cookie, Origin:'https://www.qianwen.com',Referer:'https://www.qianwen.com/' };
        const post = async (pathname,body) => {
            const params={biz_id:'ai_qwen',req_id:randomUUID(),fr:'pc',pr:'qwen'};
            const signed = await signer({ credential:cookie,reqid:params.req_id,timeoutMs:60000,signal,signData:params });
            const response = await http.post(`https://workspace-res.qianwen.com${pathname}?${new URLSearchParams(signed.params)}`, body,
                { headers:{...headers,...signed.headers},signal,timeout:60000 });
            if(response.data?.code!==0||!response.data.data)throw applicationError('qwen_upload_failed','千问图片上传校验失败');
            return response.data.data;
        };
        const md5=createHash('md5').update(image.data).digest('base64');
        const config=await post('/1/oss_token',{file_name:image.filename,content_type:'application/octet-stream',content_md5:md5,size:image.data.length});
        let host;
        try { host=new URL(config.host); } catch { throw applicationError('qwen_upload_failed','千问上传地址无效'); }
        if(host.protocol!=='https:'||host.username||host.password||!/(?:^|\.)aliyuncs\.com$/.test(host.hostname))throw applicationError('qwen_upload_failed','千问上传地址无效');
        const put=await http.request({ method:'PUT',url:`${host.origin}/${encodeURIComponent(config.object)}`,data:image.data,
            headers:{...Object.fromEntries((config.oss_headers||[]).map(x=>[x.key,x.value])),
                'Content-Type':'application/octet-stream','Content-MD5':md5,Authorization:config.authorization},
            signal,timeout:60000,maxRedirects:0 });
        if(put.status<200||put.status>=300)throw applicationError('qwen_upload_failed','千问图片文件上传失败');
        const file=await post('/1/oss/callback',{file_md5:md5,file_name:image.filename,file_type:image.filename.split('.').at(-1),
            bucket:config.bucket,endpoint:config.endpoint,object:config.object,entry:'qwen_pc'});
        const url=file.material_cdn_url||file.material_url;
        if(!file.ws_gid||!/^https:\/\//.test(url||''))throw applicationError('qwen_upload_failed','千问图片未返回资源标识');
        return {id:file.ws_gid,url,file_name:file.file_name||image.filename,file_format:file.file_type||image.mimeType.split('/')[1].toUpperCase(),file_size:image.data.length};
    };
}
module.exports={createQwenChatUpload,workspaceSignature};
