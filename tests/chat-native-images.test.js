'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { extractOutputImages, extractOutputText, createOutputImageCollector } = require('../src/core/utils/chat-output-images');
const { createNativeChatImages } = require('../src/apps/server/modules/sub-ai/native-chat-images');
const { createChatImageAssets } = require('../src/apps/server/modules/sub-ai/chat-image-assets');

test('兼容Responses原生base64图片和output_image，重复完成事件只交付一次', () => {
    const notices = []; const collector = createOutputImageCollector(event => notices.push(event));
    const item = { type: 'image_generation_call', status: 'completed', result: 'YWJj' };
    collector.pushEvent({ type: 'response.output_item.added', item: { ...item, status: 'in_progress' } });
    collector.pushEvent({ type: 'response.output_item.done', item });
    collector.pushEvent({ type: 'response.completed', response: { output: [item] } });
    assert.deepEqual(notices.map(event => event.status), ['pending', 'completed']);
    assert.equal(collector.getImages()[0].dataUrl, 'data:image/png;base64,YWJj');
    assert.deepEqual(extractOutputImages({ output: [{ type: 'message', content: [
        { type: 'output_text', text: 'https://images.test/not-an-image.png' },
        { type: 'output_image', image_url: 'https://images.test/a.png' },
        { type: 'output_image', image_url: 'https://images.test/a.png' }
    ] }] }), [{ url: 'https://images.test/a.png' }]);
    assert.equal(extractOutputText({ content: [{ type: 'text', text: '图片说明。' },
        { type: 'image_url', image_url: { url: 'https://images.test/a.png' } }] }), '图片说明。');
});

test('首个生图通知到达前已清空聊天时，不创建占位或下载图片', async () => {
    let current = true; let downloads = 0;
    const f = fixture({ isCurrent: () => current, assets: { save: async () => { downloads += 1; } } });
    current = false;
    f.service.receive({ status: 'completed', images: [{ url: 'https://images.test/a.png' }] });
    assert.equal(f.service.complete({ content: '迟到回复' }), null);
    await f.service.wait();
    assert.equal(f.service.signal.aborted, true);
    assert.equal(f.records.length, 0); assert.equal(f.updates.length, 0); assert.equal(downloads, 0);
});

function fixture(options = {}) {
    const records = []; const updates = []; const controllers = new Map();
    const chat = { addMessage(fields) { const record = { ...fields, id: 'native' }; records.push(record); return record; },
        updateMessage(id, patch) { const record = records.find(record => record.id === id); if (!record) return null;
            Object.assign(record, patch); return record; } };
    const service = createNativeChatImages({ chat, scope: { mode: 'private', target: '小爱', sessionId: 'isolated', replyToMessageId: 'u1' },
        requestId: 'request1', controllers, publish: record => updates.push(JSON.parse(JSON.stringify(record))), ...options });
    return { records, updates, controllers, service };
}

test('原生多图保存本地并与文字共用一条AI回复，重复事件不重复下载，历史可恢复', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-native-images-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN9sAAAAASUVORK5CYII=';
    const assets = createChatImageAssets({ directory, http: { get: async () => ({
        headers: { 'content-type': 'image/png' }, data: Buffer.from(dataUrl.split(',')[1], 'base64')
    }) } });
    let saved = 0;
    const { service, records, updates, controllers } = fixture({ assets: { save: async (...args) => { saved += 1; return assets.save(...args); } } });
    service.receive({ status: 'pending', images: [] });
    service.receive({ status: 'completed', images: [{ dataUrl }, { url: 'https://images.test/b.png' }, { dataUrl }] });
    service.receive({ status: 'completed', images: [{ dataUrl }] });
    const record = service.complete({ content: '一只猫。', reasoning: '选择绿色背景', speech: '一只猫。', gameTrace: [] });
    assert.equal(record.id, records[0].id);
    await service.wait();
    assert.equal(records.length, 1); assert.equal(saved, 2); assert.equal(records[0].images.length, 2); assert.equal(controllers.size, 0);
    assert.equal(updates[0].imageGeneration.status, 'pending');
    const restored = JSON.parse(JSON.stringify(records[0]));
    assert.equal(restored.content, '一只猫。'); assert.equal(restored.imageGeneration.status, 'completed');
    assert.equal(restored.reasoning, '选择绿色背景'); assert.equal(restored.replyToMessageId, 'u1');
    assert.ok((await assets.read(restored.images[0])).data.length);
    assert.doesNotMatch(JSON.stringify(restored), /data:image|https:\/\//);
});

test('部分图片下载失败保留已保存图片与错误，清空和取消不让迟到图片复活', async () => {
    const failed = fixture({ assets: { save: async image => {
        if (image.url.endsWith('/bad')) throw new Error('HTTP 403');
        return { id: 'a', url: '/uploads/chat-images/aaaa.png' };
    } } });
    failed.service.receive({ images: [{ url: 'https://images.test/a' }, { url: 'https://images.test/bad' }] });
    failed.service.complete({ content: '给你画的。' }); await failed.service.wait();
    assert.equal(failed.records[0].images.length, 1); assert.equal(failed.records[0].imageGeneration.status, 'failed');
    assert.match(failed.records[0].content, /HTTP 403/);
    for (const cancel of [false, true]) {
        let release; const waiting = new Promise(resolve => { release = resolve; });
        const f = fixture({ assets: { save: async () => { await waiting; return { url: '/uploads/chat-images/aaaa.png' }; } } });
        f.service.receive({ images: [{ url: 'https://images.test/a' }] });
        await Promise.resolve();
        if (cancel) f.controllers.get('native').abort(); else f.records.splice(0);
        f.service.complete({ content: '' }); release(); await f.service.wait();
        if (cancel) { assert.equal(f.records[0].imageGeneration.status, 'cancelled'); assert.equal(f.records[0].images.length, 0); }
        else assert.equal(f.records.length, 0);
    }
});

test('实际llm-service经游戏和SubAI双桥传递图片，图前断连不会自动重发生图', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-native-llm-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const script = `
      const assert=require('node:assert/strict');
      const paths=require.resolve('./src/apps/server/modules/config/user-config-paths');
      require.cache[paths]={id:paths,filename:paths,loaded:true,exports:{USER_CONFIG_DIR:process.argv[1]}};
      const chat=require('./src/external/llm/llm-service');
      const {createSubAiChatBridge}=require('./src/apps/server/modules/sub-ai/sub-ai-chat-bridge');
      const {runGameAwareChat}=require('./src/apps/server/modules/game/game-chat-bridge');
      chat.init({llmProfiles:[{name:'isolated',mode:'llm',protocol:'openai-responses',model:'mock',apiUrl:'http://invalid.test/v1'}]});
      const image={url:'https://images.test/a.png'}; let streams=0; const notices=[];
      const client={async stream(payload,onEvent){streams++;
        onEvent({type:'response.output_images',status:'pending',images:[]});
        onEvent({type:'response.output_text.delta',delta:'画好了。'});
        onEvent({type:'response.output_images',status:'completed',images:[image]});
        onEvent({type:'response.completed',response:{id:'resp_mock',output:[{type:'message',content:[{type:'output_image',image_url:image.url}]}]}});
      },async request(){return {output:[{type:'message',content:[{type:'output_image',image_url:image.url}]}]}}};
      const sub=createSubAiChatBridge(chat,{dispatch:async()=>{throw Error('不得重复生成')}});
      (async()=>{
        const result=await runGameAwareChat({chat:sub,gameService:{snapshot:()=>null},displayId:'isolated',content:'画猫',
          options:{tierOverride:{providerId:'qwen',model:'mock',client}},callbacks:{onImages:e=>notices.push(e)}});
        assert.equal(result.success,true); assert.equal(result.message,'画好了。');
        assert.deepEqual(notices.map(e=>e.status),['pending','completed']);
        const plain=await chat.chat('再画',{tierOverride:{providerId:'qwen',model:'mock',client}});
        assert.equal(plain.images.length,1);
        const failed=await chat.chatStream('画猫',{tierOverride:{providerId:'qwen',model:'mock',client:{async stream(_p,emit){
          streams++; emit({type:'response.output_images',status:'pending',images:[]}); throw Object.assign(new Error('socket hang up'),{code:'ECONNRESET'});
        }}}},{});
        assert.equal(failed.success,false);assert.equal(streams,2);
        const pending=chat.addMessage({role:'assistant',content:'保留这段说明。',imageGeneration:{source:'main',status:'pending'}});
        chat.shutdown();
        chat.init({llmProfiles:[{name:'isolated',mode:'llm',protocol:'openai-responses',model:'mock',apiUrl:'http://invalid.test/v1'}]});
        const restored=chat.getHistory().find(m=>m.id===pending.id);
        assert.equal(restored.imageGeneration.status,'interrupted'); assert.match(restored.content,/保留这段说明/);
        chat.shutdown();
      })().catch(e=>{console.error(e);process.exitCode=1});
    `;
    await promisify(execFile)(process.execPath, ['-e', script, directory], { cwd: path.resolve(__dirname, '..'), timeout: 20000 });
});
