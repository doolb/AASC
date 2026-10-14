const {test}=require('node:test');const assert=require('node:assert/strict');
const {createChat2ApiRuntime}=require('./chat2api-runtime');
const {createChat2ApiCoreAdapter}=require('./chat2api-core-adapter');
const request={model:'doubao',messages:[{role:'user',content:'本地模拟'}]};

test('旧Cookie-only账号无论网页开关是否开启都要求Node资料，不发文字请求',async()=>{
  for(const enabled of [true,false]) {
    let calls=0;
    const account={accountId:'selected',providerId:'doubaochat',credentials:{cookie:'mock'}};
    const core=createChat2ApiCoreAdapter({dataStore:{getAccount:async()=>account,listAccounts:async()=>[account]},
      providerRegistry:{listProviders:async()=>[{id:'doubaochat'}]},modelMapper:{resolveModel:async()=>({})},
      loadBalancer:{selectAccount:async()=>({account,provider:{id:'doubaochat'}})},
      getDoubaoWebConfig:()=>{throw Error(`旧配置${enabled}不应读取`);},providerAdapters:{doubaochat:async()=>{calls++;}}});
    await assert.rejects(core.forwardChatCompletion(request),e=>e.code==='doubao_node_profile_required'&&e.statusCode===422);
    assert.equal(calls,0);
  }
});

test('豆包固定文字别名不能被错误Provider映射转发，错误不带旧网页分支代码',async()=>{
  let calls=0;
  const core=createChat2ApiCoreAdapter({dataStore:{getAccount:async()=>null,listAccounts:async()=>[]},
    providerRegistry:{listProviders:async()=>[]},modelMapper:{resolveModel:async()=>({preferredProviderId:'qwen'})},
    loadBalancer:{selectAccount:async()=>{calls++;}}});
  await assert.rejects(core.forwardChatCompletion(request),e=>e.code==='doubao_account_conflict');assert.equal(calls,0);
});

test('runtime不读取已删除网页桥注入选项_构造和停止不创建Chrome连接',async()=>{
  const options={rootDir:'/unused',oauth:{stop:async()=>{}},accountWebSession:{clear(){}},proxy:{stop:async()=>{}}};
  for(const key of ['getDoubaoWebConfig','doubaoBrowserTransport'])Object.defineProperty(options,key,{get(){throw Error('不得读取旧分支');}});
  const runtime=createChat2ApiRuntime(options);await runtime.stop();
});
