const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const chatScript = fs.readFileSync(
    path.join(projectRoot, 'src/apps/web-mediacenter/ui/public/js/chat.js'),
    'utf8'
);
const uploadPage = fs.readFileSync(
    path.join(projectRoot, 'src/apps/web-mediacenter/ui/public/upload.html'),
    'utf8'
);
const offlineChatDefaultsSources = [
    'src/apps/server/modules/config/config-app-service.js',
    'src/external/llm/llm-service.js',
    'src/apps/server/boot/server-app.js',
    'src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js',
    'src/apps/server/modules/chat/pi-runtime-manager.js'
].map(relativePath => ({
    relativePath,
    source: fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}));

test('聊天设置应将协议和接口认证放在 LLM 服务器配置中', () => {
    assert.match(uploadPage, /id="profileEditProtocol"/);
    assert.match(uploadPage, /Chat Completions API URL/);
    assert.match(uploadPage, /profile.*API Key|API Key.*profile/s);
    assert.doesNotMatch(uploadPage, /id="chatProtocol"/);
    assert.doesNotMatch(uploadPage, /id="chatResponsesBaseUrl"/);
    assert.doesNotMatch(uploadPage, /id="chatResponsesApiKey"/);
});

test('聊天配置客户端应只保存全局聊天字段，并在 profile 中保存协议', () => {
    assert.doesNotMatch(chatScript, /responsesBaseUrl:/);
    assert.doesNotMatch(chatScript, /responsesApiKey:/);
    assert.doesNotMatch(chatScript, /data\.config\.responsesBaseUrl/);
    assert.doesNotMatch(chatScript, /chatResponsesBaseUrl/);
    assert.doesNotMatch(chatScript, /chatResponsesApiKey/);
    assert.match(chatScript, /profileEditProtocol/);
    assert.match(chatScript, /protocol.*openai-completions|openai-completions.*protocol/s);
    assert.match(chatScript, /profile.*apiKey|apiKey.*profile/s);
});

test('聊天设置外部保存不得提交或回填 profile 配置', () => {
    assert.match(chatScript, /globalConfig\s*=\s*\{[\s\S]{0,300}systemPrompt[\s\S]{0,300}agentBackend/u);
    assert.match(chatScript, /body:\s*JSON\.stringify\(globalConfig\)/u);
    assert.match(chatScript, /this\.config\.systemPrompt\s*=\s*data\.config\.systemPrompt/u);
    assert.match(chatScript, /this\.config\.agentBackend\s*=\s*data\.config\.agentBackend/u);
    assert.doesNotMatch(chatScript, /this\.config\s*=\s*\{\s*\.\.\.this\.config,\s*\.\.\.data\.config\s*\}/u);
});

test('聊天配置接口只使用全局字段筛选并保留 profile', () => {
    const server = fs.readFileSync(
        path.join(projectRoot, 'src/apps/server/boot/server-app.js'),
        'utf8'
    );
    assert.match(server, /chat\.pickGlobalChatConfig\(req\.body\)/u);
    assert.match(server, /config\.get\(['"]chat['"],\s*\{\}\)/u);
    assert.match(server, /const persistedChatConfig\s*=\s*\{/u);
    assert.match(server, /storedChatConfig && typeof storedChatConfig === 'object'\s*\? storedChatConfig/u);
    assert.match(server, /\.\.\.chat\.pickGlobalChatConfig\(newConfig\)/u);
    assert.match(server, /config\.set\(['"]chat['"],\s*persistedChatConfig\)/u);
    assert.doesNotMatch(server, /const newConfig = chat\.setConfig\(req\.body\);\s*config\.set\(['"]chat['"], newConfig\)/u);
});

test('默认配置应将调用协议放在默认 LLM profile 中', () => {
    const defaultConfigSource = fs.readFileSync(
        path.join(projectRoot, 'src/apps/server/modules/config/config-app-service.js'),
        'utf8'
    );

    assert.match(defaultConfigSource, /llmProfiles[\s\S]{0,1200}protocol:\s*'openai-responses'/u);
    assert.doesNotMatch(defaultConfigSource, /responsesBaseUrl|responsesApiKey/u);
});

test('运行时代码不应从全局 Responses 配置读取地址或密钥', () => {
    for (const { relativePath, source } of offlineChatDefaultsSources) {
        assert.doesNotMatch(source, /responsesBaseUrl|responsesApiKey/u, `${relativePath} 仍读取全局 Responses 配置`);
    }
});

test('offline server-app 将内置 HTTPS LLM 传输上下文注入聊天服务', () => {
    const server = fs.readFileSync(
        path.join(projectRoot, 'src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(server, /chat\.init\(config\.get\(['"]chat['"],\s*\{\}\),\s*\{[\s\S]{0,500}offlineNodeMode:\s*OFFLINE_NODE_MODE[\s\S]{0,500}localLlmBaseUrl:[\s\S]{0,500}localLlmHostnames:/u);
});

test('WSViewBind 控制端 chatMessage 应进入统一聊天处理器', () => {
    const server = fs.readFileSync(
        path.join(projectRoot, 'src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(server, /async function handleChatMessageRequest\(data,\s*\{\s*displayId,\s*ws\s*\}\)/u);
    assert.match(server, /async function handleControlMessageFallback\(data, ws\)\s*\{[\s\S]{0,1200}if \(data\.type === 'chatMessage'\)\s*\{[\s\S]{0,300}handleChatMessageRequest\(data,\s*\{\s*displayId,\s*ws\s*\}\)/u);
});
