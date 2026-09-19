const assert = require('assert');
const fs = require('fs');

const chatJs = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/js/chat.js',
    'utf8'
);
const serverJs = fs.readFileSync(
    'src/apps/server/boot/server-app.js',
    'utf8'
);

assert.match(chatJs, /temporaryHistoryGroups/);
assert.match(chatJs, /temporaryHistoryViewSessionId/);
assert.match(chatJs, /renderTemporaryHistorySelector/);
assert.match(chatJs, /viewTemporaryHistory/);
assert.match(chatJs, /showCurrentTemporaryConversation/);
assert.match(chatJs, /历史临时会话只读查看/);
assert.match(chatJs, /不能发送消息/);
assert.match(serverJs, /historyGroups:/);
assert.match(serverJs, /getTemporaryConversationHistoryGroups/);

console.log('temporary-conversation-history-ui.test.js: 9/9 passed');
