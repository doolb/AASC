'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AiRolesService = require('./ai-roles-service');
const KEEPER = path.join(__dirname, 'pipe-keeper.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')); }

// 跟踪所有创建的 service，测试结束后统一 stop 各角色桥：
// 每个阻塞的 out.fifo 读端会占一个 libuv threadpool 线程，若不清理，
// 存活的 detached claude/守卫会残留 /tmp 与进程，污染后续运行（同 claude-bridge 测试的清理模式）。
const _services = [];

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

function makeService(dir, baseDir) {
    const fakePath = path.join(dir, 'fake.js');
    fs.writeFileSync(fakePath, FAKE_SCRIPT);
    // 造一个 workgroup/roles/ 目录结构，供提示词复用
    fs.mkdirSync(path.join(dir, 'workgroup', 'roles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'workgroup', 'roles', '后端.md'), '你是后端角色，负责接口。');
    const svc = new AiRolesService({
        baseDir,
        projectRoot: dir,
        commandPath: process.execPath,
        commandArgs: [fakePath],
        keeperPath: KEEPER
    });
    _services.push(svc);
    return svc;
}

afterEach(() => { for (const s of _services) for (const b of s.bridges.values()) b.stop(); });

test('add/list 往返，running 状态', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    const list = svc.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, '后端');
    assert.strictEqual(list[0].running, false, '未对话不启动');
    assert.throws(() => svc.add('后端'), /已存在/);
    svc.remove('后端');
    assert.deepStrictEqual(svc.list(), []);
});

test('chat 走 claude，历史写入并随响应返回', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');

    const chunks = [];
    const result = await svc.chat('后端', '做个接口', {
        onChunk: (c) => chunks.push(c),
        onComplete: (message, history) => {
            assert.strictEqual(message, 'echo:做个接口');
            assert.strictEqual(history.length, 2, '完成时历史含 user+assistant 两条');
            assert.strictEqual(history[0].role, 'control');
            assert.strictEqual(history[1].role, 'assistant');
        }
    });
    assert.ok(result.success, `chat 应成功: ${result.error}`);
    assert.strictEqual(chunks.join(''), 'echo:做个接口');
    assert.strictEqual(svc.history('后端').length, 2, '历史应持久化');
    assert.strictEqual(svc.list()[0].running, true, '对话后进程运行');
});

test('提示词复用 workgroup/roles/<名>.md', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    // prompt 文件内容应来自 roles/后端.md
    const promptFile = path.join(base, '后端', 'prompt.txt');
    assert.ok(fs.existsSync(promptFile));
    assert.strictEqual(fs.readFileSync(promptFile, 'utf8'), '你是后端角色，负责接口。');
});

test('restoreAll：角色存活则重连，删除后 remove 回收', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    await svc.chat('后端', 'hi', {});
    svc.restoreAll();
    assert.strictEqual(svc.list()[0].running, true, '存活角色应重连保持 running');

    // 删除回收：claude + 守卫进程与目录都清除
    svc.remove('后端');
    assert.deepStrictEqual(svc.list(), []);
    assert.ok(!fs.existsSync(path.join(base, '后端')), '角色目录应删除');
});
