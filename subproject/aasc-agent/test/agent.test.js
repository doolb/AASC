import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent, createHieTool, parseCommand } from '../src/index.js';

test('命令要求完整方括号并支持 CSV 引号和可选参数', () => {
  assert.deepEqual(parseCommand('[游戏,"今天,完成""日常""",普通]'), { role: '游戏', task: '今天,完成"日常"', args: ['普通'] });
  assert.throws(() => parseCommand('游戏,日常'));
  assert.deepEqual(parseCommand('游戏,日常', { requireBrackets: false }), { role: '游戏', task: '日常', args: [] });
  for (const bad of ['[游戏,"未结束]', '[游戏,]', '[游戏,"内容"异常]', '[游戏,日常']) assert.throws(() => parseCommand(bad));
});

test('委派后以目标角色权限执行，未授权能力被拒绝', async () => {
  const calls = [];
  const agent = new Agent({
    roles: [{ name: '管理员', permissions: ['delegate'] }, { name: '游戏', permissions: ['hie'] }, { name: '聊天', permissions: [] }],
    tools: { hie: createHieTool({ async execute(input, context) { calls.push(context.role); return input; } }) },
    model: { async decide({ role, task }) { return role.name === '管理员' ? { tool: 'delegate', role: task, task: '日常' } : { tool: 'hie', input: task }; } },
  });
  assert.equal(await agent.run('管理员', '游戏'), '日常');
  assert.equal(await agent.runCommand('[游戏,"日常"]'), '日常');
  assert.deepEqual(calls, ['游戏', '游戏']);
  await assert.rejects(agent.run('管理员', '聊天'), /无权/);
  await assert.rejects(agent.run('不存在', '任务'), /未知角色/);
  await assert.rejects(createHieTool().execute({}), /未连接/);
});

test('工具批次结束后可交回宿主，先确认批次再返回且不重复调用模型', async () => {
  const calls = [];
  const agent = new Agent({
    roles: [{ name: '主管', permissions: [] }, { name: '游戏', permissions: ['hie'] }],
    commandRoles: ['游戏'], defaultRole: '主管', maxModelTurns: 1,
    directDecision: () => ({ tool: 'hie', input: {} }),
    tools: { hie: { async execute() { calls.push('tool'); return { checked: true }; } } },
    model: {
      async respond() { calls.push('model'); return { commands: ['[游戏,run]'] }; },
      async beginToolBatch() { calls.push('begin'); },
      async finishToolBatch() { calls.push('finish'); },
    },
  });
  const result = await agent.chat('处理缺口', { returnAfterToolBatch: true });
  assert.deepEqual(calls, ['model', 'begin', 'tool', 'finish']);
  assert.equal(result.results[0].result.checked, true);
});

test('交回中层时拒绝多个命令，任何工具均不执行', async () => {
  let calls = 0;
  const agent = new Agent({
    roles: [{ name: '主管', permissions: [] }, { name: '游戏', permissions: ['hie'] }],
    commandRoles: ['游戏'], defaultRole: '主管', directDecision: () => ({ tool: 'hie', input: {} }),
    tools: { hie: { async execute() { calls++; } } },
    model: { async respond() { return { commands: ['[游戏,run]', '[游戏,snapshot]'] }; } },
  });
  const result = await agent.chat('处理缺口', { returnAfterToolBatch: true });
  assert.match(result.text, /只能包含一个命令/);
  assert.equal(calls, 0);
});
