'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createChat2ApiCoreAdapter}=require('./chat2api-core-adapter');
const config={enabled:true,port:9222,accountId:'bound',targetId:'target',contextId:'',allowSessionCheck:true};
function setup(mapping={},runtime=config){let calls=0;const selects=[];
 const provider={id:'doubaochat'},account={accountId:'bound',providerId:'doubaochat',enabled:true};
 const core=createChat2ApiCoreAdapter({dataStore:{getAccount:async()=>account,listAccounts:async()=>[account]},providerRegistry:{listProviders:async()=>[provider]},modelMapper:{resolveModel:async()=>mapping},
 loadBalancer:{selectAccount:async(...args)=>{selects.push(args);return {account,provider,actualModel:'doubao'}}},providerAdapters:{doubaochat:async()=>{calls++;return{body:{choices:[{message:{content:'ok'}}]}}}},getDoubaoWebConfig:()=>runtime});
 return {core,selects,calls:()=>calls};}
const request={model:'doubao',messages:[{role:'user',content:'文字'}]};
test('文字Core显式限定网页绑定账号；映射冲突/配置禁用拒绝，不发送上游',async()=>{
 const f=setup();await f.core.forwardChatCompletion(request);assert.equal(f.selects.at(-1)[4].requiredAccountId,'bound');assert.equal(f.calls(),1);
 for(const [mapping,runtime,code] of [[{preferredAccountId:'other'},config,'doubao_browser_binding'],[{}, {},'doubao_node_profile_required']]){const g=setup(mapping,runtime);await assert.rejects(g.core.forwardChatCompletion(request),e=>e.code===code);assert.equal(g.calls(),0)}
});

test('网页模式的豆包固定别名不能经冲突Provider映射发送到其它上游',async()=>{
 let called=0;const provider={id:'qwen'},account={accountId:'other',providerId:'qwen'};
 const core=createChat2ApiCoreAdapter({dataStore:{getAccount:async()=>account,listAccounts:async()=>[account]},providerRegistry:{listProviders:async()=>[provider]},modelMapper:{resolveModel:async()=>({preferredProviderId:'qwen'})},loadBalancer:{selectAccount:async()=>({account,provider})},providerAdapters:{qwen:async()=>{called++;return{body:{choices:[]}}}},getDoubaoWebConfig:()=>config});
 await assert.rejects(core.forwardChatCompletion(request),e=>e.code==='doubao_browser_binding');assert.equal(called,0);
});
