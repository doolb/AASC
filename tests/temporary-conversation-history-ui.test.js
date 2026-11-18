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

assert.doesNotMatch(chatJs, /temporaryHistoryViewSessionId/);
assert.doesNotMatch(chatJs, /renderTemporaryHistorySelector/);
assert.match(chatJs, /this\.temporaryConversation\.messages/);
assert.match(serverJs, /historyGroups:/);
assert.match(serverJs, /getContinuousTemporaryConversationHistory/);
assert.match(chatJs, /清空全部临时聊天记录/);
assert.doesNotMatch(chatJs, /历史临时会话只读查看/);

console.log('temporary-conversation-history-ui.test.js: 连续历史契约通过');
