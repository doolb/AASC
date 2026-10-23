'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {prepareMediaImages,equivalentResponsesFingerprint}=require('../src/external/llm/llm-media-context');
const dataUrl='data:image/png;base64,aGVsbG8=';
const image={id:'cat',url:'/uploads/chat-images/abc.png',mimeType:'image/png'};

test('图片增量去重、原生上下文复用与重建读取保持分离，不跨配置丢图',async()=>{
 let reads=0;const readImage=async()=>{reads++;return {data:Buffer.from('hello'),mimeType:'image/png'}};
 const native={...image,origin:'main',originProfile:'one'};
 assert.equal((await prepareMediaImages({history:[native],sameUpstream:true,profileName:'one',readImage})).images.length,0);
 assert.equal(reads,0);
 const restored=await prepareMediaImages({history:[native],sameUpstream:false,profileName:'one',readImage});
 assert.equal(restored.images[0].dataUrl,dataUrl);
 assert.equal((await prepareMediaImages({history:[native],sameUpstream:true,profileName:'two',readImage})).images.length,1);
 assert.equal((await prepareMediaImages({history:[image],current:[{...image,dataUrl}],sameUpstream:true,knownIds:restored.sentImageIds,readImage})).images.length,0);
 await assert.rejects(prepareMediaImages({current:[image],allowed:false}),/不支持上传图片/);
 assert.equal((await prepareMediaImages({history:[image],allowed:false})).images.length,0);
 await assert.rejects(prepareMediaImages({current:[image]}),/无法读取/);
});

test('旧指纹只迁移应用参考图清单，角色或模型变化仍重建',()=>{
 const make=(prompt,model='one')=>JSON.stringify({systemPrompt:prompt,model});
 assert.equal(equivalentResponsesFingerprint(make('SubAI 指令调用行\n\n可用参考图ID：cat\n\n角色'),make('SubAI 指令调用行\n\n角色')),true);
 assert.equal(equivalentResponsesFingerprint(make('角色\n\n可用参考图ID：cat'),make('角色')),false);
 assert.equal(equivalentResponsesFingerprint(make('SubAI 指令调用行'),make('SubAI 指令调用行','two')),false);
});

test('真实LLM+SubAI三轮raw图片续聊、重启引用、失效恢复和能力配置权威同步',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-chat-media-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const script=`
 const assert=require('node:assert/strict');
 const paths=require.resolve('./src/apps/server/modules/config/user-config-paths');
 require.cache[paths]={id:paths,filename:paths,loaded:true,exports:{USER_CONFIG_DIR:process.argv[1]}};
 const chat=require('./src/external/llm/llm-service');
 const {createSubAiChatBridge}=require('./src/apps/server/modules/sub-ai/sub-ai-chat-bridge');
 const {PiProfileConfig}=require('./src/apps/server/modules/chat/pi-profile-config');
 const profile={name:'one',mode:'llm',promptFormat:'raw',model:'mock',protocol:'openai-responses',apiUrl:'http://invalid.test/v1'};
 let reads=0;const readChatImage=async()=>{reads++;return {data:Buffer.from('hello'),mimeType:'image/png'}};
 chat.init({llmProfiles:[profile]},{readChatImage});
 const requests=[];let fail=false;
 const client={async stream(p,emit){requests.push(p);if(fail){fail=false;throw Object.assign(new Error('gone'),{code:'response_not_found'})}
 emit({type:'response.output_text.delta',delta:'一只猫。'});emit({type:'response.completed',response:{id:'resp_'+requests.length,conversation:{id:'conv_test'}}});}};
 const options={systemPrompt:'你是助手',tierOverride:{providerId:'qwen',model:'mock',client}};
 const img={id:'cat',url:'/uploads/chat-images/abc.png',mimeType:'image/png',origin:'subai'};
 const run=async(text,refs=[])=>createSubAiChatBridge(chat,{references:refs,dispatch:async()=>{throw Error('无任务')}}).chatStream(text,{...options,contextImages:refs},{});
 (async()=>{
 assert.equal(chat.getProfiles()[0].supportsImageUpload,true);assert.equal(chat.getProfiles()[0].supportsVideoUpload,false);
 assert.equal(chat.normalizeLlmProfile({...profile,supportsVideoUpload:true}).supportsVideoUpload,true);
 assert.throws(()=>chat.normalizeLlmProfile({...profile,supportsImageUpload:'false'}),/布尔/);
 assert.equal((await run('画猫')).success,true);
 assert.equal((await run('说说这张图',[img])).success,true);
 assert.equal(requests[1].previous_response_id,'resp_1');assert.equal(requests[1].input[0].content.filter(p=>p.type==='input_image').length,1);
 assert.match(requests[1].input[0].content[0].text,/可用参考图ID：cat/);
 assert.equal((await run('猫的颜色',[img])).success,true);assert.equal(requests[2].previous_response_id,'resp_2');assert.equal(reads,1);
 chat.shutdown();chat.init({llmProfiles:[profile]},{readChatImage});
 assert.equal((await run('继续',[img])).success,true);assert.equal(requests[3].previous_response_id,'resp_3');assert.equal(reads,1);
 fail=true;assert.equal((await run('再说一次',[img])).success,true);
 const recovery=requests.at(-1);assert.equal(recovery.previous_response_id,undefined);assert.equal(recovery.input.length,1);assert.equal(recovery.input[0].role,'user');
 assert.match(recovery.input[0].content[0].text,/^System:/);assert.equal(recovery.input[0].content.filter(p=>p.type==='input_image').length,1);assert.equal(reads,2);
 const events=[],stored={};const config={get:(_k,d)=>d,set:(key,value)=>{stored[key]=value;return true}};
 const manager=new PiProfileConfig({chat,config,dependencies:{},broadcast:e=>events.push(e)});
 const result=await manager.update({type:'chatProfilesConfig',profiles:[{...profile,supportsImageUpload:false,supportsVideoUpload:false}],name:'one'});
 assert.equal(result.profiles[0].supportsImageUpload,false);assert.equal(stored.chat.llmProfiles[0].supportsVideoUpload,false);
 assert.equal(manager.snapshot().profiles[0].supportsImageUpload,false);assert.ok(events.some(e=>e.type==='chatProfilesConfig'));
 chat.shutdown();
 })().catch(e=>{console.error(e);process.exitCode=1});`;
 await promisify(execFile)(process.execPath,['-e',script,directory],{cwd:path.resolve(__dirname,'..'),timeout:15000});
});
