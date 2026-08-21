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
        keeperPath: KEEPER,
        getAgentBackend: () => 'claude'
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

test('删除后同名角色可重建并继续聊天', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    svc.remove('后端');
    svc.add('后端');
    const result = await svc.chat('后端', '重建后消息', {});
    assert.ok(result.success, `重建后的角色应可聊天: ${result.error}`);
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

test('chat 回调透传 requestId', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    const chunks = [];
    await svc.chat('后端', '带请求号', { requestId: 'role-req-1', onChunk: (chunk) => chunks.push(chunk) });
    assert.strictEqual(chunks.join(''), 'echo:带请求号');
});

test('提示词复用 workgroup/roles/<名>.md', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    const promptFile = path.join(base, '后端', 'prompt.txt');
    assert.ok(fs.existsSync(promptFile));
    const prompt = fs.readFileSync(promptFile, 'utf8');
    assert.ok(prompt.includes('你是后端角色，负责接口。'));
    assert.ok(prompt.includes('当前角色自管理'));
});

test('启动提示词注入当前角色 history.md 和自管理路径', () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const historyDir = path.join(dir, 'workgroup', 'members', 'control-后端');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'history.md'), [
        '# 专长画像', '{"接口": 2}', '',
        '## 经验约定', '- 接口变更要同步 spec', '',
        '## 最近记录', '- {"id":"task-1","title":"接口任务"}'
    ].join('\n'));
    const svc = makeService(dir, base);
    svc.add('后端');

    const prompt = fs.readFileSync(path.join(base, '后端', 'prompt.txt'), 'utf8');
    assert.ok(prompt.includes('接口变更要同步 spec'));
    assert.ok(prompt.includes('接口任务'));
    assert.ok(prompt.includes(path.join(dir, 'workgroup', 'roles', '后端.md')));
    assert.ok(prompt.includes(path.join(dir, 'workgroup', 'members', 'control-后端', 'history.md')));
    assert.ok(prompt.includes('只能修改当前角色自己的'));
});

test('Claude 进程存活期间不在每条消息前重新读取 role.md', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    await svc.chat('后端', '第一条任务', {});
    const promptFile = path.join(base, '后端', 'prompt.txt');
    const initialPrompt = fs.readFileSync(promptFile, 'utf8');

    fs.writeFileSync(path.join(dir, 'workgroup', 'roles', '后端.md'), '角色定义已经更新');
    await svc.chat('后端', '第二条任务', {});

    assert.strictEqual(fs.readFileSync(promptFile, 'utf8'), initialPrompt);
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

test('全局后端变化不替换运行中的角色，退出后重建使用最新后端', () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    let globalBackend = 'codex';
    const created = [];
    const svc = new AiRolesService({
        baseDir: base,
        projectRoot: dir,
        getAgentBackend: () => globalBackend,
        bridgeFactory: (options) => {
            const bridge = {
                backend: options.backend,
                promptFile: null,
                alive: true,
                isAlive() { return this.alive; },
                reconnect() { return this.alive; },
                stop() { this.alive = false; },
                async chat() { return { success: true, message: 'ok' }; }
            };
            created.push(bridge);
            return bridge;
        }
    });
    svc.add('后端');
    const first = svc._bridge('后端');
    globalBackend = 'claude';
    assert.strictEqual(svc._bridge('后端'), first);
    first.alive = false;
    const rebuilt = svc._bridge('后端');
    assert.notStrictEqual(rebuilt, first);
    assert.strictEqual(rebuilt.backend, 'claude');
    assert.deepStrictEqual(created.map((bridge) => bridge.backend), ['codex', 'claude']);
    assert.strictEqual(svc.store.list()[0].backend, 'claude');
});

test('stopAll 关闭所有 Agent 但保留角色文件和角色记录', () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const bridges = [];
    const svc = new AiRolesService({
        baseDir: base,
        projectRoot: dir,
        getAgentBackend: () => 'codex',
        bridgeFactory: () => {
            const bridge = {
                alive: true,
                isAlive() { return this.alive; },
                stop() { this.alive = false; this.stopped = true; },
                reconnect() { return this.alive; },
                async chat() { return { success: true, message: 'ok' }; }
            };
            bridges.push(bridge);
            return bridge;
        }
    });
    svc.add('角色一');
    svc.add('角色二');
    const roleDefinition = path.join(dir, 'workgroup', 'roles', '角色一.md');
    fs.mkdirSync(path.dirname(roleDefinition), { recursive: true });
    fs.writeFileSync(roleDefinition, '角色定义');
    const roleHistory = path.join(dir, 'workgroup', 'members', 'control-角色一', 'history.md');
    assert.ok(fs.existsSync(roleHistory));
    svc._bridge('角色一');
    svc._bridge('角色二');

    const stopped = svc.stopAll();
    assert.strictEqual(stopped, 2);
    assert.strictEqual(svc.bridges.size, 0);
    assert.ok(bridges.every((bridge) => bridge.stopped));
    assert.deepStrictEqual(svc.store.list().map((role) => role.name).sort(), ['角色一', '角色二']);
    assert.ok(fs.existsSync(path.join(base, '角色一', 'role.json')));
    assert.ok(fs.existsSync(path.join(base, '角色二', 'role.json')));
    assert.ok(fs.existsSync(roleDefinition));
    assert.ok(fs.existsSync(roleHistory));
});
