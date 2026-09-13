const assert = require('assert');
const fs = require('fs');

const llmService = require('../src/external/llm/llm-service');

function testSingleRolePromptDoesNotIncludeOtherRoles() {
    llmService.setTemplates([
        { id: '小爱', name: '小爱', content: '小爱设定' },
        { id: '妲己', name: '妲己', content: '妲己设定' }
    ], { persist: false });

    const singlePrompt = llmService.getTemplateSystemPrompt('小爱');
    assert(singlePrompt.includes('小爱设定'));
    assert(!singlePrompt.includes('妲己设定'));
    assert(llmService.getGroupSystemPrompt().includes('妲己设定'));
}

function testServerAndControlContracts() {
    const serverSource = fs.readFileSync(
        'src/apps/server/boot/server-app.js',
        'utf8'
    );
    const controlSource = fs.readFileSync(
        'src/apps/web-mediacenter/ui/public/js/chat.js',
        'utf8'
    );

    assert(serverSource.includes("data.type === 'startTemporaryConversation'"));
    assert(serverSource.includes("'startTemporaryConversation',"));
    assert(serverSource.includes('roleName: temporaryConversation.roleName'));
    assert(serverSource.includes('chat.getTemplateSystemPrompt(temporaryConversation.roleName)'));
    assert(controlSource.includes('onTemporaryRoleChange'));
    assert(controlSource.includes('temporaryConversationId'));
    assert(controlSource.includes('type: \'startTemporaryConversation\''));
}

testSingleRolePromptDoesNotIncludeOtherRoles();
testServerAndControlContracts();
console.log('temporary-role-contract.test.js: 2/2 passed');
