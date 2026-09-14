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
    'src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js'
].map(relativePath => ({
    relativePath,
    source: fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}));

test('聊天设置应提供协议和 Responses 网关配置项', () => {
    assert.match(uploadPage, /id="chatProtocol"/);
    assert.match(uploadPage, /id="chatResponsesBaseUrl"/);
    assert.match(uploadPage, /id="chatResponsesApiKey"/);
    assert.match(uploadPage, /Chat Completions API URL/);
});

test('聊天配置客户端应加载、显示并保存 Responses 传输配置', () => {
    assert.match(chatScript, /protocol:\s*'openai-responses'/);
    assert.match(chatScript, /responsesBaseUrl:/);
    assert.match(chatScript, /responsesApiKey:/);
    assert.match(chatScript, /data\.config\.responsesBaseUrl/);
    assert.match(chatScript, /chatResponsesBaseUrl/);
    assert.match(chatScript, /chatResponsesApiKey/);
    assert.match(chatScript, /this\.config\.protocol/);
});

test('当前聊天配置应将 Responses 网关指向本机 8081 服务', () => {
    const config = JSON.parse(fs.readFileSync(
        path.join(projectRoot, 'config/config.json'),
        'utf8'
    ));

    assert.equal(config.chat.protocol, 'openai-responses');
    assert.equal(config.chat.responsesBaseUrl, 'http://127.0.0.1:8081/v1');
});

test('offline APK 内置 Node 服务的 Responses 默认值应使用本机 8081', () => {
    for (const { relativePath, source } of offlineChatDefaultsSources) {
        assert.match(source, /http:\/\/127\.0\.0\.1:8081\/v1/u, `${relativePath} 缺少 offline Responses 默认地址`);
        assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1:8083\/v1/u, `${relativePath} 仍保留旧 Responses 默认地址`);
    }
});
