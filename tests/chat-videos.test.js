'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {Readable}=require('node:stream');const {setTimeout:delay}=require('node:timers/promises');
const {normalizeOutputVideos,extractOutputVideos,createOutputVideoCollector}=require('../src/core/utils/chat-output-videos');
const {createNativeChatImages}=require('../src/apps/server/modules/sub-ai/native-chat-images');
const {createChatVideoAssets}=require('../src/apps/server/modules/sub-ai/chat-video-assets');
const {createVideoJobs}=require('../src/apps/server/modules/chat2api/chat2api-video-jobs');
const videos=[{url:'https://media.test/a.mp4',posterUrl:'https://media.test/a.png'},{url:'https://media.test/b.mp4'}];
const chatFixture=()=>{const history=[];return {history,addMessage(m){const r={id:String(history.length+1),...m};history.push(r);return r},updateMessage(id,p){const r=history.find(m=>m.id===id);if(r)Object.assign(r,p);return r||null}}};

test('明确视频字段、仅视频与多视频提取；正文和封面不会冒充视频',()=>{
 assert.deepEqual(extractOutputVideos({content:'https://media.test/a.mp4',images:[{url:'https://media.test/cover.png'}]}),[]);
 assert.equal(extractOutputVideos({output:[{type:'message',content:videos.map(v=>({type:'output_video',...v}))}]}).length,2);
 assert.equal(normalizeOutputVideos([...videos,...videos,{url:'javascript:evil'}]).length,2);
 const seen=[];const collector=createOutputVideoCollector(e=>seen.push(e));
 collector.pushEvent({type:'response.output_videos',generation:{status:'pending',taskId:'one'}});
 collector.pushEvent({type:'response.completed',response:{output:[{content:[{type:'output_video',...videos[0]}]}]}});
 collector.pushEvent({type:'response.completed',response:{videos:[videos[0]]}});
 assert.equal(collector.getVideos().length,1);assert.equal(seen[0].taskId,'one');
});

test('主回复图片+文字+多视频只用一个记录，视频等待不阻塞聊天收尾',async()=>{
 const chat=chatFixture();let release;const gate=new Promise(r=>release=r);let waits=0;
 const coordinator=createNativeChatImages({chat,scope:{mode:'group'},requestId:'one',publish:()=>{},
  assets:{save:async()=>({url:'/uploads/chat-images/aaa.png'})},videoAssets:{save:async(v)=>({...v,id:v.url,url:'/uploads/chat-videos/aaa.mp4'})},
  waitVideo:async()=>{waits++;await gate;return {data:videos}}});
 coordinator.receiveVideos({status:'pending',taskId:'video-one'});coordinator.receive({images:[{url:'https://media.test/a.png'}]});
 coordinator.receiveVideos({status:'pending',taskId:'video-one'});coordinator.complete({content:'看这段视频。'});
 await coordinator.wait();assert.equal(chat.history.length,1);assert.equal(chat.history[0].imageGeneration.status,'completed');
 assert.equal(chat.history[0].videoGeneration.status,'pending');assert.equal(waits,1);
 release();await coordinator.waitAll();assert.equal(chat.history[0].videos.length,2);assert.equal(chat.history[0].videoGeneration.status,'completed');
 assert.equal(chat.history[0].content,'看这段视频。');
});

test('主回复清空/取消后迟到视频不复活，已有任务不重新生成',async()=>{
 const chat=chatFixture();let release;const gate=new Promise(r=>release=r);let saved=0;
 const coordinator=createNativeChatImages({chat,scope:{},requestId:'one',publish:()=>{},isCurrent:()=>chat.history.length>0||!saved,
  videoAssets:{save:async()=>{saved++;await gate;return {url:'/uploads/chat-videos/aaa.mp4'}}}});
 coordinator.receiveVideos({videos});coordinator.complete({content:'视频。'});await delay(1);chat.history.length=0;release();await coordinator.waitAll();
 assert.equal(chat.history.length,0);
});

test('视频流式落盘校验文件头，超限/无效内容/取消没有残留临时文件',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-video-assets-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(30)]);
 const http={get:async()=>({headers:{'content-type':'video/mp4'},data:Readable.from([bytes.subarray(0,6),bytes.subarray(6)])})};
 const assets=createChatVideoAssets({directory,http});const saved=await assets.save(videos[0]);assert.match(saved.url,/\.mp4$/);assert.equal(saved.size,bytes.length);
 const bad=createChatVideoAssets({directory,http:{get:async()=>({headers:{'content-type':'video/mp4'},data:Readable.from(['invalid'])})}});
 await assert.rejects(bad.save(videos[0]),/有效视频/);
 const limit=createChatVideoAssets({directory,http,maxBytes:8});await assert.rejects(limit.save(videos[0]),/大小限制/);
 const controller=new AbortController();controller.abort();await assert.rejects(assets.save(videos[0],{signal:controller.signal}));
 assert.equal((await fs.readdir(directory)).filter(name=>name.endsWith('.part')).length,0);
});

test('视频任务持久化重启只查询，同一上游任务去重，不重复创建；部分结果等待完整任务',async t=>{
 const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-video-jobs-'));t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
 let starts=0;let polled=0;
 const first=createVideoJobs({rootDir,start:async()=>{starts++;return {}},poll:async(_j,signal)=>{await delay(10000,undefined,{signal});return {}},intervalMs:1});
 const input={providerId:'glm',accountId:'one',model:'native',upstream:{taskId:'existing'}};
 const a=await first.create(input);const b=await first.create(input);assert.equal(a.id,b.id);await first.stop();
 const next=createVideoJobs({rootDir,start:async()=>{starts++;return {}},poll:async()=>{polled++;return polled===1?{videos:[videos[0]],done:false}:{videos,done:true}},intervalMs:1});
 const result=await next.wait(a.id);assert.equal(result.data.length,2);assert.equal(starts,0);assert.equal(polled,2);await next.stop();
 const data=await fs.readFile(path.join(rootDir,'video-jobs.json'),'utf8');assert.doesNotMatch(data,/Cookie|Authorization|prompt/);
});

test('SubAI生视频使用独立模型任务与参考图，立即占位且一次多视频保存到原卡片',async()=>{
 const {createSubAiTaskService}=require('../src/apps/server/modules/sub-ai/sub-ai-task-service');const chat=chatFixture();let requested;
 const worker=createSubAiTaskService({chat,scope:{mode:'private',target:'test',sessionId:'one'},assets:{read:async image=>({...image,data:Buffer.from('image')})},
  videoAssets:{save:async v=>({...v,url:'/uploads/chat-videos/aaa.mp4'})},createVideo:async input=>{requested=input;return {id:'task'}},waitVideo:async()=>({data:videos}),publish:()=>{}});
 await worker.dispatch({task:'生视频',prompt:'橘猫眨眼',references:['image']},{references:[{id:'image',url:'/uploads/chat-images/aaa.png'}]});
 assert.equal(chat.history.length,1);await worker.wait();assert.equal(requested.references.length,1);assert.equal(chat.history[0].videos.length,2);assert.equal(chat.history[0].videoGeneration.status,'completed');
});

test('主AI已原生生成视频时，同一回复里的SubAI视频标签不重复提交',async()=>{
 const {createSubAiChatBridge}=require('../src/apps/server/modules/sub-ai/sub-ai-chat-bridge');let calls=0;
 const bridge=createSubAiChatBridge({chatStream:async()=>({success:true,message:'SubAI,生视频,"橘猫眨眼"\n给你视频。',videos})},{dispatch:async()=>calls++});
 const result=await bridge.chatStream('视频',{},{});assert.equal(calls,0);assert.equal(result.message,'给你视频。');assert.equal(result.videos.length,2);
});

test('真实LLM经Responses/游戏/SubAI桥传主AI视频并保存历史，后续仍使用原会话',async t=>{
 const {promisify}=require('node:util'),{execFile}=require('node:child_process');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-native-video-llm-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const script=`
 const assert=require('node:assert/strict');const paths=require.resolve('./src/apps/server/modules/config/user-config-paths');
 require.cache[paths]={id:paths,filename:paths,loaded:true,exports:{USER_CONFIG_DIR:process.argv[1]}};
 const chat=require('./src/external/llm/llm-service');const {createSubAiChatBridge}=require('./src/apps/server/modules/sub-ai/sub-ai-chat-bridge');
 const {runGameAwareChat}=require('./src/apps/server/modules/game/game-chat-bridge');const {createNativeChatImages}=require('./src/apps/server/modules/sub-ai/native-chat-images');
 const profile={name:'one',mode:'llm',protocol:'openai-responses',promptFormat:'raw',model:'mock',apiUrl:'http://invalid.test/v1'};
 let deleted=0;chat.init({llmProfiles:[profile]},{onHistoryDeleted:()=>deleted++});const payloads=[];let round=0;const incoming=[];
 const client={async stream(payload,emit){payloads.push(payload);round++;if(round===1)emit({type:'response.output_videos',videos:[{url:'https://media.test/a.mp4'}],generation:{status:'completed'}});
 emit({type:'response.output_text.delta',delta:'给你视频。'});emit({type:'response.completed',response:{id:'resp_'+round,conversation:{id:'conv_same'},output_text:'给你视频。'}});}};
 (async()=>{const media=createNativeChatImages({chat,scope:{mode:'group'},requestId:'r',publish:()=>{},videoAssets:{save:async()=>({id:'a',url:'/uploads/chat-videos/aaa.mp4',mimeType:'video/mp4'})}});
 const bridge=createSubAiChatBridge(chat,{dispatch:async()=>{throw Error('原生不应调用SubAI')}});
 const run=text=>runGameAwareChat({chat:bridge,gameService:{snapshot:()=>null},displayId:'test',content:text,
 options:{tierOverride:{providerId:'glm',model:'mock',client}},callbacks:{onVideos:event=>{incoming.push(event);media.receiveVideos(event)},onComplete:(text)=>media.complete({content:text})}});
 assert.equal((await run('生成橘猫视频')).success,true);await media.waitAll();assert.equal(incoming.length,1);assert.equal(chat.getHistory()[0].videos.length,1);
 assert.equal((await run('再说说视频')).success,true);assert.equal(payloads[1].previous_response_id,'resp_1');
 chat.shutdown();chat.init({llmProfiles:[profile]});assert.equal(chat.getHistory()[0].videos[0].url,'/uploads/chat-videos/aaa.mp4');assert.equal(chat.getHistory()[0].videoGeneration.status,'completed');
 const user=chat.addMessage({role:'user',content:'再生成',mode:'group'});
 chat.addMessage({role:'assistant',content:'生成中',mode:'group',replyToMessageId:user.id,videoGeneration:{status:'pending'}});
 chat.addMessage({role:'assistant',content:'已提交',mode:'group',replyToMessageId:user.id});
 assert.equal(chat.deleteConversationRound({messageId:user.id,mode:'group'}).success,true);assert.equal(chat.getHistory().length,1);assert.equal(deleted,1);
 chat.clearHistory({mode:'group'});assert.equal(deleted,2);assert.equal(chat.getHistory().length,0);chat.shutdown();
 })().catch(e=>{console.error(e);process.exitCode=1});`;
 await promisify(execFile)(process.execPath,['-e',script,directory],{cwd:path.resolve(__dirname,'..'),timeout:15000});
});

test('视频模型设置按WS规范化持久化和广播，不覆盖主模型/生图选择',async()=>{
 const {createChatModelTierService}=require('../src/apps/server/modules/chat/chat-model-tier-service');const values={'chat.imageSelection':{providerId:'glm',model:'glm-image'},'chat.modelTierSelection':{providerId:'qwen'}};const events=[];
 const runtime={getStatus:()=>({running:true}),videoService:{create:async()=>({id:'task'}),wait:async()=>({data:videos})},dataStore:{listAccounts:async()=>[{providerId:'glm',accountId:'one'}]},providerRegistry:{listProviders:async()=>[{id:'glm'}]}};
 const service=createChatModelTierService({config:{get:key=>values[key],set:(key,value)=>{values[key]=value;return true}},getRuntime:()=>runtime,getActiveProfile:()=>({name:'one',model:'main'}),saveActiveModel:()=>{throw Error('不能改主模型')},broadcast:event=>events.push(event)});
 await service.update({purpose:'video',providerId:'glm',model:'glm-video'});assert.equal(values['chat.videoSelection'].model,'glm-video');assert.equal(values['chat.imageSelection'].model,'glm-image');assert.equal(events.at(-1).videoSelection.providerId,'glm');assert.equal((await service.snapshot()).videoProviders.length,1);
 await assert.rejects(service.update({purpose:'video',providerId:'qwen',model:'glm-video'}),/不匹配/);
});

test('一段视频下载失败不会丢弃同一回复中其他已生成的视频',async()=>{
 const chat=chatFixture();const coordinator=createNativeChatImages({chat,scope:{},requestId:'partial',publish:()=>{},videoAssets:{save:async video=>{if(video.url.endsWith('a.mp4'))throw Error('下载失败');return {url:'/uploads/chat-videos/bbbb.mp4'}}}});
 coordinator.receiveVideos({videos});coordinator.complete({content:'两段视频。'});await coordinator.waitAll();
 assert.equal(chat.history[0].videos.length,1);assert.equal(chat.history[0].videoGeneration.status,'failed');assert.match(chat.history[0].content,/两段视频/);
});
