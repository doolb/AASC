'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'../src/apps/web-mediacenter/ui/public');
test('两端图片占位原位更新多图、隔离私聊、取消发送正确消息',async t=>{
    const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    t.after(()=>browser.close());const page=await browser.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<div id="chatMessages"></div><div id="display"></div>');
    await page.addScriptTag({path:path.join(root,'js/chat.js')});
    await page.addScriptTag({path:path.join(root,'js/display-chat.js')});
    await page.evaluate(()=>{
        window.sent=[];window.ChatMarkdown={render:t=>t};window.WebSocketManager={ws:{readyState:1,send:text=>sent.push(JSON.parse(text))}};
        Chat.requestContextUsage=()=>{};
        DisplayChat.init({root:document.getElementById('display'),send:m=>{sent.push(m);return true}});
        window.job={id:'job',role:'assistant',name:'生图',content:'正在生成图片…',mode:'group',sessionId:'default',imageGeneration:{status:'pending'}};
        Chat.handleImageMessage({message:job});DisplayChat.handleServerMessage({type:'chatImageMessage',message:job});
    });
    assert.equal(await page.$$eval('.chat-image-job[data-image-status=pending]',xs=>xs.length),2);
    await page.click('#chatMessages [data-cancel-image]');
    assert.equal(await page.evaluate(()=>sent.at(-1).type),'cancelChatImage');
    await page.evaluate(()=>{
        window.done={...job,content:'已生成4张图片',imageGeneration:{status:'completed'},images:Array.from({length:4},(_,i)=>({id:`img${i}`,url:`/uploads/chat-images/aaaa-${i}.png`}))};
        Chat.handleImageMessage({message:done});DisplayChat.handleServerMessage({type:'chatImageMessage',message:done});
        const other={...done,id:'private',mode:'private',target:'另一用户',sessionId:'other'};
        Chat.handleImageMessage({message:other});DisplayChat.handleServerMessage({type:'chatImageMessage',message:other});
    });
    assert.equal(await page.$$eval('#chatMessages img',xs=>xs.length),4);
    assert.equal(await page.$$eval('#display img',xs=>xs.length),4);
    assert.equal(await page.$$eval('.chat-image-job',xs=>xs.length),2);
    await page.evaluate(()=>{Chat.history=JSON.parse(JSON.stringify(Chat.history));Chat.renderHistory()});
    assert.equal(await page.$$eval('#chatMessages img',xs=>xs.length),4);
    assert.deepEqual(errors,[]);
});
