'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 把真实历史存储限制在临时目录，绝不触及用户配置和会话。
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-temporary-continuous-'));
const paths = require.resolve('../src/apps/server/modules/config/user-config-paths');
require.cache[paths] = { id:paths, filename:paths, loaded:true, exports:{ USER_CONFIG_DIR:directory } };
const chat = require('../src/external/llm/llm-service');
const { getContinuousTemporaryConversationHistory } = require('../src/apps/server/modules/voice/temporary-conversation-history');
test.after(async () => { await chat.shutdown(); fs.rmSync(directory, { recursive:true, force:true }); });

test('连续临时聊天超过旧上限仍保留，重启可恢复并能整条清空', async () => {
    chat.init({});
    for (let index = 0; index < 120; index++) {
        chat.addMessage({ mode:'temporary', sessionId:index < 60 ? 'old' : 'new', role:'control', content:`消息${index}` });
    }
    let messages = getContinuousTemporaryConversationHistory(chat.getHistory({ preserveThink:true }));
    assert.equal(messages.length, 120);
    assert.equal(messages[0].content, '消息0');
    assert.equal(messages.at(-1).content, '消息119');
    chat.addMessage({ mode:'group', role:'control', content:'群聊消息' });
    chat.clearHistory({ mode:'group' });
    assert.equal(getContinuousTemporaryConversationHistory(chat.getHistory()).length, 120, '清空群聊不能删除临时聊天');
    await chat.shutdown();
    chat.init({});
    messages = getContinuousTemporaryConversationHistory(chat.getHistory({ preserveThink:true }));
    assert.equal(messages.length, 120);
    assert.equal(messages[0].content, '消息0');
    assert.equal(messages.at(-1).content, '消息119');
    chat.clearHistory({ mode:'temporary' });
    assert.equal(getContinuousTemporaryConversationHistory(chat.getHistory()).length, 0);
    await chat.shutdown();
    chat.init({});
    assert.equal(getContinuousTemporaryConversationHistory(chat.getHistory()).length, 0);
});
