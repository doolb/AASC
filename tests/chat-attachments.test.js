'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');
const { createChatAttachmentService } = require('../src/apps/server/modules/sub-ai/chat-attachment-service');
const { createChatMediaGc } = require('../src/apps/server/modules/sub-ai/chat-media-gc');
const { createChat2ApiInputFiles } = require('../src/apps/server/modules/chat2api/chat2api-input-files');
const { createChat2ApiProxyService } = require('../src/apps/server/modules/chat2api/chat2api-proxy-service');
const { createResponsesClient } = require('../src/external/llm/llm-responses-client');
const { prepareChatAttachments } = require('../src/external/llm/llm-attachment-context');
const { createChat2ApiProviderAdapters } = require('../src/apps/server/modules/chat2api/chat2api-provider-adapters');

async function temporary(t, prefix) { const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('双端共用上传业务接口，文本/图片/视频原件和元数据落盘；类型、数量、能力在服务端校验', async t => {
    const root = await temporary(t, 'aasc-attachment-http-'); const historyDir = path.join(root, 'history'); await fs.mkdir(historyDir);
    const gc = createChatMediaGc({ uploadsDir: root, historyDir }); t.after(() => gc.stop());
    const service = createChatAttachmentService({ uploadsDir: root, gc }); const app = express(); service.install(app);
    const server = app.listen(0, '127.0.0.1'); t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    await new Promise(resolve => server.once('listening', resolve)); const url = `http://127.0.0.1:${server.address().port}/api/chat/attachments`;
    for (const [name, bytes, kind] of [['资料.txt', Buffer.from('文件内容'), 'text'], ['cat.png', Buffer.from('89504e470d0a1a0a00000000', 'hex'), 'image'], ['clip.mp4', Buffer.from('0000ftypisom0000'), 'video']]) {
        const form = new FormData(); form.append('file', new Blob([bytes]), name);
        const response = await fetch(url, { method: 'POST', body: form }); assert.equal(response.status, 200);
        const asset = (await response.json()).attachment; assert.equal(asset.kind, kind); assert.equal(asset.size, bytes.length); assert.equal(asset.name, name);
        const file = await service.read(asset); assert.equal(file.id, asset.id);
        if (kind === 'video') { assert.ok(file.path); await assert.rejects(service.resolve([asset.id], {}), /视频/); }
        if (kind === 'image') await assert.rejects(service.resolve([asset.id], { supportsImageUpload: false }), /图片/);
        assert.equal((await fetch(url + '/' + asset.id, { method: 'DELETE' })).status, 200);
    }
    const form = new FormData(); form.append('file', new Blob(['<svg onload=bad()>']), 'bad.svg');
    assert.equal((await fetch(url, { method: 'POST', body: form })).status, 400);
    await assert.rejects(service.resolve(['../private']), /ID/);
});

test('文本计入上下文、文件内容不会变成系统消息；视频/图片ID去重，重建再上传且取消和禁用明确拒绝', async () => {
    let uploads = 0; const text = { id: 'text', kind: 'text', name: '说明.txt' }; const video = { id: 'video', kind: 'video' };
    const options = { current: [text, video], history: [{ role: 'user', content: '旧问题', attachments: [text, video] }],
        userText: '看附件', read: async asset => ({ ...asset, data: Buffer.from('文字附件内容'), mimeType: 'video/mp4' }), upload: async () => ({ id: `file-${++uploads}` }),
        videoAllowed: true, textBudget: 4096, knownIds: ['id:existing-image'] };
    const first = await prepareChatAttachments(options); assert.match(first.currentText, /文字附件内容/); assert.match(first.history[0].content, /旧问题/);
    assert.equal(first.videos.length, 1); assert.ok(first.sentIds.includes('id:existing-image'));
    const next = await prepareChatAttachments({ ...options, sameUpstream: true, knownIds: first.sentIds }); assert.equal(next.videos.length, 0); assert.equal(uploads, 1);
    await prepareChatAttachments({ ...options, sameUpstream: false, knownIds: first.sentIds }); assert.equal(uploads, 2);
    await assert.rejects(prepareChatAttachments({ ...options, textBudget: 2 }), /上下文预算/);
    await assert.rejects(prepareChatAttachments({ ...options, videoAllowed: false }), /未开启视频/);
    const controller = new AbortController(); controller.abort(); await assert.rejects(prepareChatAttachments({ ...options, signal: controller.signal }), error => error.name === 'AbortError');
});

for (const providerId of ['glm']) test(`${providerId}鉴权视频文件通道经原生适配保留原会话，正文不包含视频Base64`, async t => {
    const root = await temporary(t, `aasc-video-input-${providerId}-`); const files = createChat2ApiInputFiles({ rootDir: root }); t.after(() => files.stop());
    const proxy = createChat2ApiProxyService({ host: '127.0.0.1', port: 0, config: { enableApiKey: true }, dataStore: { validateApiKey: async key => key === 'test-key' }, inputFiles: files });
    await proxy.start(); t.after(() => proxy.stop()); const base = `http://127.0.0.1:${proxy.address().port}/v1`;
    assert.equal((await fetch(base + '/chat/files', { method: 'POST' })).status, 401);
    const client = createResponsesClient({ baseUrl: base, apiKey: 'test-key' }); const filename = path.join(root, 'source.mp4');
    const bytes = Buffer.alloc(2 * 1024 * 1024); Buffer.from('ftyp').copy(bytes, 4); await fs.writeFile(filename, bytes);
    const uploaded = await client.uploadFile({ path: filename, filename: 'video.mp4', mimeType: 'video/mp4' }); assert.equal(uploaded.bytes, bytes.length);
    let sent; let videoUploads = 0; const signal = new AbortController().signal;
    const http = { request: async config => {
        if (config.url.includes('/user/refresh')) return { status: 200, data: { result: { access_token: 'access' } } };
        if (!config.url.endsWith('/file/chat_upload')) { sent = config; return { status: 200, headers: { 'content-type': 'application/json' }, data: { choices: [{ message: { content: '蓝色画面' } }] } }; }
        const url = config.url, form = config.data;
        assert.match(url, /file\/chat_upload$/); assert.equal(form.get('file').type, 'video/mp4'); videoUploads++;
        return { data: { status: 0, result: { file_id: 'native-file', file_url: 'https://media.test/video.mp4', file_name: 'video.mp4', file_size: bytes.length } } };
    } };
    const adapters = createChat2ApiProviderAdapters({ httpClient: http, readVideoFile: files.read, qwenUpload: async file => {
        videoUploads++; assert.equal(file.data.length, bytes.length); return { id: 'native-file', url: 'https://media.test/video.mp4', file_name: 'video.mp4', file_format: 'MP4', file_size: bytes.length };
    } });
    const result = await adapters[providerId]({ request: { model: 'video', messages: [{ role: 'user', content: [{ type: 'text', text: '画面是什么颜色？' }, { type: 'video_url', video_url: { file_id: uploaded.id } }] }] },
        provider: { apiEndpoint: providerId === 'qwen' ? 'https://chat2.qianwen.com' : 'https://chatglm.cn' }, account: { credentials: { ticket: 'ticket', refresh_token: 'refresh' } }, actualModel: providerId === 'qwen' ? 'Qwen' : 'glm-5.3-flash',
        context: { signal }, responseSession: { nativeState: { sessionId: 'same-qwen', parentReqId: 'previous', conversationId: 'same-glm' } } });
    assert.ok(result.body); assert.equal(videoUploads, 1); assert.ok(JSON.stringify(sent.data).length < 4000);
    assert.equal(sent.data.conversation_id, 'same-glm'); assert.equal(sent.data.messages[0].content[1].type, 'video'); assert.equal(sent.data.messages[0].content[1].video[0].file_id, 'native-file');
    await assert.rejects(files.get('chat_file_../../secret')); await fs.access(filename);
});

test('真实LLM经Responses发送附件、保存历史，同一会话续聊不重复上传，重建后从原件恢复', async t => {
    const root = await temporary(t, 'aasc-llm-attachments-');
    const script = `
    const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
    const configPath=require.resolve('./src/apps/server/modules/config/user-config-paths');require.cache[configPath]={id:configPath,filename:configPath,loaded:true,exports:{USER_CONFIG_DIR:process.argv[1]}};
    const chat=require('./src/external/llm/llm-service');
    const {createChat2ApiInputFiles}=require('./src/apps/server/modules/chat2api/chat2api-input-files');
    const {createChat2ApiProxyService}=require('./src/apps/server/modules/chat2api/chat2api-proxy-service');
    const {createChat2ApiResponsesService}=require('./src/apps/server/modules/chat2api/chat2api-responses-service');
    const {collectVideos}=require('./src/apps/server/modules/chat2api/chat2api-content');
    (async()=>{const files=createChat2ApiInputFiles({rootDir:process.argv[1]});let uploads=0;const rawUpload=files.upload;files.upload=async(...args)=>{uploads++;return rawUpload(...args)};
    const sessions=new Map();const store={create:async s=>{sessions.set(s.conversationId,s);return s},get:async id=>sessions.get(id),findByResponseId:async id=>[...sessions.values()].find(s=>s.latestResponseId===id),save:async s=>sessions.set(s.conversationId,s),withLock:async(_id,f)=>f()};
    const requests=[];const service=createChat2ApiResponsesService({sessionStore:store,coreAdapter:{forwardChatCompletion:async(req,options)=>{
      requests.push(req);for(const id of collectVideos(req.messages))assert.equal((await files.get(id)).bytes,16);
      options.responseSession.nativeState.sessionId='upstream';options.responseSession.nativeState.parentReqId='parent';
      return {providerId:'qwen',accountId:'one',actualModel:'test',nativeState:options.responseSession.nativeState,
      stream:(async function*(){yield {id:'response',choices:[{delta:{content:'看到附件了'},finish_reason:null}]};yield {id:'response',choices:[{delta:{},finish_reason:'stop'}]};})()};}}});
    const proxy=createChat2ApiProxyService({host:'127.0.0.1',port:0,config:{enableApiKey:false},inputFiles:files,responsesService:service});await proxy.start();
    const profile={name:'one',mode:'llm',apiUrl:'http://127.0.0.1:'+proxy.address().port+'/v1',protocol:'openai-responses',model:'test',promptFormat:'raw',supportsVideoUpload:true};
    const videoPath=path.join(process.argv[1],'original.mp4');await fs.writeFile(videoPath,'0000ftypisom0000');
    const attachments=[{id:'video',kind:'video',name:'clip.mp4',url:'/uploads/chat-videos/example.mp4'},{id:'text',kind:'text',name:'note.txt',url:'/uploads/chat-files/example.txt'}];
    chat.init({maxTokens:8192,llmProfiles:[profile],activeProfile:'one'},{readChatAttachment:async asset=>asset.kind==='video'?{...asset,path:videoPath,filename:'video.mp4',mimeType:'video/mp4'}:{...asset,data:Buffer.from('窗边的橘猫')}});
    for(let i=0;i<2;i++){chat.addMessage({role:'user',content:i?'继续说说':'看看附件',mode:'group',attachments:i?[]:attachments});const response=await chat.chatStream(i?'继续说说':'看看附件',{mode:'group',systemPrompt:'简洁回答',includeHistory:true,contextCount:10,attachments:i?[]:attachments},{onChunk:()=>{}});assert.match(response.message,/看到附件/);}
    assert.equal(uploads,1);assert.equal(sessions.size,1);assert.match(JSON.stringify(requests[0].messages),/窗边的橘猫/);assert.equal(collectVideos(requests[1].messages).length,0);
    profile.model='changed';chat.setProfiles([profile],'one');chat.addMessage({role:'user',content:'重新看看',mode:'group'});await chat.chatStream('重新看看',{mode:'group',includeHistory:true,contextCount:10,attachments:[]},{onChunk:()=>{}});assert.equal(uploads,2);
    let inlineUploads=0;const inline={uploadFile:async(file,args)=>{inlineUploads++;return files.put(file,args)},stream:async(payload,emit)=>{const result=await service.createResponse(payload);for await(const event of result.stream)emit(event)}};
    chat.addMessage({role:'user',content:'内置模型继续',mode:'group'});const inlineResponse=await chat.chatStream('内置模型继续',{mode:'group',includeHistory:true,contextCount:10,tierOverride:{providerId:'qwen',model:'inline',client:inline}},{onChunk:()=>{}});assert.equal(inlineResponse.success,true);assert.equal(inlineUploads,1);
    const history=chat.getHistory();assert.equal(history.find(m=>m.attachments?.length).attachments.length,2);await chat.shutdown();await proxy.stop();await files.stop();})();`;
    await promisify(execFile)(process.execPath, ['-e', script, root], { cwd: path.resolve(__dirname, '..'), timeout: 20000 });
});

test('Qwen原始视频未接通时在上传及发消息之前明确拒绝', async () => {
    const adapters = createChat2ApiProviderAdapters({ httpClient: { request: async () => { throw new Error('不应发消息'); } }, readVideoFile: async () => { throw new Error('不应读视频'); }, qwenUpload: async () => { throw new Error('不应上传'); } });
    await assert.rejects(adapters.qwen({ request: { messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { file_id: 'chat_file_test' } }] }] }, account: { credentials: {} }, provider: {}, actualModel: 'Qwen' }), error => error.code === 'unsupported_modality');
});
