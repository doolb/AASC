'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const chatSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js'),
    'utf8'
);

test('私聊清空请求带上当前 sessionId 并校验助手已就绪', () => {
    assert.match(chatSource, /const sessionId = String\(this\.session\.privateSessionId \|\| 'default'\)/u);
    assert.match(chatSource, /mode === 'private' && !target/u);
    assert.match(chatSource, /当前私聊助手未就绪/u);
});

test('私聊清空接口的 HTTP 或业务错误必须显示失败原因', () => {
    assert.match(chatSource, /!response\.ok \|\| data\.status !== 'success'/u);
    assert.match(chatSource, /data\.message \|\| data\.error \|\| `清空失败/u);
});

test('群聊清空请求不携带私聊 sessionId', () => {
    assert.match(chatSource, /const clearRequest = \{ mode, target: target \|\| null,/u);
    assert.match(chatSource, /if \(mode === 'private'\) clearRequest\.sessionId = sessionId/u);
    assert.match(chatSource, /body: JSON\.stringify\(clearRequest\)/u);
});

test('控制端清空使用发消息时的显示端选择，临时模式仍走WebSocket', async t => {
    const puppeteer = require('puppeteer-core');
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH,'/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
    if(!executablePath){t.skip('需要Chromium');return}
    const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
    t.after(()=>browser.close());const page=await browser.newPage();
    await page.setContent('<div id="chatMessages"></div>');
    await page.addScriptTag({path:path.resolve(__dirname,'../src/apps/web-mediacenter/ui/public/js/chat.js')});
    await page.evaluate(()=>{
        window.requests=[];window.sent=[];window.currentDisplayId='single-display';
        window.confirm=()=>true;window.showToast=()=>{};
        window.DisplayList={selectionMode:'single',getSelectedDisplayIds:()=>['first','second']};
        window.WebSocketManager={ws:{readyState:WebSocket.OPEN,send:json=>sent.push(JSON.parse(json))}};
        window.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({status:'success',history:[]})}};
        Chat.renderHistory=()=>{};Chat.session.mode='private';Chat.session.privateTarget='小爱';Chat.session.privateSessionId='one';
    });
    await page.evaluate(()=>Chat.clearHistory());
    assert.deepEqual(await page.evaluate(()=>requests[0].body),{mode:'private',target:'小爱',sessionId:'one',displayIds:['single-display']});
    await page.evaluate(()=>{DisplayList.selectionMode='adaptive';Chat.session.mode='group';Chat.session.privateTarget=null;return Chat.clearHistory()});
    assert.deepEqual(await page.evaluate(()=>requests[1].body),{mode:'group',target:null,displayIds:['first','second']});
    await page.evaluate(()=>{Chat.session.mode='temporary';return Chat.clearHistory()});
    assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{type:'clearTemporaryConversation',displayIds:['first','second']});
});
