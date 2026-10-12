'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const vm=require('node:vm');
const {createDoubaoBrowserBridge,connectLocalBrowser}=require('./chat2api-doubao-browser-bridge');
const config={enabled:true,port:9222,accountId:'demo',targetId:'target',contextId:'',allowSessionCheck:true};
const cookie='sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789';
function setup(options={}){
 let current={...config},account={accountId:'demo',providerId:'doubaochat',enabled:true,status:'active',credentials:{cookie}},reads=0,fetches=0,disconnected=0;
 const browser=new EventEmitter();const page=new EventEmitter();const frame={};let pulls=0;
 let currentUrl=options.url||'https://www.doubao.com/chat/';
 const context=vm.createContext({window:{},location:{origin:new URL(currentUrl).origin},document:{cookie:'passport_csrf_token=mock_csrf_123456789'},AbortController,Uint8Array,
  btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(url,init)=>{fetches++;assert.equal(url,'/chat/completion');assert.equal(init.credentials,'include');assert.equal(init.redirect,'error');
   if(options.fetchError)throw new Error('private_cookie_secret');
   return {status:options.status||200,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>({read:async()=>{pulls++;if(options.readError)throw new Error('private_cookie_secret');return pulls<=3?{value:Uint8Array.from(options.chunk||Buffer.from('片段'+pulls)),done:false}:{done:true}},cancel:async()=>{}})}}}});
 page.evaluate=(fn,arg)=>vm.runInContext(`(${fn.toString()})`,context)(arg);page.mainFrame=()=>frame;
 page.createCDPSession=async()=>({send:async()=>{reads++;return {cookies:[{name:'sessionid',value:options.session||'mock_session_123456789',domain:'.doubao.com'}]}},detach:async()=>{}});
 const target={_targetId:'target',type:()=> 'page',url:()=>currentUrl,page:async()=>{if(options.navigateOnPage){currentUrl='https://attacker.test/';context.location.origin='https://attacker.test';page.emit('framenavigated',frame)}return page}};
 browser.targets=()=>[target];browser.target=()=>({createCDPSession:async()=>({send:async method=>{if(options.cdpHang)return new Promise(()=>{});return method==='Target.getTargets'?{targetInfos:[]}:{targetInfo:{targetId:'target',type:'page',url:target.url(),browserContextId:options.context||''}}},detach:async()=>options.detachHang?new Promise(()=>{}):undefined})});
 browser.disconnect=async()=>{disconnected++};
 const bridge=createDoubaoBrowserBridge({getConfig:()=>current,dataStore:{getAccount:async()=>account},connect:async()=>{if(options.connectDelay)await new Promise(r=>setTimeout(r,options.connectDelay));return browser},monitorMs:5,metadataTimeoutMs:15});
 const request=(extra={})=>bridge.request({data:{hello:'测试'},accountId:'demo',...extra});
 return {bridge,request,page,frame,browser,setConfig:v=>{current=v},setAccount:v=>{account=v},stats:()=>({reads,fetches,disconnected,pulls})};
}
test('固定页面fetch拉取原始分片且有背压，只读所选会话，结束只断CDP',async()=>{
 const f=setup();const response=await f.request();assert.equal(f.stats().pulls,0);
 const chunks=[];for await(const b of response.data)chunks.push(b);
 assert.equal(Buffer.concat(chunks).toString(),'片段1片段2片段3');assert.equal(f.stats().reads,1);assert.equal(f.stats().fetches,1);assert.equal(f.stats().disconnected,1);
});
test('默认关闭/错账号/错context/错来源/错会话均拒绝，不能借标签或Node回退',async()=>{
 for(const options of [{session:'other_session_123456789'},{context:'other'},{url:'https://attacker.test'}]){const f=setup(options);await assert.rejects(f.request(),e=>e.code==='doubao_browser_binding');assert.equal(f.stats().fetches,0)}
 const f=setup();f.setConfig({});await assert.rejects(f.request(),e=>e.code==='doubao_browser_disabled');assert.equal(f.stats().reads,0);
});
test('单任务忙时拒绝；取消、主frame导航、配置禁用与凭据变化销毁流并释放连接',async()=>{
 for(const kind of ['abort','nav','config','account','disconnect']){
 const f=setup();const controller=new AbortController();const r=await f.request({signal:controller.signal});const errors=[];r.data.on('error',e=>errors.push(e));
 await assert.rejects(f.request(),e=>e.code==='doubao_browser_busy');
 if(kind==='abort')controller.abort();if(kind==='nav')f.page.emit('framenavigated',f.frame);if(kind==='config')f.setConfig({});if(kind==='account')f.setAccount({accountId:'demo',providerId:'doubaochat',credentials:{cookie:'changed'}});if(kind==='disconnect')f.browser.emit('disconnected');
 await new Promise(resolve=>setTimeout(resolve,35));assert.equal(r.data.destroyed,true);assert.equal(f.stats().disconnected,1);assert.equal(errors.length,1);
 }
});
test('CDP只允许同一本机端口的ws，无重定向或远端端点',async()=>{
 for(const endpoint of ['ws://remote:9222/devtools/browser/abc','ws://127.0.0.1:9333/devtools/browser/abc','wss://127.0.0.1:9222/devtools/browser/abc']){
 let calls=0;await assert.rejects(connectLocalBrowser(9222,new AbortController().signal,{fetch:async(url,opts)=>{assert.equal(opts.redirect,'error');return new Response(JSON.stringify({webSocketDebuggerUrl:endpoint}))},connect:async()=>{calls++}}));assert.equal(calls,0);
 }
});
module.exports={setup};

test('响应容量/页面异常固定脱敏；403不读错误体、不重试，iframe导航不撤销主页面',async()=>{
 for(const options of [{chunk:Buffer.alloc(512*1024+1)},{readError:true}]){const f=setup(options),r=await f.request();await assert.rejects(async()=>{for await(const b of r.data)void b},e=>!e.message.includes('private')&&/^doubao_browser_/u.test(e.code));assert.equal(f.stats().disconnected,1)}
 const f=setup({status:403});const r=await f.request();assert.equal(r.status,403);assert.equal(f.stats().pulls,0);assert.equal(f.stats().fetches,1);
 const g=setup();const response=await g.request();g.page.emit('framenavigated',{});await new Promise(r=>setTimeout(r,10));assert.equal(response.data.destroyed,false);response.data.destroy();await new Promise(r=>setTimeout(r,10));assert.equal(g.stats().disconnected,1);
});
test('连接迟到/总超时释放调试连接，预取消不读会话，坏数据不触发fetch',async()=>{
 const f=setup({connectDelay:30});await assert.rejects(f.request({limits:{timeoutMs:5}}),e=>e.code==='doubao_browser_timeout');await new Promise(r=>setTimeout(r,50));assert.equal(f.stats().disconnected,1);assert.equal(f.stats().reads,0);
 const g=setup();const c=new AbortController();c.abort();await assert.rejects(g.request({signal:c.signal}),e=>e.code==='doubao_browser_cancelled');assert.equal(g.stats().reads,0);
 await assert.rejects(g.request({data:{text:'a'.repeat(256*1024)}}),e=>e.code==='doubao_browser_limit');assert.equal(g.stats().fetches,0);
});

test('连接过程中导航到外站，不读Cookie不发fetch',async()=>{
 const nav=setup({navigateOnPage:true});await assert.rejects(async()=>{const response=await nav.request();response.data.destroy();return response},e=>e.code==='doubao_browser_binding');assert.equal(nav.stats().fetches,0);assert.equal(nav.stats().reads,0);
});
test('连接期间撤销会话授权或换凭据，不读Cookie不发fetch',async()=>{
 for(const change of ['config','account']){const f=setup({connectDelay:30});const task=f.request().then(response=>{response.data.destroy();return response});const rejected=assert.rejects(task,e=>e.code==='doubao_browser_binding');
 setTimeout(()=>change==='config'?f.setConfig({}):f.setAccount({accountId:'demo',providerId:'doubaochat',credentials:{cookie:'changed'}}),5);
 await rejected;await new Promise(r=>setTimeout(r,40));assert.equal(f.stats().reads,0);assert.equal(f.stats().fetches,0);assert.equal(f.stats().disconnected,1)}
});
test('身份CDP detach及标签目录send挂起也受总截止限制，释放后不再pending',async()=>{
 const f=setup({detachHang:true});const started=Date.now();
 const result=await Promise.race([f.request({limits:{timeoutMs:15}}).then(()=> 'success',e=>e.code),new Promise(r=>setTimeout(()=>r('still-pending'),80))]);
 assert.equal(result,'doubao_browser_timeout');assert.ok(Date.now()-started<80);assert.equal(f.stats().disconnected,1);
 const g=setup({cdpHang:true});await assert.rejects(g.bridge.listTargets(),e=>/^doubao_browser_/u.test(e.code));assert.equal(g.stats().disconnected,1);
});
