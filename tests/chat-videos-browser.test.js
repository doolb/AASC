'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../src/apps/web-mediacenter/ui/public');

test('两端主AI原生多视频在原回复显示、实际解码播放，流式文字与历史刷新不擦除播放器',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-video-browser-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const filename=path.join(directory,'video.mp4');
 await promisify(execFile)('/usr/bin/ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',filename],{timeout:15000});
 const bytes=await fs.readFile(process.env.AASC_VIDEO_PROOF || filename);const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});t.after(()=>browser.close());
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',r=>r.respond(r.url().includes('/uploads/chat-videos/')?{status:200,contentType:'video/mp4',body:bytes}:{status:200,contentType:'text/html',body:'<div id="chatMessages"></div><div id="display"></div>'}));
 await page.goto('http://aasc-video.test/');await page.addScriptTag({path:path.join(root,'js/chat.js')});await page.addScriptTag({path:path.join(root,'js/display-chat.js')});await page.addScriptTag({path:path.join(root,'js/self-test.js')});
 assert.equal(await page.evaluate(async()=>(await SelfTest.tests.find(t=>t.id==='chat_video_player').run()).success),true);
 await page.evaluate(()=>{
  window.sent=[];window.ChatMarkdown={render:t=>t};window.WebSocketManager={ws:{readyState:1,send:raw=>sent.push(JSON.parse(raw))}};window.showToast=()=>{};window.confirm=()=>true;
  Chat.requestContextUsage=()=>{};Chat.isLoading=true;Chat.activeRequestId='video-request';Chat.showStreamingMessage('生成视频');
  DisplayChat.init({root:document.getElementById('display'),send:m=>{sent.push(m);return true}});DisplayChat.handleServerMessage({type:'chatInput',requestId:'video-request',mode:'group',content:'生成视频'});
  window.record={id:'video',role:'assistant',mode:'group',sessionId:'default',content:'正在生成视频…',videos:[],videoGeneration:{source:'main',requestId:'video-request',status:'pending'}};
  const event={type:'chatImageMessage',requestId:'video-request',message:record};Chat.handleImageMessage(event);DisplayChat.handleServerMessage(event);
 });
 await page.click('#chatMessages [data-cancel-image]');assert.equal(await page.evaluate(()=>sent.at(-1).type),'cancelChatImage');
 await page.evaluate(()=>{
  record={...record,content:'给你视频。',videos:[{url:'/uploads/chat-videos/aaaa.mp4'},{url:'/uploads/chat-videos/bbbb.mp4'}],videoGeneration:{...record.videoGeneration,status:'completed'}};
  const e={type:'chatImageMessage',requestId:'video-request',message:record};Chat.handleImageMessage(e);DisplayChat.handleServerMessage(e);
  const text={type:'chatChunk',requestId:'video-request',chunk:'给你视频。',message:'给你视频。'};Chat.handleChunk(text);DisplayChat.handleServerMessage(text);Chat.renderHistory();
 });
 assert.equal(await page.$$eval('#chatMessages video',nodes=>nodes.length),2);assert.equal(await page.$$eval('#display video',nodes=>nodes.length),2);
 await page.waitForFunction(()=>document.querySelector('#chatMessages video').readyState>=2);
 await page.$eval('#chatMessages video',async video=>{video.muted=true;await video.play()});
 await page.waitForFunction(()=>document.querySelector('#chatMessages video').currentTime>0);
 assert.equal(await page.$eval('#display video',v=>v.controls&&v.hasAttribute('playsinline')),true);
 await page.evaluate(()=>{
  const e={type:'chatResponse',requestId:'video-request',success:true,message:record.content,history:[record]};Chat.handleResponse(e);DisplayChat.handleServerMessage(e);
  Chat.history=JSON.parse(JSON.stringify([record]));Chat.renderHistory();DisplayChat.handleServerMessage({type:'chatImageMessage',requestId:'video-request',message:JSON.parse(JSON.stringify(record))});
 });
 assert.equal(await page.$$eval('#chatMessages .assistant',nodes=>nodes.length),1);assert.equal(await page.$$eval('#chatMessages video',nodes=>nodes.length),2);
 assert.equal(await page.$$eval('#display .is-assistant',nodes=>nodes.length),1);assert.equal(await page.$$eval('#display video',nodes=>nodes.length),2);
 await page.evaluate(async()=>{window.fetch=async()=>({ok:true,json:async()=>({status:'success',history:[]})});Chat.updateSendButton=()=>{};await Chat.clearHistory();Chat.handleImageMessage({type:'chatImageMessage',requestId:'video-request',message:record})});
 assert.equal(await page.$$eval('#chatMessages video',nodes=>nodes.length),0);assert.deepEqual(errors,[]);
});

test('两端生视频模型选择走既有WS，主聊天和生图设置保持权威快照',async t=>{
 const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<div id="control"></div><div id="display"></div>');await page.addScriptTag({path:path.join(root,'js/chat-model-tier-picker.js')});
 await page.evaluate(()=>{window.sent=[];const send=m=>{sent.push(m);return true};for(const prefix of ['control','display']){const picker=ChatModelTierPicker.create({host:document.getElementById(prefix),prefix,send});picker.setConnected(true);picker.handleMessage({type:'chatModelTierConfig',selection:{modelName:'main',profileMode:'llm'},providers:[],imageSelection:{},videoSelection:{providerId:'glm',model:'glm-video'},videoProviders:[{id:'glm',name:'GLM',models:[{id:'glm-video',name:'清影'}]},{id:'qwen',name:'Qwen',models:[{id:'qwen-happyhorse',name:'HappyHorse 1.0'}]}]})}});
 assert.equal(await page.$eval('#controlChatModelTierPanel [data-video-model]',s=>s.value),'glm-video');
 await page.$eval('#displayChatModelTierPanel [data-video-provider]',s=>{s.value='qwen';s.dispatchEvent(new Event('change'))});
 assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'setChatModelTierSelection',purpose:'video',providerId:'qwen',model:'qwen-happyhorse'});
});
