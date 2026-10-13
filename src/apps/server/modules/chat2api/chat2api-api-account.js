'use strict';
// API来源的秘密和非秘密连接参数分开保存；不在格式校验时连接上游。
function normalizeApiAccount(credentials={},accountInfo={}) {
  const apiKey=credentials.apiKey;
  if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192||!/^[\x21-\x7e]+$/u.test(apiKey.trim()))throw Object.assign(new Error('API Key格式不合法'),{statusCode:422,code:'invalid_api_credentials'});
  const info={...accountInfo,credentialVerification:'format-only'};
  const endpoint=credentials.endpoint||accountInfo.endpoint;
  if(endpoint){
    let url;try{url=new URL(endpoint);}catch(error){throw new Error('API端点地址不合法');}
    if(typeof endpoint!=='string'||endpoint.length>2048||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('API端点必须是无凭据和查询参数的HTTP(S)地址');
    info.endpoint=url.href;
  }
  const resourceId=credentials.resourceId||accountInfo.resourceId;
  if(resourceId){if(typeof resourceId!=='string'||!/^[\w.-]{1,512}$/u.test(resourceId))throw new Error('API资源ID格式不合法');info.resourceId=resourceId;}
  return {credentials:{apiKey:apiKey.trim()},accountInfo:info};
}
module.exports={normalizeApiAccount};
