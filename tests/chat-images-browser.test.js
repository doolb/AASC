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

test('主模型图片与流式文字使用同一气泡，分片和历史刷新不会擦除图片', async t => {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close()); const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="chatMessages"></div><div id="display"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/chat.js') });
    await page.addScriptTag({ path: path.join(root, 'js/display-chat.js') });
    await page.evaluate(() => {
        window.ChatMarkdown = { render: text => text }; window.sent = [];
        window.WebSocketManager = { ws: { readyState: 1, send: raw => sent.push(JSON.parse(raw)) } };
        Chat.requestContextUsage = () => {}; Chat.isLoading = true; Chat.activeRequestId = 'native-request';
        Chat.showStreamingMessage('画猫');
        DisplayChat.init({ root: document.getElementById('display'), send: message => { sent.push(message); return true; } });
        DisplayChat.handleServerMessage({ type: 'chatInput', requestId: 'native-request', mode: 'group', content: '画猫' });
        window.nativeRecord = { id: 'native', role: 'assistant', mode: 'group', sessionId: 'default', content: '正在生成图片…',
            imageGeneration: { source: 'main', requestId: 'native-request', status: 'pending' }, images: [] };
        const pending = { type: 'chatImageMessage', requestId: 'native-request', message: nativeRecord };
        Chat.handleImageMessage(pending); DisplayChat.handleServerMessage(pending);
        const text = { type: 'chatChunk', requestId: 'native-request', chunk: '画好了。', message: '画好了。' };
        Chat.handleChunk(text); DisplayChat.handleServerMessage(text);
    });
    assert.equal(await page.$$eval('#chatMessages .assistant', nodes => nodes.length), 1);
    assert.equal(await page.$$eval('#display .is-assistant', nodes => nodes.length), 1);
    await page.click('#chatMessages [data-cancel-image]');
    assert.deepEqual(await page.evaluate(() => sent.at(-1)), { type: 'cancelChatImage', messageId: 'native' });
    await page.evaluate(() => {
        window.nativeDone = { ...nativeRecord, content: '画好了。', imageGeneration: { ...nativeRecord.imageGeneration, status: 'completed' },
            images: [{ url: '/uploads/chat-images/aaaa.png' }, { url: '/uploads/chat-images/bbbb.png' }] };
        const event = { type: 'chatImageMessage', requestId: 'native-request', message: nativeDone };
        Chat.handleImageMessage(event); DisplayChat.handleServerMessage(event);
        // 刷新历史时保留正在接收的流节点；后续文字仍不能覆盖图片区域。
        Chat.renderHistory();
        const text = { type: 'chatChunk', requestId: 'native-request', chunk: '两张猫。', message: '画好了。两张猫。' };
        Chat.handleChunk(text); DisplayChat.handleServerMessage(text);
    });
    assert.equal(await page.$$eval('#chatMessages img', nodes => nodes.length), 2);
    assert.equal(await page.$$eval('#display img', nodes => nodes.length), 2);
    assert.match(await page.$eval('#streamingContent', node => node.textContent), /两张猫/);
    await page.evaluate(() => {
        nativeDone.content = '画好了。两张猫。';
        const final = { type: 'chatResponse', requestId: 'native-request', success: true, message: nativeDone.content, history: [nativeDone] };
        Chat.handleResponse(final); DisplayChat.handleServerMessage(final);
        const saved = JSON.parse(JSON.stringify(nativeDone));
        Chat.history = [saved]; Chat.renderHistory();
        DisplayChat.handleServerMessage({ type: 'chatImageMessage', requestId: 'native-request', message: saved });
    });
    assert.equal(await page.$$eval('#chatMessages .assistant', nodes => nodes.length), 1);
    assert.equal(await page.$$eval('#display .is-assistant', nodes => nodes.length), 1);
    assert.equal(await page.$$eval('#chatMessages img', nodes => nodes.length), 2);
    assert.equal(await page.$$eval('#display img', nodes => nodes.length), 2);
    assert.deepEqual(errors, []);
});

test('控制端清空与切换会话后不保留旧流式图片，也不接收被清空请求的迟到图片', async t => {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close()); const page = await browser.newPage();
    await page.setContent('<div id="chatMessages"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/chat.js') });
    await page.evaluate(() => {
        window.ChatMarkdown = { render: text => text }; window.confirm = () => true; window.showToast = () => {};
        window.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', history: [] }) });
        Chat.requestContextUsage = () => {}; Chat.updateSendButton = () => {};
        Chat.isLoading = true; Chat.activeRequestId = 'old-request'; Chat.showStreamingMessage('画猫');
        window.pending = { type: 'chatImageMessage', requestId: 'old-request', message: {
            id: 'native', role: 'assistant', mode: 'group', content: '正在生成图片…',
            imageGeneration: { source: 'main', requestId: 'old-request', status: 'pending' }
        } };
        Chat.handleImageMessage(pending);
    });
    await page.evaluate(() => Chat.clearHistory());
    await page.evaluate(() => Chat.handleImageMessage({ ...pending, message: { ...pending.message,
        images: [{ url: '/uploads/chat-images/aaaa.png' }] } }));
    assert.equal(await page.$$eval('#streamingAssistant, #chatMessages img', nodes => nodes.length), 0);
    assert.equal(await page.evaluate(() => Chat.history.length), 0);
    await page.evaluate(() => {
        Chat.isLoading = true; Chat.activeRequestId = 'switch-request'; Chat.showStreamingMessage('再画');
        Chat.session.mode = 'private'; Chat.session.privateTarget = '另一位'; Chat.renderHistory();
    });
    assert.equal(await page.$('#streamingAssistant'), null);
    await page.evaluate(() => {
        Chat.session.mode = 'temporary'; Chat.temporaryConversation.id = 'temp';
        Chat.isLoading = true; Chat.activeRequestId = 'temp-request'; Chat.showStreamingMessage('画猫');
        Chat.renderModeIndicator = () => {}; Chat.renderSessionSelector = () => {};
        Chat.handleTemporaryConversation({ action: 'clear', conversation: { id: 'temp', messages: [] } });
    });
    assert.equal(await page.$('#streamingAssistant'), null);
    assert.equal(await page.evaluate(() => Chat.activeRequestId), null);
});

test('LLM媒体开关沿现有配置提交，旧配置默认开启，禁图时保留输入草稿和附件',async t=>{
 const fs=require('node:fs/promises');
 const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});t.after(()=>browser.close());const page=await browser.newPage();
 const html=await fs.readFile(path.join(root,'upload.html'),'utf8');
 await page.setContent('<textarea id="chatInput">看这张图</textarea>');
 await page.evaluate(html=>{const parsed=new DOMParser().parseFromString(html,'text/html');document.body.append(parsed.getElementById('profileEditor'))},html);
 await page.addScriptTag({path:path.join(root,'js/chat.js')});
 await page.addScriptTag({path:path.join(root,'js/self-test.js')});
 assert.equal(await page.evaluate(async()=> (await SelfTest.tests.find(t=>t.id==='chat_media_capabilities').run()).success),true);
 const result=await page.evaluate(async()=>{
  window.showToast=()=>{};Chat.profiles=[{name:'old',apiUrl:'http://model.test',model:'test'}];Chat.activeProfile='old';Chat.editProfile('old');
  const defaults=[document.getElementById('profileEditSupportsImageUpload').checked,document.getElementById('profileEditSupportsVideoUpload').checked];
  document.getElementById('profileEditSupportsImageUpload').checked=false;document.getElementById('profileEditSupportsVideoUpload').checked=false;
  let request;Chat.submitProfiles=async data=>{request=data;return {status:'success'}};Chat.renderProfileSelector=()=>{};
  await Chat.saveProfile();Chat.profiles=request.profiles;Chat.isLoading=false;Chat.pendingImages=[{dataUrl:'data:image/png;base64,aA=='}];Chat.sendMessage();
  return {defaults,type:request.type,profile:request.profiles[0],draft:document.getElementById('chatInput').value,images:Chat.pendingImages.length};
 });
 assert.deepEqual(result.defaults,[true,true]);assert.equal(result.type,'chatProfilesSave');assert.equal(result.profile.supportsImageUpload,false);assert.equal(result.profile.supportsVideoUpload,false);
 assert.equal(result.draft,'看这张图');assert.equal(result.images,1);
});
