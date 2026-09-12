'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const nodeMain = read('src/apps/voice-display-node/main.js');
const nodeClient = read('src/apps/voice-display-node/asr-client.js');
const server = read('src/apps/server/boot/server-app.js');

test('Node 使用服务器确认的 displayId 作为 ASR 来源', () => {
    assert.match(
        nodeMain,
        /case\s+'displayId'[\s\S]{0,500}this\.serverDisplayId\s*=\s*data\.id\.trim\(\)[\s\S]{0,500}this\.config\.displayId\s*=\s*this\.serverDisplayId/,
        'Node 应保存服务器通过 WebSocket 确认的 displayId'
    );
    assert.match(nodeMain, /await\s+this\.waitForServerDisplayId\(\)/, 'Node 应等待服务器确认 displayId 后再启动 ASR');
    assert.match(nodeMain, /displayId:\s*this\.serverDisplayId/, 'ASR 上传应使用服务器确认的 displayId');
    assert.match(nodeClient, /x-aasc-display-id/i, 'ASR 请求应显式携带来源 displayId');
    assert.match(nodeClient, /x-aasc-display-kind/i, 'ASR 请求应标记为子显示端来源');
});

test('服务器按已连接显示端绑定 ASR 来源后再处理语音指令', () => {
    assert.match(server, /function\s+resolveAsrSourceDisplayId/, '服务器应提供 ASR 来源绑定函数');
    assert.match(
        server,
        /const\s+sourceDisplayId\s*=\s*resolveAsrSourceDisplayId\(/,
        'ASR 接口应使用绑定后的来源 ID'
    );
    assert.match(
        server,
        /processRecognizedAsrResultForDisplay\(sourceDisplayId,/,
        '服务器应使用绑定后的来源进入语音命令处理链路'
    );
    assert.match(server, /displayKind\s*!==\s*'subdisplay'/, '来源回退只能用于明确标记的子显示端');
    assert.match(server, /displayData\.isSubDisplay\s*===\s*true/, '来源回退只能匹配在线子显示端');
});

console.log('node-display-asr-source-binding.test.js: contract checks passed');
