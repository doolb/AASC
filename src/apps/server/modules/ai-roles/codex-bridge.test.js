'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CodexBridge = require('./codex-bridge');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bridge-')); }

const bridges = [];

// 假 app-server：实现 bridge 所需的最小 JSON-RPC 协议，并把收到的命令写入文件供断言。
const FAKE_SERVER = `
const fs = require('node:fs');
const readline = require('readline');
const logFile = process.env.CODEX_TEST_LOG;
const log = (value) => fs.appendFileSync(logFile, JSON.stringify(value) + '\\n');
let turn = 0;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch (_) { return; }
  log({ request: req, proxy: process.env.HTTPS_PROXY });
  if (req.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }) + '\\n');
    return;
  }
  if (req.method === 'thread/start') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { thread: { id: 'thread-test-1' } } }) + '\\n');
    return;
  }
  if (req.method === 'turn/start') {
    turn += 1;
    const text = req.params.input[0].text;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { turn: { id: 'turn-' + turn } } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { delta: 'reply:' + text } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'thread-test-1', turn: { id: 'turn-' + turn, status: 'completed' } } }) + '\\n');
  }
});
`;

function makeBridge(dir) {
    const script = path.join(dir, 'fake-codex.js');
    const logFile = path.join(dir, 'requests.jsonl');
    fs.writeFileSync(script, FAKE_SERVER);
    const bridge = new CodexBridge({
        dir,
        name: '测试角色',
        commandPath: process.execPath,
        commandArgs: [script],
        cwd: dir,
        env: { CODEX_TEST_LOG: logFile },
        readTimeoutMs: 1000
    });
    bridges.push(bridge);
    return { bridge, logFile };
}

afterEach(() => { for (const bridge of bridges.splice(0)) bridge.stop(); });

test('Codex app-server 通过 JSON-RPC 保持 thread 上下文并流式回复', async () => {
    const dir = tmpDir();
    const { bridge, logFile } = makeBridge(dir);
    const chunks = [];
    const first = await bridge.chat('第一条', { onChunk: (chunk) => chunks.push(chunk) });
    const second = await bridge.chat('第二条', { onChunk: (chunk) => chunks.push(chunk) });

    assert.strictEqual(first.message, 'reply:第一条');
    assert.strictEqual(second.message, 'reply:第二条');
    assert.deepStrictEqual(chunks, ['reply:第一条', 'reply:第二条']);
    const requests = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepStrictEqual(requests.filter((item) => item.request.id !== undefined).map((item) => item.request.method), [
        'initialize', 'thread/start', 'turn/start', 'turn/start'
    ]);
    const turns = requests.filter((item) => item.request.method === 'turn/start');
    assert.strictEqual(turns[0].request.params.threadId, 'thread-test-1');
    assert.strictEqual(turns[1].request.params.threadId, 'thread-test-1');
});

test('Codex 子进程使用专用 HTTPS_PROXY', async () => {
    const dir = tmpDir();
    const { bridge, logFile } = makeBridge(dir);
    await bridge.chat('代理检查', {});
    const firstRequest = JSON.parse(fs.readFileSync(logFile, 'utf8').split('\n')[0]);
    assert.strictEqual(firstRequest.proxy, 'http://127.0.0.1:7899');
});

test('stop() 结束 Codex app-server 并清理运行状态', async () => {
    const dir = tmpDir();
    const { bridge } = makeBridge(dir);
    await bridge.chat('结束', {});
    assert.ok(bridge.isAlive());
    bridge.stop();
    const deadline = Date.now() + 2000;
    while (bridge.isAlive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(!bridge.isAlive());
});
