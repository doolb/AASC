'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseSubAiReply } = require('../src/apps/server/modules/sub-ai/sub-ai-protocol');
const { createSubAiChatBridge } = require('../src/apps/server/modules/sub-ai/sub-ai-chat-bridge');
const { createSubAiTaskService } = require('../src/apps/server/modules/sub-ai/sub-ai-task-service');
const { createChatImageAssets } = require('../src/apps/server/modules/sub-ai/chat-image-assets');
const { extractGlmImages, extractDoubaoImages, createChat2ApiImageService } = require('../src/apps/server/modules/chat2api/chat2api-image-service');

test('SubAI CSV保留逗号、转义引号和多参考图，代码块不执行', () => {
    const parsed = parseSubAiReply('SubAI,生图,"红色, ""猫""",a,b\n给你画一张。\n```\nSubAI,生图,忽略\n```');
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.calls[0].prompt, '红色, "猫"');
    assert.deepEqual(parsed.calls[0].references, ['a', 'b']);
    assert.match(parsed.text, /给你画/);
    assert.equal(parseSubAiReply('SubA', false).text, '');
    assert.equal(parseSubAiReply('SubAI,生图,"猫', false).calls.length, 0);
    assert.match(parseSubAiReply('SubAI,生图,"猫').calls[0].error, /闭合/);
});

test('流式指令不泄露且重复调用只执行一次，普通正文保留', async () => {
    const dispatched = []; const chunks = [];
    const raw = 'SubAI,生图,"一只猫"\n正在画。';
    const chat = { async chatStream(content, options, callbacks) {
        assert.match(options.systemPrompt, /SubAI/);
        for (let i = 1; i <= raw.length; i++) callbacks.onChunk(raw[i-1], raw.slice(0,i), '');
        return { success: true, message: raw, speech: raw, history: [] };
    } };
    const bridge = createSubAiChatBridge(chat, { dispatch: async call => dispatched.push(call) });
    const result = await bridge.chatStream('画猫', {}, { onChunk: (_, full) => chunks.push(full) });
    await bridge.chatStream('继续', {}, {});
    assert.equal(dispatched.length, 1);
    assert.equal(result.message, '正在画。');
    assert.ok(chunks.every(chunk => !chunk.includes('SubAI')));
});

test('一次四张图更新同一占位并持久落盘，失败保留同一消息', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-images-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN9sAAAAASUVORK5CYII=';
    const assets = createChatImageAssets({ directory: dir });
    const messages = []; const events = [];
    const chat = { addMessage(m) { const r={...m,id:String(messages.length)};messages.push(r);return r; },
        updateMessage(id, patch) { const r=messages.find(m=>m.id===id);Object.assign(r,patch);return r; } };
    const service = createSubAiTaskService({ chat, assets, scope: {sessionId:'original'},
        generate: async()=>({data:Array.from({length:4},()=>({dataUrl:png}))}),
        publish: m=>events.push(JSON.parse(JSON.stringify(m))) });
    await service.dispatch({task:'生图',prompt:'猫',references:[]},{references:[]});
    assert.equal(events[0].imageGeneration.status, 'pending');
    await service.wait();
    assert.equal(messages.length,1); assert.equal(messages[0].images.length,4);
    assert.equal(events.at(-1).id,events[0].id);assert.equal(messages[0].sessionId,'original');
    const restored=JSON.parse(JSON.stringify(messages[0]));
    for(const image of restored.images) assert.ok((await assets.read(image)).data.length>0);
    await service.dispatch({task:'生图',prompt:'猫',references:['missing']},{references:[]});
    await service.wait();assert.equal(messages[1].imageGeneration.status,'failed');
});

test('GLM全部图片去重且必须全局完成，豆包忽略头像', () => {
    const part={content:[{type:'image',image:[{image_url:'https://example.com/1.png'},{image_url:'https://example.com/2.png'}]}]};
    assert.equal(extractGlmImages([{parts:[part]},{parts:[part],status:'finish'}]).length,2);
    assert.throws(()=>extractGlmImages([{parts:[part]}]),/提前/);
    assert.deepEqual(extractDoubaoImages([{ack_client_meta:{conversation_info:{image:'https://example.com/avatar'}}}]),[]);
});

test('图像路由隔离主模型、拒绝未登录和Pro升级',async()=>{
    let selected;
    const service=createChat2ApiImageService({dataStore:{listAccounts:async()=>[{providerId:'glm',accountId:'a'}],getAccount:async()=>({})},
        providerRegistry:{listProviders:async()=>[{id:'glm'}]},adapters:{glm:async args=>{selected=args.model.id;return [{url:'https://example.com/a.png'}]}}});
    await service.generate({model:'glm-image',prompt:'猫'});assert.equal(selected,'glm-image');
    await assert.rejects(service.generate({model:'seedream-5.0-pro',prompt:'猫'}),/模型/);
    await assert.rejects(service.generate({model:'qwen-image',prompt:'猫'}),/登录/);
});

test('千问按作品分组收集多图，不把缩略图重复算入', () => {
    const { extractQwenImages } = require('../src/apps/server/modules/chat2api/chat2api-qwen-images');
    const image = n => ({url:`https://example.com/${n}.png`});
    const events=[{data:{messages:[{meta_data:{multi_load:[{type:'ai_generate_image_list',content:{status:'complete',
        resource_infos:[image(1),image(2),image('thumbnail')],display_list:[{image:[image(1)],thumbnail:[image('thumbnail')]},{image:[image(2)]}]}}]}}]}}];
    assert.equal(extractQwenImages(events).images.length,2);
    assert.throws(()=>extractQwenImages([{ret:['FAIL_SYS_USER_VALIDATE']}]),/安全验证/);
});

test('取消生成终止原任务，已删除消息不会被晚到图片复活', async () => {
    const controllers=new Map(); const events=[]; const records=[];
    const chat={addMessage:m=>{const r={...m,id:'job'};records.push(r);return r},updateMessage:(id,p)=>records.length?Object.assign(records[0],p):null};
    const service=createSubAiTaskService({chat,scope:{},controllers,publish:m=>events.push({...m}),assets:{},
        generate:(_, {signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('取消')),{once:true}))});
    await service.dispatch({task:'生图',prompt:'猫',references:[]},{references:[]});
    controllers.get('job').abort();await service.wait();assert.equal(records[0].imageGeneration.status,'cancelled');
    assert.equal(controllers.size,0);assert.equal(events.length,2);
});

test('历史文件保存并恢复整组图片，晚到结果不恢复已删除消息', async t => {
    const { createChatHistoryStore } = require('../src/external/llm/chat-history-store');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-image-history-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const store = createChatHistoryStore({ historyDir: dir });
    const message = { id: 'image-group', role: 'assistant', content: '已生成2张图片', mode: 'group',
        images: [{id:'a',url:'/uploads/chat-images/a.png'}, {id:'b',url:'/uploads/chat-images/b.png'}],
        imageGeneration: { status:'completed', prompt:'猫' } };
    store.saveSnapshot([message]);
    const restored = createChatHistoryStore({ historyDir: dir }).load();
    assert.deepEqual(restored[0].images, message.images);
    assert.equal(restored[0].imageGeneration.status,'completed');
    let finish; let exists = true; const events = [];
    const service = createSubAiTaskService({ scope: {},
        chat: {addMessage: m=>({...m,id:'deleted'}),updateMessage: (id,p)=>exists ? {...p,id} : null},
        assets: {save:async x=>x}, publish:m=>events.push(m),
        generate:()=>new Promise(resolve=>{finish=resolve}) });
    await service.dispatch({task:'生图',prompt:'猫',references:[]},{references:[]});
    exists=false;finish({data:[{url:'https://example.com/a.png'}]});await service.wait();
    assert.equal(events.length,1);
});

test('生图HTTP接口沿用鉴权、保留全部图片与模型目录', async t => {
    const { createChat2ApiProxyService } = require('../src/apps/server/modules/chat2api/chat2api-proxy-service');
    const calls=[];
    const service=createChat2ApiProxyService({host:'127.0.0.1',port:0,config:{enableApiKey:true},
        dataStore:{validateApiKey:async k=>k==='image-test'},coreAdapter:{listModels:async()=>({object:'list',data:[]})},
        imageService:{listModels:()=>[{id:'glm-image',capability:'image'}],generate:async(input,{signal})=>{
            assert.ok(signal);calls.push(input);return {created:1,data:[{url:'https://example.com/a.png'},{url:'https://example.com/b.png'}]};}}});
    await service.start();t.after(()=>service.stop());
    const base=`http://127.0.0.1:${service.address().port}`;
    const input={model:'glm-image',prompt:'猫'};
    assert.equal((await fetch(base+'/v1/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401);
    const headers={Authorization:'Bearer image-test','Content-Type':'application/json'};
    const response=await fetch(base+'/v1/images/generations',{method:'POST',headers,body:JSON.stringify(input)});
    assert.equal(response.status,200);assert.equal((await response.json()).data.length,2);
    assert.deepEqual(calls,[input]);
    const models=await (await fetch(base+'/v1/models',{headers})).json();assert.equal(models.data[0].capability,'image');
});

test('指定生图提示随角色和参考图一起传入，清空取消后不执行迟到标签', async () => {
    const request = new AbortController(); const calls=[]; const completed=[];
    let release; let delivered;
    const chat={async chatStream(content, options){
        delivered=options;
        return await new Promise(resolve=>{release=()=>resolve({success:true,message:'SubAI,生图,"背景改为绿色",ref1',history:[]})});
    }};
    const bridge=createSubAiChatBridge(chat,{references:[{id:'ref1'}],dispatch:async call=>calls.push(call)});
    const job=bridge.chatStream('修改图片',{systemPrompt:'角色设定',signal:request.signal},
        {onComplete:value=>completed.push(value)});
    assert.match(delivered.systemPrompt,/SubAI 指令调用行,和本地游戏调用行写法一致,/);
    assert.match(delivered.systemPrompt,/用户说生图或者画图时/);
    assert.doesNotMatch(delivered.systemPrompt,/唯一入口|不得调用模型或官网自带的原生生图|调用行不朗读/);
    assert.match(delivered.systemPrompt,/可用参考图ID：ref1/);
    assert.ok(delivered.systemPrompt.endsWith('角色设定'));
    request.abort();release();
    assert.equal((await job).cancelled,true);assert.deepEqual(calls,[]);assert.deepEqual(completed,[]);
});

test('实际模型请求按游戏、SubAI、权威状态、角色顺序注入用户指定提示，示例CSV可以调用', async () => {
    const { buildGameSystemPrompt, GAME_PROMPT } = require('../src/apps/server/modules/game/game-chat-bridge');
    const { SUB_AI_PROMPT } = require('../src/apps/server/modules/sub-ai/sub-ai-protocol');
    let delivered;
    const calls = [];
    const chat = { async chatStream(_content, options) {
        delivered = options;
        return { success: true, message: 'SubAI,生图, "一只猫"\n我来画一只猫。', history: [] };
    } };
    const bridge = createSubAiChatBridge(chat, { dispatch: async call => calls.push(call) });
    const result = await bridge.chatStream('画一只猫', {
        systemPrompt: buildGameSystemPrompt(null, '你是小爱，一个简洁友好的智能助手。')
    });
    assert.equal(delivered.systemPrompt, [GAME_PROMPT, SUB_AI_PROMPT, 'NowGame:无',
        '你是小爱，一个简洁友好的智能助手。'].join('\n\n'));
    assert.match(delivered.systemPrompt, /自然语言中不要透露等待状态确认，GM 的信息/);
    assert.match(delivered.systemPrompt, /Game: 目录, GameUser, 列表/);
    assert.match(delivered.systemPrompt, /Game: 游戏名, GameAI, 规则/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, '一只猫');
    assert.equal(result.message, '我来画一只猫。');
});
