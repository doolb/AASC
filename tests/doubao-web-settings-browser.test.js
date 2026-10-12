'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const puppeteer=require('puppeteer');
test('隔离浏览器验证网页配置默认关闭、显式会话授权、WS权威保存/失败/断线与只读自测', {timeout:15000},async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(root,'.tmp-doubao-settings-'));let browser;
 try{
 browser=await puppeteer.launch({headless:true,userDataDir:path.join(temp,'profile'),args:['--no-sandbox']});const page=await browser.newPage();await page.setContent('<main id="host"></main>');
 await page.evaluate(()=>{window.sent=[];window.WebSocketManager={ws:{readyState:1,send:raw=>sent.push(JSON.parse(raw))}}});
 await page.addScriptTag({path:path.join(root,'src/apps/web-mediacenter/ui/public/js/doubao-web-settings.js')});
 await page.evaluate(()=>DoubaoWebSettings.render(document.getElementById('host'),[{accountId:'demo',providerId:'doubaochat',label:'模拟账号'}]));
 assert.equal(await page.$eval('#doubaoWebEnabled',x=>x.checked),false);assert.equal(await page.$eval('#doubaoWebAllowSession',x=>x.checked),false);assert.equal(await page.evaluate(()=>sent.length),0);
 await page.click('#doubaoWebTargets');const query=await page.evaluate(()=>sent.at(-1));assert.equal(query.type,'getDoubaoWebTargets');
 await page.evaluate(q=>DoubaoWebSettings.handleMessage({type:'doubaoWebTargets',requestId:q.requestId,success:true,targets:[{targetId:'target',contextId:'context',origin:'https://www.doubao.com'}]}),query);
 await page.select('#doubaoWebAccount','demo');await page.select('#doubaoWebTarget','target');await page.click('#doubaoWebEnabled');await page.click('#doubaoWebAllowSession');await page.click('#doubaoWebSave');
 const save=await page.evaluate(()=>sent.at(-1));assert.equal(save.type,'setDoubaoWebRuntimeConfig');assert.equal(save.config.contextId,'context');assert.equal(save.config.allowSessionCheck,true);
 assert.equal(await page.$eval('#doubaoWebSave',x=>x.disabled),true);
 await page.evaluate(s=>DoubaoWebSettings.handleMessage({type:'doubaoWebRuntimeConfig',requestId:s.requestId,success:true,config:s.config}),save);
 assert.equal(await page.$eval('#doubaoWebSave',x=>x.disabled),false);
 await page.$eval('#doubaoWebPort',x=>x.value=9333);await page.click('#doubaoWebSave');const failed=await page.evaluate(()=>sent.at(-1));
 await page.evaluate(({s,config})=>DoubaoWebSettings.handleMessage({type:'doubaoWebRuntimeConfig',requestId:s.requestId,success:false,message:'模拟保存失败',config}),{s:failed,config:save.config});assert.equal(await page.$eval('#doubaoWebPort',x=>x.value),'9222');
 await page.evaluate(()=>DoubaoWebSettings.handleDisconnected());assert.match(await page.$eval('#doubaoWebStatus',x=>x.textContent),/断开/u);
 await page.addScriptTag({path:path.join(root,'src/apps/web-mediacenter/ui/public/js/self-test.js')});const count=await page.evaluate(()=>sent.length);
 const result=await page.evaluate(()=>SelfTest.tests.find(t=>t.id==='doubao_web_runtime_config').run());assert.equal(result.success,true);assert.equal(await page.evaluate(()=>sent.length),count);
 }finally{if(browser)await browser.close();assert.ok(path.resolve(temp).startsWith(root+path.sep));fs.rmSync(temp,{recursive:true,force:true})}
});
