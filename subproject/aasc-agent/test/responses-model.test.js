import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, createConfiguredAgent, loadConfig, ResponsesModel } from '../src/index.js';

const api = { baseUrl: 'http://127.0.0.1:5918/v1', apiKey: 'test-key', model: 'gemini-flash', timeoutMs: 300000 };
const roles = [
  { name: '主助手', persona: '主角色', permissions: [] },
  { name: '游戏', persona: '游戏角色', permissions: [] },
];
function response(id, text) {
  return { ok: true, status: 200, async json() { return { id, status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text }] },
  ] }; } };
}

test('配置从 JSON 加载并校验角色、地址和密钥', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'aasc-agent-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'config.json');
  const raw = { api, roles, defaultRole: '主助手', commandRoles: [] };
  await writeFile(file, JSON.stringify(raw));
  assert.equal((await loadConfig(file)).api.baseUrl, api.baseUrl);
  const example = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url)));
  assert.equal(example.api.apiKey, '');
  assert.deepEqual(example.commandRoles, []);
  await writeFile(file, JSON.stringify({ ...raw, api: { ...api, baseUrl: 'http://user:secret@example.com/v1' } }));
  await assert.rejects(loadConfig(file), /无凭据/);
  await writeFile(file, JSON.stringify({ ...raw, commandRoles: ['未注册'] }));
  await assert.rejects(loadConfig(file), /可调用角色配置无效/);
});

test('Responses 按角色独立续接，默认角色与重置生效', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return response('resp_' + requests.length, '回答' + requests.length);
  };
  const subject = createConfiguredAgent({ api, roles, defaultRole: '主助手', commandRoles: [] }, { fetchImpl });
  assert.equal((await subject.chat('你好')).text, '回答1');
  await subject.chat('第二条');
  await subject.chat('游戏问题', { role: '游戏' });
  await subject.chat('继续', { role: '主助手' });
  assert.equal(requests[0].url, 'http://127.0.0.1:5918/v1/responses');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-key');
  assert.equal(requests[0].body.previous_response_id, undefined);
  assert.equal(requests[1].body.previous_response_id, 'resp_1');
  assert.equal(requests[1].body.instructions, undefined);
  assert.equal(requests[2].body.previous_response_id, undefined);
  assert.equal(requests[3].body.previous_response_id, 'resp_2');
  assert.match(requests[2].body.instructions, /游戏角色/);
  await subject.resetChat({ role: '游戏' });
  await subject.chat('新会话', { role: '游戏' });
  assert.equal(requests[4].body.previous_response_id, undefined);
});

test('可显式兼容每轮都要求 instructions 的服务', async () => {
  const requests = [];
  const model = new ResponsesModel({ api: { ...api, instructionsEachRequest: true }, roles,
    fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return response('resp-' + requests.length, 'ok'); } });
  await model.respond({ message: '一', role: roles[0] });
  await model.respond({ message: '二', role: roles[0] });
  assert.equal(requests[1].previous_response_id, 'resp-1');
  assert.match(requests[1].instructions, /主角色/);
});

test('工具输出回传模型且决策只能选择角色允许的能力', async () => {
  const requests = [];
  const roleSet = [{ name: '助手', persona: '助手', permissions: ['echo'] }];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (body.instructions?.includes('能力选择器')) return response('decision', '{"tool":"echo","input":"测试"}');
    if (body.previous_response_id) return response('resp_2', '执行完成');
    return response('resp_1', '[助手,任务]');
  };
  const subject = createConfiguredAgent({ api, roles: roleSet, defaultRole: '助手', commandRoles: ['助手'] }, {
    fetchImpl, tools: { echo: { async execute(input) { return '本地:' + input; } } },
  });
  const result = await subject.chat('执行任务');
  assert.equal(result.text, '执行完成');
  assert.deepEqual(result.results, [{ role: '助手', result: '本地:测试' }]);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].previous_response_id, 'resp_1');
  assert.match(requests[2].input, /本地:测试/);
});

test('只有整段合法方括号命令可触发，普通文字中的方括号不触发', async () => {
  const model = new ResponsesModel({ api, roles, fetchImpl: async () => response('resp_1', '例如 [游戏,任务]') });
  assert.equal(await model.respond({ message:'说明格式', role: roles[0], roles }), '例如 [游戏,任务]');
  model.fetch = async () => response('resp_2', '[游戏,"任务,一"]');
  assert.deepEqual(await model.respond({ message:'执行', role: roles[0], roles }), { commands: ['[游戏,"任务,一"]'] });
});

test('服务明确恢复链头后的失败可复用会话，已执行工具不重复', async () => {
  const requests = []; let actions = 0;
  const configuredRoles = [{ name: '主助手', persona: '', permissions: [] }, { name: '游戏', persona: '', permissions: ['act'] }];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) return response('resp-1', '[游戏,动作]');
    if (requests.length === 2) return { ok: false, status: 502, async json() { return { error: { message: '明确失败', code: 'upstream_confirmed_failure_retryable' } }; } };
    return response('resp-2', '已恢复');
  };
  const subject = createConfiguredAgent({ api, roles: configuredRoles, defaultRole: '主助手', commandRoles: ['游戏'] }, {
    fetchImpl, directDecision: () => ({ tool: 'act', input: {} }), tools: { act: { async execute() { actions++; return '已执行'; } } },
  });
  await assert.rejects(subject.chat('操作'), /明确失败/);
  assert.equal(actions, 1);
  assert.equal((await subject.chat('继续')).text, '已恢复');
  assert.equal(requests[2].previous_response_id, 'resp-1');
  assert.equal(actions, 1);
});

test('模型错误隐藏密钥且续接失败后需要显式新建会话', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1 || calls === 3) return response('resp_' + calls, 'ok');
    return { ok: false, status: 401, async json() { return { error: { message: 'bad test-key' } }; } };
  };
  const model = new ResponsesModel({ api, roles, fetchImpl });
  await model.respond({ message:'一', role:roles[0], roles:[] });
  await assert.rejects(model.respond({ message:'二', role:roles[0], roles:[] }), e => /\/new/.test(e.message) && !e.message.includes('test-key'));
  await assert.rejects(model.respond({ message:'三', role:roles[0], roles:[] }), /\/new/);
  await model.resetSession(roles[0]);
  assert.equal(await model.respond({ message:'新', role:roles[0], roles:[] }), 'ok');
});

test('默认角色和工具失败后的会话保护', async () => {
  const seen = [];
  const model = {
    async respond({ role }) { seen.push(role.name); return { commands:['[游戏,任务]'] }; },
    async decide() { return { tool:'missing', input:'x' }; },
    markSessionUncertain(role) { seen.push('uncertain:' + role.name); },
  };
  const subject = new Agent({ roles:[{ name:'游戏', persona:'游戏', permissions:['missing'] }],
    tools:{}, model, commandRoles:['游戏'], defaultRole:'游戏' });
  await assert.rejects(subject.chat('执行'), /能力未注册/);
  assert.deepEqual(seen, ['游戏', 'uncertain:游戏']);
});

test('终端通过真实 HTTP 请求使用配置模型并按角色续接', async t => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, auth: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: `resp_${requests.length}`, status: 'completed', output: [
      { type: 'message', content: [{ type: 'output_text', text: `回复${requests.length}` }] },
    ] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = await mkdtemp(join(tmpdir(), 'aasc-agent-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ api: { ...api, baseUrl: `http://127.0.0.1:${server.address().port}/v1` },
    roles, defaultRole: '主助手', commandRoles: [] }));
  const child = spawn(process.execPath, ['src/tui-cli.js'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, AASC_AGENT_MODULE: '', AASC_AGENT_CONFIG: file },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdin.end('你好\n继续\n/role 游戏\n游戏问题\n/role 主助手\n继续主会话\n/exit\n');
  const status = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(status, 0, errors);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(r => r.url === '/v1/responses' && r.auth === 'Bearer test-key'));
  assert.equal(requests[1].body.previous_response_id, 'resp_1');
  assert.equal(requests[2].body.previous_response_id, undefined);
  assert.equal(requests[3].body.previous_response_id, 'resp_2');
  assert.match(output, /AI：回复4/);
});

test('未启用本地角色时保留用户请求的 JSON 文本', async () => {
  const json = '{"text":"报告","commands":[]}';
  const model = new ResponsesModel({ api, roles, fetchImpl: async () => response('resp_1', json) });
  assert.equal(await model.respond({ message:'请输出 JSON', role: roles[0], roles:[] }), json);
});

test('请求超时会中止并提示显式新建会话', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const model = new ResponsesModel({ api: { ...api, timeoutMs: 10 }, roles, fetchImpl });
  await assert.rejects(model.respond({ message:'你好', role:roles[0], roles:[] }), /超时.*\/new/);
});

test('模型的能力决策不能选择未授权工具', async () => {
  const permitted = [{ name: '助手', persona: '助手', permissions: ['echo'] }];
  const model = new ResponsesModel({ api, roles: permitted,
    fetchImpl: async () => response('decision', '{"tool":"shell","input":"danger"}') });
  await assert.rejects(model.decide({ role: permitted[0], task: '测试', args: [] }), /未授权能力/);
});
