'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { startAgentBackendHost } = require('./agent-backend-host');
const AgentBackendClient = require('./agent-backend-client');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-backend-ipc-'));
}

function waitForClose(host) {
    return host.close();
}

function makeFakeBridgeFactory() {
    const bridges = new Map();
    return {
        bridges,
        create(options) {
            const existing = bridges.get(options.name);
            if (existing) return existing;
            const bridge = {
                backend: options.backend,
                alive: false,
                threadId: 'thread-independent',
                isAlive() { return this.alive; },
                reconnect() { return this.alive; },
                async ensureStarted() { this.alive = true; },
                async chat(content, callbacks = {}) {
                    this.alive = true;
                    const message = `回复:${content}`;
                    callbacks.onChunk?.(message, message);
                    callbacks.onComplete?.(message);
                    return { success: true, message };
                },
                stop() { this.alive = false; }
            };
            bridges.set(options.name, bridge);
            return bridge;
        }
    };
}

const FAKE_CODEX_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let turn = 0;
rl.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch (_) { return; }
  if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n');
    return;
  }
  if (request.method === 'thread/start') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { thread: { id: 'persistent-thread' } } }) + '\\n');
    return;
  }
  if (request.method === 'turn/start') {
    turn += 1;
    const text = 'reply-' + turn + ':' + request.params.input[0].text;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { delta: text } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { status: 'completed' } } }) + '\\n');
  }
});
`;

test('服务器 IPC 客户端断开后，独立后端仍可由新客户端接管并继续聊天', async () => {
    const dir = tmpDir();
    const socketPath = path.join(dir, 'backend.sock');
    const fake = makeFakeBridgeFactory();
    const host = startAgentBackendHost({
        socketPath,
        bridgeFactory: (options) => fake.create(options)
    });
    const options = { name: '后端', backend: 'codex', dir, cwd: dir };
    const client1 = new AgentBackendClient({ socketPath, hostPath: path.join(dir, 'unused-host.js') });
    const bridge1 = client1.createBridge(options);
    const chunks = [];

    await bridge1.ensureStarted();
    await bridge1.chat('第一条', {
        onChunk: (chunk) => chunks.push(chunk)
    });
    await client1.close();

    const client2 = new AgentBackendClient({ socketPath, hostPath: path.join(dir, 'unused-host.js') });
    const bridge2 = client2.createBridge(options);
    assert.strictEqual(await bridge2.reconnect(), true);
    const result = await bridge2.chat('第二条', {});

    assert.deepStrictEqual(chunks, ['回复:第一条']);
    assert.strictEqual(result.message, '回复:第二条');
    assert.strictEqual(fake.bridges.get('后端').alive, true);

    await client2.close();
    await waitForClose(host);
});

test('客户端连接不到后端 Socket 时会拉起 detached 宿主并重试连接', async () => {
    const dir = tmpDir();
    const socketPath = path.join(dir, 'backend.sock');
    let spawnCount = 0;
    let host;
    const fake = makeFakeBridgeFactory();
    const client = new AgentBackendClient({
        socketPath,
        hostPath: path.join(dir, 'unused-host.js'),
        spawnHost: async () => {
            spawnCount += 1;
            host = startAgentBackendHost({
                socketPath,
                bridgeFactory: (options) => fake.create(options)
            });
        }
    });
    const bridge = client.createBridge({ name: '后端', backend: 'codex', dir, cwd: dir });

    await bridge.ensureStarted();

    assert.strictEqual(spawnCount, 1);
    assert.strictEqual(bridge.isAlive(), true);

    await client.close();
    await waitForClose(host);
});

test('真实 Codex bridge 在服务器客户端断开后保留 PID 和 thread', async () => {
    const dir = tmpDir();
    const script = path.join(dir, 'fake-codex.js');
    fs.writeFileSync(script, FAKE_CODEX_SERVER);
    const socketPath = path.join(dir, 'backend.sock');
    const host = startAgentBackendHost({ socketPath });
    const options = {
        name: '后端',
        backend: 'codex',
        dir,
        cwd: dir,
        codexCommandPath: process.execPath,
        codexCommandArgs: [script],
        readTimeoutMs: 1000
    };
    const client1 = new AgentBackendClient({ socketPath, hostPath: path.join(dir, 'unused-host.js') });
    const bridge1 = client1.createBridge(options);
    const first = await bridge1.chat('第一条', {});
    const pidBefore = fs.readFileSync(path.join(dir, 'codex.pid'), 'utf8').trim();
    await client1.close();

    const client2 = new AgentBackendClient({ socketPath, hostPath: path.join(dir, 'unused-host.js') });
    const bridge2 = client2.createBridge(options);
    assert.strictEqual(await bridge2.reconnect(), true);
    const second = await bridge2.chat('第二条', {});
    const pidAfter = fs.readFileSync(path.join(dir, 'codex.pid'), 'utf8').trim();

    assert.strictEqual(first.message, 'reply-1:第一条');
    assert.strictEqual(second.message, 'reply-2:第二条');
    assert.strictEqual(pidAfter, pidBefore);

    await client2.close();
    await host.close();
});

test('后端宿主 Unix Socket 权限限制为当前用户可读写', async () => {
    const dir = tmpDir();
    const socketPath = path.join(dir, 'backend.sock');
    const host = startAgentBackendHost({ socketPath, bridgeFactory: () => ({}) });
    await host.ready;

    const mode = fs.statSync(socketPath).mode & 0o777;
    assert.strictEqual(mode, 0o600);

    await waitForClose(host);
});
