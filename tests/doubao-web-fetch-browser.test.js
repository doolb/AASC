'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const puppeteer=require('puppeteer');
const {createDoubaoBrowserBridge}=require('../src/apps/server/modules/chat2api/chat2api-doubao-browser-bridge');
const {createDoubaoChatAdapter}=require('../src/apps/server/modules/chat2api/chat2api-doubao-chat-adapter');
test('隔离Chromium真实CDP/会话比较/page.fetch/SSE接线，所有网页请求拦截为本地模拟', {timeout:15000},async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(root,'.tmp-doubao-fetch-'));let browser;
 const cookie='sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789';
 try{
  browser=await puppeteer.launch({headless:true,userDataDir:path.join(temp,'profile'),args:['--no-sandbox','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1']});
  const page=await browser.newPage();await page.setRequestInterception(true);let posts=0;
  const block={block_type:10000,block_id:'block',content:{text_block:{text:'本地网页回复'}}};
  const sse=`event: STREAM_CHUNK\ndata: ${JSON.stringify({patch_op:[{patch_object:100,patch_value:{content_block:[block]}}]})}\n\nevent: SSE_REPLY_END\ndata: {}\n\n`;
  page.on('request',request=>{
   const url=new URL(request.url());
   if(url.origin==='https://www.doubao.com'&&url.pathname==='/chat/completion'&&request.method()==='POST'){
    posts++;assert.equal(JSON.parse(request.postData()).option.need_deep_think,0);
    assert.equal(request.headers()['x-tt-passport-csrf-token'],'mock_csrf_123456789');
    void request.respond({status:200,contentType:'text/event-stream',body:sse});return;
   }
   // 全部请求均由本地夹具回答，包括官网首页；不会发送到互联网或用户Chrome。
   void request.respond({status:200,contentType:'text/html',body:'<!doctype html><title>本地模拟豆包页面</title>'});
  });
  await page.goto('https://www.doubao.com/');
  await page.setCookie({name:'sessionid',value:'mock_session_123456789',url:'https://www.doubao.com/',httpOnly:true},
   {name:'passport_csrf_token',value:'mock_csrf_123456789',url:'https://www.doubao.com/'});
  const cdp=await page.createCDPSession();const {targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();
  const config={enabled:true,port:Number(new URL(browser.wsEndpoint()).port),accountId:'demo',targetId:targetInfo.targetId,contextId:targetInfo.browserContextId||'',allowSessionCheck:true};
  const account={accountId:'demo',providerId:'doubaochat',enabled:true,credentials:{cookie}};
  const bridge=createDoubaoBrowserBridge({getConfig:()=>config,dataStore:{getAccount:async()=>account}});
  const adapter=createDoubaoChatAdapter({browserTransport:bridge,httpClient:{request:()=>{throw new Error('禁止Node回退')}}});
  const result=await adapter({request:{model:'doubao',messages:[{role:'user',content:'本地测试'}]},account,provider:{id:'doubaochat',apiEndpoint:'https://www.doubao.com'}});
  assert.equal(result.body.choices[0].message.content,'本地网页回复');assert.equal(posts,1);
  assert.equal(page.isClosed(),false);assert.equal(browser.connected,true);
  assert.equal((await page.evaluate(()=>Object.keys(window).filter(k=>k.startsWith('__aascDoubao_')))).length,0);
 }finally{if(browser)await browser.close();assert.ok(path.resolve(temp).startsWith(root+path.sep));fs.rmSync(temp,{recursive:true,force:true})}
});
