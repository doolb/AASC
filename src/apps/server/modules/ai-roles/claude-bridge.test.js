'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ClaudeBridge = require('./claude-bridge');
const KEEPER = path.join(__dirname, 'pipe-keeper.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-')); }

// 跟踪所有创建的 bridge，测试结束后统一 stop()：
// claude 进程退出 → out.fifo 写端关闭 → 阻塞的读端读到 EOF 释放 fd，测试进程才能自然退出。
const _bridges = [];

// 假 claude：读 stdin 每行，先逐字输出 text_delta，再输出 result 事件（与真实 claude stream-json 同构）
const FAKE_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch (e) { return; }
  const text = 'echo:' + (req.message && req.message.content ? req.message.content : '');
  for (const ch of text) {
    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ch } } }) + '\\n');
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: text }) + '\\n');
});
`;

function makeBridge(dir, overrides = {}) {
    const fakePath = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fakePath, FAKE_SCRIPT);
    const bridge = new ClaudeBridge({
        dir,
        name: '测试角色',
        command: `${process.execPath} ${fakePath}`,
        promptFile: path.join(dir, 'prompt.txt'),
        cwd: dir,
        keeperPath: KEEPER,
        ...overrides
    });
    _bridges.push(bridge);
    return bridge;
}

// 每个测试跑完立即回收本测试创建的 bridge：
// 1) 每个阻塞的 out.fifo 读端会占一个 libuv threadpool 线程（默认 4 个），
//    若测试间不清理，存活的 bridge 会把线程池占满，后续桥的读端永远等不到线程 → 测试挂起。
// 2) claude 进程退出 → out.fifo 写端关闭 → 阻塞读端读到 EOF 释放 fd/线程，测试进程才能退出。
afterEach(() => { for (const b of _bridges) b.stop(); });

test('懒启动 + 发消息 + 流式转发 + 完成回包', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'prompt.txt'), '你是测试角色');
    const bridge = makeBridge(dir);
    assert.ok(!bridge.isAlive(), '未发消息前不启动');

    const chunks = [];
    let done = null;
    const result = await bridge.chat('你好', {
        onChunk: (chunk) => chunks.push(chunk),
        onComplete: (message) => { done = message; }
    });

    assert.ok(result.success, `聊天应成功: ${result.error}`);
    assert.strictEqual(done, 'echo:你好');
    assert.strictEqual(chunks.join(''), 'echo:你好');
    assert.ok(bridge.isAlive(), '聊天后进程存活');
});

test('多轮持久：同一进程，上下文连续', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    const r1 = await bridge.chat('alpha', {});
    const pid1 = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    const r2 = await bridge.chat('beta', {});
    const pid2 = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    assert.strictEqual(r1.message, 'echo:alpha');
    assert.strictEqual(r2.message, 'echo:beta');
    assert.strictEqual(pid1, pid2, '两次聊天应为同一进程');
    assert.ok(bridge.isAlive());
});

test('stop() 回收进程并清管道', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('x', {});
    assert.ok(bridge.isAlive());
    bridge.stop();
    // 等待 SIGTERM 生效
    const end = Date.now() + 3000;
    while (bridge.isAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!bridge.isAlive(), 'stop 后 claude 应退出');
    assert.ok(!fs.existsSync(path.join(dir, 'in.fifo')), 'in.fifo 应删除');
    assert.ok(!fs.existsSync(path.join(dir, 'out.fifo')), 'out.fifo 应删除');
});

test('进程被强杀后 isAlive 变 false，cleanup 清理残留', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('x', {});
    const pid = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    const end = Date.now() + 3000;
    while (bridge.isAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!bridge.isAlive(), '强杀后检测到退出');
    bridge.cleanup();
    assert.ok(!fs.existsSync(path.join(dir, 'in.fifo')));
});

test('crash 后再次 chat 自动重建', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('a', {});
    const pid = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    const r2 = await bridge.chat('b', {});
    assert.strictEqual(r2.message, 'echo:b');
    assert.ok(bridge.isAlive());
});

test('reconnect()：存活返回 true 并重开读端；已死清理返回 false', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('a', {});
    // 模拟服务器重启：丢弃内存里的 reader，仅靠 pid 存活检测
    bridge.reader = null;
    const ok = bridge.reconnect();
    assert.strictEqual(ok, true);
    assert.ok(bridge.isAlive());
    // 再发消息仍可用（重连后读端已重开）
    const r2 = await bridge.chat('b', {});
    assert.strictEqual(r2.message, 'echo:b');

    // 已死场景
    const dir2 = tmpDir();
    const bridge2 = makeBridge(dir2);
    await bridge2.chat('a', {});
    const pid = parseInt(fs.readFileSync(path.join(dir2, 'claude.pid'), 'utf8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    const end = Date.now() + 3000;
    while (bridge2.isAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(bridge2.reconnect(), false);
});
