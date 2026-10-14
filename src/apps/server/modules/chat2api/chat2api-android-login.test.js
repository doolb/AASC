const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiOAuthService } = require('./chat2api-oauth-service');
const { createChat2ApiCredentialValidators } = require('./chat2api-credential-validators');
const { BUILTIN_PROVIDERS } = require('./chat2api-provider-registry');

test('Android 登录候选只在 Provider 验证成功后出现在账号列表', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-android-login-'));
  try {
    const dataStore = createChat2ApiDataStore({ rootDir });
    const provider = {
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: true,
      credentialFields: [{ name: 'token', required: true }],
    };
    const service = createChat2ApiOAuthService({
      dataStore,
      providerRegistry: { getProvider: async (providerId) => providerId === provider.id ? provider : null },
      credentialAdapters: {
        deepseek: {
          validate: async (credentials) => ({ valid: credentials.token === 'captured', credentials }),
        },
      },
    });
    const started = await service.startLogin('deepseek');

    assert.equal(started.androidWebView, true);
    assert.equal(started.captureProfile.script, undefined);
    await assert.rejects(
      () => service.completeLogin({ state: started.state, providerId: 'deepseek', credentials: { token: 'invalid' } }),
      /校验失败/,
    );
    assert.deepEqual(await dataStore.listAccounts(), []);

    const result = await service.completeLogin({ state: started.state, providerId: 'deepseek', credentials: { token: 'captured' } });
    assert.equal(result.account.secretConfigured, true);
    assert.doesNotMatch(JSON.stringify(result), /captured/u);
    assert.equal((await dataStore.listAccounts()).length, 1);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('Android豆包嵌套Node资料经过正式验证保存，回调和账号列表不泄露设备身份', async () => {
  const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'aasc-doubao-android-node-'));
  try {
    const dataStore=createChat2ApiDataStore({rootDir});
    const provider=BUILTIN_PROVIDERS.find(p=>p.id==='doubaochat');
    let requests=0;
    const validators=createChat2ApiCredentialValidators({httpClient:{request:async()=>{requests++;return{status:200,data:{status_code:0,cmd:3200,downlink_body:{pull_recent_conv_chain_downlink_body:{cells:[]}}}};}}});
    const service=createChat2ApiOAuthService({dataStore,providerRegistry:{getProvider:async()=>provider},credentialAdapters:validators});
    const started=await service.startLogin('doubaochat');
    assert.equal(started.captureProfile.nodeProfile,'doubao');
    const credentials={cookie:'sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456789',
      nodeProfile:{deviceId:'1234567890123456789',webId:'9876543210123456789',fp:'verify_mock_123456789',userAgent:'Mozilla/5.0 (Linux; Android 9) Chrome/138.0.0.0'}};
    await assert.rejects(service.completeLogin({state:started.state,providerId:'doubaochat',credentials:{...credentials,nodeProfile:JSON.stringify(credentials.nodeProfile)}}), /格式无效/u);
    assert.equal(requests,0);assert.equal((await dataStore.listAccounts()).length,0);
    const result=await service.completeLogin({state:started.state,providerId:'doubaochat',credentials});
    assert.equal(requests,1);
    const saved=await dataStore.getAccount(result.account.accountId);
    assert.equal(saved.credentials.nodeProfile.deviceId,credentials.nodeProfile.deviceId);
    assert.equal(saved.credentials.nodeProfile.pcVersion,'3.41.0');
    assert.equal(saved.accountInfo.credentialVerification,'conversation-list');
    const publicJson=JSON.stringify([result,await dataStore.listAccounts()]);
    for(const secret of [credentials.cookie,...Object.values(credentials.nodeProfile)]) assert.equal(publicJson.includes(secret),false);
  } finally {await fs.rm(rootDir,{recursive:true,force:true});}
});
