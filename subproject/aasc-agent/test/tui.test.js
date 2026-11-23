import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { Agent, runTui } from '../src/index.js';

function agent(overrides = {}) {
  return new Agent({
    roles: [
      { name: '主', persona: '管理', permissions: ['delegate'] },
      { name: '子', persona: '执行', permissions: ['echo'] },
      { name: '受限', permissions: [] },
    ],
    tools: { echo: { async execute(input) { return input; } } },
    commandRoles: ['子'],
    model: {
      async respond({ message }) { return `收到：${message}`; },
      async decide({ role, task }) {
        if (role.name === '主') return { tool: 'delegate', role: '子', task };
        return { tool: 'echo', input: task };
      },
    },
    ...overrides,
  });
}

function outputBuffer() {
  let text = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { text += chunk.toString(); callback(); } }),
    text: () => text,
  };
}

test('自然语言对话、帮助、错误恢复与退出', async () => {
  const out = outputBuffer();
  const subject = agent({ model: { async respond({ message }) {
    if (message === '错误') throw new Error('模型暂不可用');
    return `收到：${message}`;
  } } });
  const input = Readable.from(['/help\n你好\n错误\n继续\n/exit\n不应执行\n']);
  await runTui({ agent: subject, input, output: out.stream });
  assert.match(out.text(), /直接输入自然语言/);
  assert.match(out.text(), /AI：收到：你好/);
  assert.match(out.text(), /错误：模型暂不可用/);
  assert.match(out.text(), /AI：收到：继续/);
  assert.doesNotMatch(out.text(), /AI：收到：不应执行/);
});

test('用户输入方括号只交给模型，不会直接执行本地命令', async () => {
  let seen, executed = 0;
  const subject = agent({
    tools: { echo: { async execute() { executed++; } } },
    model: { async respond({ message }) { seen = message; return '普通回复'; } },
  });
  assert.equal((await subject.chat('[子,"任务"]')).text, '普通回复');
  assert.equal(seen, '[子,"任务"]');
  assert.equal(executed, 0);
});

test('模型明确提出的方括号命令通过角色白名单和工具权限', async () => {
  const events = [];
  let feedback;
  const subject = agent({ model: {
    async respond({ toolResults, previousReply }) {
      if (!toolResults.length) return { text: '开始处理', commands: ['[子,"任务"]'] };
      feedback = { toolResults, previousReply };
      return '完成';
    },
    async decide({ task }) { return { tool: 'echo', input: task }; },
  } });
  const response = await subject.chat('请处理任务', { onEvent: e => events.push(e.type) });
  assert.equal(response.text, '开始处理\n完成');
  assert.deepEqual(response.results, [{ role: '子', result: '任务' }]);
  assert.deepEqual(feedback.toolResults, [{ role: '子', result: '任务' }]);
  assert.deepEqual(feedback.previousReply.commands, ['[子,"任务"]']);
  assert.deepEqual(events, ['run:start', 'decision', 'tool:start', 'tool:complete', 'run:complete']);
});

test('模型反复提出指令时受到调用轮数限制', async () => {
  let executed = 0;
  const subject = agent({ maxModelTurns: 2,
    tools: { echo: { async execute() { executed++; return 'ok'; } } },
    model: {
      async respond() { return { commands: ['[子,任务]'] }; },
      async decide() { return { tool: 'echo', input: 'x' }; },
    },
  });
  await assert.rejects(subject.chat('测试'), /模型调用轮次超限/);
  assert.equal(executed, 1);
});

test('可选择在轮次上限安全停止，保留已执行结果且不执行最后命令', async () => {
  let executed = 0;
  const subject = agent({ maxModelTurns: 2,
    tools: { echo: { async execute() { executed++; return 'ok'; } } },
    model: { async respond() { return { commands: ['[子,任务]'] }; }, async decide() { return { tool: 'echo' }; } },
  });
  const result = await subject.chat('测试', { stopAtTurnLimit: true });
  assert.equal(executed, 1);
  assert.equal(result.results.length, 1);
  assert.match(result.text, /最后提出的命令未执行/);
});

test('未授权或格式错误的模型命令不会部分执行', async () => {
  let executed = 0;
  const subject = agent({
    tools: { echo: { async execute() { executed++; } } },
    model: {
      async respond() { return { commands: ['[子,任务]', '[受限,任务]'] }; },
      async decide() { return { tool: 'echo', input: 'x' }; },
    },
  });
  await assert.rejects(subject.chat('测试'), /模型无权调用角色/);
  assert.equal(executed, 0);
  subject.model.respond = async () => ({ commands: ['[子,任务]', '[子,]'] });
  await assert.rejects(subject.chat('测试'), /角色和任务不能为空/);
  assert.equal(executed, 0);
  subject.model.respond = async () => ({ commands: ['[子,任务]'] });
  subject.commandRoles.clear();
  await assert.rejects(subject.chat('测试'), /模型无权调用角色/);
  assert.equal(executed, 0);
});

test('模型纯文本中的方括号不会被当作执行指令', async () => {
  let executed = 0;
  const subject = agent({
    tools: { echo: { async execute() { executed++; } } },
    model: { async respond() { return '[子,任务]'; } },
  });
  assert.deepEqual(await subject.chat('解释格式'), { text: '[子,任务]', results: [] });
  assert.equal(executed, 0);
});

test('空输入和 EOF 正常结束，显示文本过滤终端控制字符', async () => {
  const out = outputBuffer();
  await runTui({ agent: agent(), input: Readable.from(['\n\u001b[31m文本\u001b[0m\n']), output: out.stream });
  assert.match(out.text(), /AI：收到：文本/);
  assert.doesNotMatch(out.text(), /\u001b/);
});

test('委派事件按角色和层级传递，未授权工具不会执行', async () => {
  const events = [];
  assert.equal(await agent().runCommand('[主,"任务"]', { onEvent: event => events.push(event) }), '任务');
  assert.deepEqual(events.map(({ type, role, depth }) => [type, role, depth]), [
    ['run:start', '主', 0], ['decision', '主', 0], ['delegate', '主', 0],
    ['run:start', '子', 1], ['decision', '子', 1], ['tool:start', '子', 1],
    ['tool:complete', '子', 1], ['run:complete', '子', 1], ['run:complete', '主', 0],
  ]);
  const denied = [];
  await assert.rejects(agent().runCommand('[受限,"任务"]', { onEvent: event => denied.push(event.type) }), /无权/);
  assert.deepEqual(denied, ['run:start', 'decision', 'run:error']);
});

test('事件观察器异常不会更改执行结果', async () => {
  assert.equal(await agent().runCommand('[子,"任务"]', { onEvent() { throw new Error('观察失败'); } }), '任务');
  assert.equal(await agent().runCommand('[子,"任务"]', { onEvent() { return Promise.reject(new Error('异步观察失败')); } }), '任务');
  await new Promise(resolve => setImmediate(resolve));
});

test('CLI 演示模式使用自然语言且不依赖外部服务', () => {
  const run = spawnSync(process.execPath, ['src/tui-cli.js', '--demo'], {
    cwd: new URL('..', import.meta.url), input: '你好\n/exit\n', encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /演示模式/);
  assert.match(run.stdout, /AI：演示回复：你好/);
});

test('CLI 缺少本地配置时明确报错', () => {
  const run = spawnSync(process.execPath, ['src/tui-cli.js'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, AASC_AGENT_MODULE: '', AASC_AGENT_CONFIG: '/nonexistent/aasc-agent-config.json' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /未找到配置文件/);
});

test('CLI 从宿主模块加载可对话的 Agent', () => {
  const run = spawnSync(process.execPath, ['src/tui-cli.js'], {
    cwd: new URL('..', import.meta.url), input: '请执行测试\n/exit\n', encoding: 'utf8',
    env: { ...process.env, AASC_AGENT_MODULE: 'test/fixtures/host.js' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /AI：宿主收到请求/);
  assert.match(run.stdout, /本地结果：宿主结果:请执行测试/);
  assert.doesNotMatch(run.stdout, /演示模式/);
});

test('任务异步执行时后续输入仍按顺序处理', async () => {
  const out = outputBuffer();
  const calls = [];
  const slow = { async chat(text) {
    calls.push(text);
    await new Promise(resolve => setTimeout(resolve, 10));
    return text;
  } };
  await runTui({ agent: slow, input: Readable.from(['one\ntwo\n/exit\n']), output: out.stream });
  assert.deepEqual(calls, ['one', 'two']);
  assert.match(out.text(), /AI：one[\s\S]*AI：two/);
});

test('模型获准调用角色也不能绕过角色的工具权限', async () => {
  let executed = 0;
  const subject = agent({
    commandRoles: ['受限'],
    tools: { echo: { async execute() { executed++; } } },
    model: {
      async respond() { return { commands: ['[受限,任务]'] }; },
      async decide() { return { tool: 'echo', input: 'x' }; },
    },
  });
  await assert.rejects(subject.chat('请求'), /角色无权使用能力/);
  assert.equal(executed, 0);
});

test('npm start 默认进入自然语言界面', () => {
  const run = spawnSync('npm', ['run', '--silent', 'start', '--', '--demo'], {
    cwd: new URL('..', import.meta.url), input: '你好\n/exit\n', encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /输入消息与 AI 对话/);
  assert.match(run.stdout, /AI：演示回复：你好/);
});

test('查看、切换、错误后保留与重置聊天角色', async () => {
  const seen = [];
  const subject = agent({ model: { async respond({ message, role }) {
    seen.push({ message, role });
    return '收到';
  } } });
  const out = outputBuffer();
  const input = Readable.from(['/role\n/role 子\n第一条\n/role 不存在\n第二条\n/role --default\n第三条\n/exit\n']);
  await runTui({ agent: subject, input, output: out.stream });
  assert.match(out.text(), /可用角色：主、子、受限/);
  assert.match(out.text(), /当前角色：子/);
  assert.match(out.text(), /未知角色：不存在/);
  assert.deepEqual(seen, [
    { message: '第一条', role: { name: '子', persona: '执行' } },
    { message: '第二条', role: { name: '子', persona: '执行' } },
    { message: '第三条', role: null },
  ]);
});

test('聊天角色在模型调用和工具反馈各轮保持一致', async () => {
  const seen = [];
  const subject = agent({ model: {
    async respond({ role, toolResults }) {
      seen.push(role);
      return toolResults.length ? '处理完成' : { commands: ['[子,任务]'] };
    },
    async decide({ task }) { return { tool: 'echo', input: task }; },
  } });
  const result = await subject.chat('请处理', { role: '主' });
  assert.equal(result.text, '处理完成');
  assert.deepEqual(seen, [{ name: '主', persona: '管理' }, { name: '主', persona: '管理' }]);
  await assert.rejects(subject.chat('请处理', { role: '不存在' }), /未知角色/);
});

test('选择聊天角色不会扩大模型可调用角色权限', async () => {
  let executed = 0;
  const subject = agent({ commandRoles: [],
    tools: { echo: { async execute() { executed++; } } },
    model: {
      async respond() { return { commands: ['[子,任务]'] }; },
      async decide() { return { tool: 'echo' }; },
    },
  });
  await assert.rejects(subject.chat('请求', { role: '子' }), /模型无权调用角色/);
  assert.equal(executed, 0);
});

test('演示入口可以列出和切换角色', () => {
  const run = spawnSync('npm', ['run', '--silent', 'start', '--', '--demo'], {
    cwd: new URL('..', import.meta.url), input: '/role\n/role 讲解\n你好\n/exit\n', encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /可用角色：助手、讲解/);
  assert.match(run.stdout, /当前角色：讲解/);
  assert.match(run.stdout, /AI：讲解：演示回复：你好/);
});

test('/new 仅重置当前选择的角色，不删除网页对话', async () => {
  const resets = [];
  const out = outputBuffer();
  const subject = agent({ defaultRole: '主', model: {
    async respond({ role }) { return `角色:${role.name}`; },
    resetSession(role) { resets.push(role?.name ?? null); },
  } });
  await runTui({ agent: subject, input: Readable.from(['/new\n/role 子\n/new\n你好\n/exit\n']), output: out.stream });
  assert.deepEqual(resets, ['主', '子']);
  assert.match(out.text(), /原网页对话未删除/);
  assert.match(out.text(), /AI：角色:子/);
});
