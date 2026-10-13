'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createChat2ApiDataStore}=require('./chat2api-data-store');
const {createChat2ApiProviderRegistry}=require('./chat2api-provider-registry');
const {createChat2ApiCredentialValidators}=require('./chat2api-credential-validators');
test('API手动格式校验不发送上游，公开摘要不暴露APIKey且明确未远端验证',async t=>{
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-api-account-'));t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
  const store=createChat2ApiDataStore({rootDir});const registry=createChat2ApiProviderRegistry({dataStore:store});
  const validators=createChat2ApiCredentialValidators({httpClient:()=>{throw new Error('禁止网络');}});
  for(const id of ['qwen-api','doubaapi']){
    const provider=await registry.getProvider(id);assert.ok(provider,'API Provider已登记');
    const result=await validators[id].validate({apiKey:'test-key-for-fixture'},provider);assert.equal(result.valid,true);
    await store.saveAccount({accountId:id,providerId:id,credentials:result.credentials,accountInfo:result.accountInfo});
  }
  const publicAccounts=await store.listAccounts();assert.ok(!JSON.stringify(publicAccounts).includes('test-key'));
  assert.equal(publicAccounts[0].accountInfo.credentialVerification,'format-only');
});
test('扩展映射保存导入往返保留音色与绑定，拒绝非法参数',async t=>{
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-tts-mapping-'));t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
  const store=createChat2ApiDataStore({rootDir});
  const mapping={model:'qiaoxiaojiao',actualModel:'qwen-api/qwen-audio-3.1-tts-flash',application:'tts',parameters:{voice:'qiaoxiaojiao_v3.1'},preferredAccountId:'one'};
  await store.saveModelMapping(mapping);const exported=await store.exportConfiguration();
  assert.deepEqual(exported.modelMappings,[mapping]);
  await assert.rejects(store.saveModelMapping({...mapping,parameters:{apiKey:'leak'}}),e=>e.statusCode===400);
  await assert.rejects(store.previewImport({version:1,modelMappings:[{...mapping,parameters:{speed:NaN}}]}),e=>e.statusCode===400);
});
test('API可选端点和资源在账号元数据保存，带密钥的URL或非法资源拒绝',async()=>{
  const validators=createChat2ApiCredentialValidators({httpClient:()=>{throw new Error('不得网络');}});
  const provider={id:'doubaapi'};
  const result=await validators.doubaapi.validate({apiKey:'fixture',endpoint:'http://127.0.0.1:1234/tts',resourceId:'seed-tts-1.0'},provider);
  assert.equal(result.accountInfo.endpoint,'http://127.0.0.1:1234/tts');assert.equal(result.accountInfo.resourceId,'seed-tts-1.0');
  assert.deepEqual(result.credentials,{apiKey:'fixture'});
  assert.equal((await validators.doubaapi.validate({apiKey:'fixture',endpoint:'https://u:secret@private/a'},provider)).valid,false);
});
