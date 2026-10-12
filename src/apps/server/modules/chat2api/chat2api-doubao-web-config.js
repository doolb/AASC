'use strict';
const DEFAULT_DOUBAO_WEB_CONFIG=Object.freeze({enabled:false,port:9222,accountId:'',targetId:'',contextId:'',allowSessionCheck:false});
// 仅接受非秘密运行参数；禁止把CDP改成任意远端地址或把Cookie写入主配置。
function normalizeDoubaoWebConfig(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!Object.hasOwn(DEFAULT_DOUBAO_WEB_CONFIG,k)))throw new Error('豆包网页运行配置字段不合法');
 const value={...DEFAULT_DOUBAO_WEB_CONFIG,...raw};
 for(const k of ['enabled','allowSessionCheck'])if(typeof value[k]!=='boolean')throw new Error('豆包网页开关必须为布尔值');
 if(!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw new Error('豆包本机调试端口须为1024至65535');
 for(const k of ['accountId','targetId','contextId'])if(typeof value[k]!=='string'||value[k].length>128||!/^[-\w]*$/u.test(value[k]))throw new Error('豆包账号或标签标识不合法');
 if(value.enabled&&(!value.accountId||!value.targetId||!value.allowSessionCheck))throw new Error('启用豆包网页须选择账号和标签并明确允许会话内存核对');
 return value;
}
module.exports={DEFAULT_DOUBAO_WEB_CONFIG,normalizeDoubaoWebConfig};
