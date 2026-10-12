'use strict';
const {Readable}=require('node:stream');const {randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const {normalizeDoubaoWebConfig}=require('./chat2api-doubao-web-config');
const ORIGIN='https://www.doubao.com';
const ERRORS=Object.freeze({disabled:[503,'豆包网页运行模式未启用'],binding:[503,'豆包所选账号与网页标签未可靠绑定'],busy:[503,'豆包所选网页正在处理请求'],cancelled:[499,'豆包网页请求已取消'],timeout:[504,'豆包网页请求超时'],protocol:[502,'豆包网页桥接返回无效数据'],limit:[502,'豆包网页响应超过容量限制'],upstream:[502,'豆包本机网页连接或请求失败']});
function browserError(kind){const key=Object.hasOwn(ERRORS,kind)?kind:'upstream';return Object.assign(new Error(ERRORS[key][1]),{code:`doubao_browser_${key}`,statusCode:ERRORS[key][0]})}
const official=url=>{try{return new URL(url).origin===ORIGIN}catch{return false}};
const fingerprint=account=>createHash('sha256').update(JSON.stringify([account?.accountId,account?.providerId,account?.enabled,account?.status,account?.credentials?.cookie])).digest('hex');

async function connectLocalBrowser(port,signal,{fetch:fetcher=globalThis.fetch,connect=options=>require('puppeteer-core').connect(options)}={}){
 const response=await fetcher(`http://127.0.0.1:${port}/json/version`,{redirect:'error',signal});
 if(!response.ok)throw browserError('upstream');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw browserError('limit');chunks.push(Buffer.from(part.value))}}finally{await reader.cancel().catch(()=>{})}
 let endpoint;try{endpoint=new URL(JSON.parse(Buffer.concat(chunks).toString('utf8')).webSocketDebuggerUrl)}catch{throw browserError('protocol')}
 if(endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1'||endpoint.port!==String(port)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!/^\/devtools\/browser\/[\w-]+$/u.test(endpoint.pathname))throw browserError('binding');
 return connect({browserWSEndpoint:endpoint.href,defaultViewport:null});
}

// 下面三个函数在所选页面执行：凭据留在页面，向服务端只返回状态/MIME或有界base64原始字节。
async function beginPageRequest({key,data}){
 if(location.origin!=='https://www.doubao.com')return {binding:true};
 if(window[key])return {invalid:true};
 const controller=new AbortController();const state={controller,reader:null,pending:null,total:0};window[key]=state;
 try{
  const csrf=document.cookie.match(/(?:^|;\s*)passport_csrf_token(?:_default)?=([^;]+)/)?.[1];
  const headers={'Content-Type':'application/json',Accept:'text/event-stream','agw-js-conv':'str'};
  if(csrf)headers['x-tt-passport-csrf-token']=csrf;
  const response=await fetch('/chat/completion',{method:'POST',body:JSON.stringify(data),credentials:'include',redirect:'error',headers,signal:controller.signal});
  const contentType=response.headers.get('content-type')||'';
  if(response.status===200&&/^text\/event-stream(?:\s*;|$)/i.test(contentType)&&response.body)state.reader=response.body.getReader();
  else{controller.abort();delete window[key]}
  return {status:response.status,contentType};
 }catch{controller.abort();delete window[key];return {invalid:true}}
}
async function pullPageChunk({key,maxBytes}){
 if(location.origin!=='https://www.doubao.com')return {binding:true};
 const state=window[key];if(!state?.reader)return {invalid:true};
 try{
  if(!state.pending){const part=await state.reader.read();if(part.done)return {done:true};
   if(!part.value?.length||part.value.length>512*1024)return {limit:true};state.total+=part.value.length;
   if(state.total>maxBytes)return {limit:true};state.pending=part.value;}
  const bytes=state.pending.subarray(0,65536);state.pending=state.pending.length>65536?state.pending.subarray(65536):null;
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return {chunk:btoa(binary)};
 }catch{return {invalid:true}}
}
async function endPageRequest(key){const state=window[key];delete window[key];if(state){state.controller.abort();try{await state.reader?.cancel()}catch{}}}

function createDoubaoBrowserBridge({getConfig=()=>({}),dataStore,connect=connectLocalBrowser,monitorMs=500,metadataTimeoutMs=5000}={}){
 let active=null;
 const readConfig=()=>{try{return normalizeDoubaoWebConfig(getConfig())}catch{throw browserError('disabled')}};
 const connectFor=async(config,signal)=>connect(config.port,signal);
 return {
  cancel(){active?.abort(browserError('cancelled'))},
  async listTargets(){
   const config=readConfig();let browser;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.min(metadataTimeoutMs,5000));
   const stopped=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(browserError('timeout')),{once:true}));stopped.catch(()=>{});
   const wait=pending=>Promise.race([pending,stopped]);
   try{browser=await wait(connectFor(config,controller.signal).then(b=>{if(controller.signal.aborted){b.disconnect();throw browserError('timeout')}return b}));
    const cdp=await wait(browser.target().createCDPSession());try{const {targetInfos}=await wait(cdp.send('Target.getTargets'));return targetInfos.filter(t=>t.type==='page'&&official(t.url)).map(t=>({targetId:t.targetId,contextId:t.browserContextId||'',origin:ORIGIN}))}finally{await wait(cdp.detach())}
   }catch{throw browserError('upstream')}finally{clearTimeout(timer);await browser?.disconnect()}
  },
  async request({data,accountId,signal,limits={}}){
   const config=readConfig();if(!config.enabled)throw browserError('disabled');
   if(accountId!==config.accountId)throw browserError('binding');if(active)throw browserError('busy');if(signal?.aborted)throw browserError('cancelled');
   const timeout=Math.min(limits.timeoutMs||120000,120000),maxBytes=Math.min(limits.streamBytes||8*1024*1024,8*1024*1024);
   if(Buffer.byteLength(JSON.stringify(data))>256*1024)throw browserError('limit');
   const key=`__aascDoubao_${randomUUID().replaceAll('-','')}`;let browser,page,stream,timer,monitor,closed=false,failed=null,accountHash;
   let rejectCancellation;const cancelled=new Promise((_,reject)=>{rejectCancellation=reject});cancelled.catch(()=>{});
   const controller=new AbortController();
   const abort=error=>{if(closed||failed)return;failed=error;controller.abort();rejectCancellation(error);stream?.destroy(error);void cleanup()};
   const onAbort=()=>abort(browserError('cancelled'));
   const onNavigate=frame=>{if(frame===page?.mainFrame())abort(browserError('binding'))};
   const onDisconnect=()=>abort(browserError('binding'));
   const onTargetDestroyed=target=>{if(target._targetId===config.targetId)abort(browserError('binding'))};
   const wait=promise=>Promise.race([promise,cancelled]);
   const cleanup=async()=>{if(closed)return;closed=true;clearTimeout(timer);clearInterval(monitor);signal?.removeEventListener('abort',onAbort);
    page?.off('framenavigated',onNavigate);browser?.off('disconnected',onDisconnect);browser?.off('targetdestroyed',onTargetDestroyed);
    // 页面可能已关闭或调试连接丢失，取消清理也必须有界；绝不关闭标签/浏览器。
    if(page)await Promise.race([page.evaluate(endPageRequest,key).catch(()=>{}),new Promise(resolve=>{const t=setTimeout(resolve,250);t.unref?.()})]);
    try{await browser?.disconnect()}catch{}if(active?.key===key)active=null;
   };
   active={key,abort};signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>abort(browserError('timeout')),timeout);
   try{
    const account=await wait(dataStore.getAccount(accountId));
    if(!account||account.providerId!=='doubaochat'||account.enabled===false||(account.status&&account.status!=='active'))throw browserError('binding');
    const session=account.credentials?.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('sessionid='))?.slice(10);
    if(!session||!/^[\w-]{16,512}$/u.test(session))throw browserError('binding');accountHash=fingerprint(account);
    const configHash=JSON.stringify(config);let checking=false;
    const verifyAuthority=async()=>{
      if(failed)throw failed;
      let current;try{current=readConfig()}catch{throw browserError('binding')}
      if(JSON.stringify(current)!==configHash||fingerprint(await wait(dataStore.getAccount(accountId)))!==accountHash)throw browserError('binding');
      if(failed)throw failed;
    };
    await verifyAuthority();
    monitor=setInterval(async()=>{if(checking||closed)return;checking=true;try{await verifyAuthority()}catch{abort(browserError('binding'))}finally{checking=false}},monitorMs);
    browser=await wait(connectFor(config,controller.signal).then(b=>{if(closed||failed){b.disconnect();throw failed||browserError('cancelled')}return b}));
    browser.on('disconnected',onDisconnect);browser.on('targetdestroyed',onTargetDestroyed);
    const cdp=await wait(browser.target().createCDPSession());let info;
    try{info=(await wait(cdp.send('Target.getTargetInfo',{targetId:config.targetId}))).targetInfo}finally{await wait(cdp.detach())}
    if(info?.type!=='page'||!official(info.url)||(info.browserContextId||'')!==config.contextId)throw browserError('binding');
    const target=browser.targets().find(t=>t._targetId===config.targetId);if(!target||target.type()!=='page'||!official(target.url()))throw browserError('binding');
    page=await wait(target.page());page.on('framenavigated',onNavigate);
    await verifyAuthority();
    if(!official(target.url())||!(await wait(page.evaluate(()=>location.origin==='https://www.doubao.com'))))throw browserError('binding');
    // 用户明确允许的当前页面会话检查：只比较官方sessionid，原Cookie不用于Node请求、日志或持久化。
    const selected=await wait(page.createCDPSession());let matches=false;
    try{await verifyAuthority();const {cookies}=await wait(selected.send('Network.getCookies',{urls:[`${ORIGIN}/`]}));const values=cookies.filter(c=>c.name==='sessionid'&&['doubao.com','.doubao.com','www.doubao.com'].includes(c.domain));
     if(values.length===1){const a=Buffer.from(session),b=Buffer.from(values[0].value);matches=a.length===b.length&&timingSafeEqual(a,b)}}finally{await wait(selected.detach())}
    if(!matches)throw browserError('binding');
    await verifyAuthority();
    const response=await wait(page.evaluate(beginPageRequest,{key,data}));if(response.binding)throw browserError('binding');if(response.invalid)throw browserError('upstream');
    if(response.status!==200||!/^text\/event-stream(?:\s*;|$)/iu.test(response.contentType)){await cleanup();return {status:response.status,headers:{'content-type':response.contentType},data:Readable.from([])}}
    stream=Readable.from((async function*(){let total=0;try{while(true){const part=await wait(page.evaluate(pullPageChunk,{key,maxBytes}));
     if(part.binding)throw browserError('binding');if(part.limit)throw browserError('limit');if(part.invalid)throw browserError('protocol');if(part.done)return;
     if(typeof part.chunk!=='string'||part.chunk.length>87384||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(part.chunk))throw browserError('protocol');
     const bytes=Buffer.from(part.chunk,'base64');total+=bytes.length;if(!bytes.length||bytes.length>65536||total>maxBytes)throw browserError('limit');yield bytes;
    }}catch(error){throw failed||((error.code||'').startsWith('doubao_browser_')?error:browserError('upstream'))}finally{await cleanup()}})(),{highWaterMark:1});
    stream.on('error',()=>{});stream.once('close',()=>{void cleanup()});if(failed)stream.destroy(failed);
    return {status:200,headers:{'content-type':response.contentType},data:stream};
   }catch(error){await cleanup();throw failed||((error.code||'').startsWith('doubao_browser_')?error:browserError('upstream'))}
  }
 };
}
module.exports={createDoubaoBrowserBridge,connectLocalBrowser,browserError};
