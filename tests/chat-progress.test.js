'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizeChatProgress } = require('../src/core/utils/chat-progress');

test('聊天进度只允许固定状态与文案，不透出上游凭据或原始消息', () => {
    assert.deepEqual(normalizeChatProgress({ code: 'doubao_signature_refreshing', message: 'Cookie=secret', signature: 'private' }),
        { code: 'doubao_signature_refreshing', message: '正在重新获取豆包签名…' });
    assert.equal(normalizeChatProgress({ code: 'unknown', message: 'secret' }), null);
    assert.equal(normalizeChatProgress({ code: '__proto__' }), null);
});

test('实际LLM经游戏和SubAI双桥即时传状态，状态不进正文/TTS/历史且不阻止原有无输出重试', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat-progress-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = `
      const assert=require('node:assert/strict');
      const paths=require.resolve('./src/apps/server/modules/config/user-config-paths');
      require.cache[paths]={id:paths,filename:paths,loaded:true,exports:{USER_CONFIG_DIR:process.argv[1]}};
      const chat=require('./src/external/llm/llm-service');
      const {createSubAiChatBridge}=require('./src/apps/server/modules/sub-ai/sub-ai-chat-bridge');
      const {runGameAwareChat}=require('./src/apps/server/modules/game/game-chat-bridge');
      chat.init({llmProfiles:[{name:'isolated',mode:'llm',model:'mock',protocol:'openai-responses',apiUrl:'http://invalid.test/v1'}]});
      const statuses=[],speech=[];let calls=0,release;const gate=new Promise(resolve=>{release=resolve});
      const client={async stream(payload,emit){calls++;
        emit({type:'response.progress',code:'doubao_signature_refreshing',message:'Cookie=secret'});
        emit({type:'response.progress',code:'unknown',message:'private'});
        if(calls===1)throw Object.assign(new Error('socket hang up'),{code:'ECONNRESET'});
        await gate;emit({type:'response.progress',code:'doubao_signature_retrying'});
        emit({type:'response.output_text.delta',delta:'早上好。'});
        emit({type:'response.completed',response:{id:'resp_progress',output_text:'早上好。'}});
      }};
      (async()=>{
        const bridge=createSubAiChatBridge(chat,{dispatch:async()=>{throw Error('不应调用任务')}});
        const job=runGameAwareChat({chat:bridge,gameService:{snapshot:()=>null},displayId:'test',content:'早',
          options:{tierOverride:{model:'mock',providerId:'doubaochat',client}},
          callbacks:{onStatus:s=>{statuses.push(s);if(statuses.length===1)throw Error('提示端暂时不可用')},onSentence:s=>speech.push(s)}});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(statuses[0].message,'正在重新获取豆包签名…');
        release();const result=await job;
        assert.equal(calls,2);assert.equal(result.message,'早上好。');
        assert.equal(statuses.at(-1).code,'doubao_signature_retrying');
        assert.doesNotMatch(JSON.stringify(statuses),/Cookie|secret|private/);
        assert.doesNotMatch(speech.join(''),/签名/);
        chat.addMessage({role:'assistant',content:result.message});
        assert.doesNotMatch(JSON.stringify(chat.getHistory()),/签名|signature|secret/);chat.shutdown();
      })().catch(e=>{console.error(e);process.exitCode=1});
    `;
    await promisify(execFile)(process.execPath, ['-e', source, directory], { cwd: path.resolve(__dirname, '..'), timeout: 15000 });
});
