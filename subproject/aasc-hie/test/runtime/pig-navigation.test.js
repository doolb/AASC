import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { PigNavigation } from '../../src/runtime/pig-navigation.js';

const roots = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pig-nav-'));
  roots.push(root);
  const calls = [];
  const bridge = { async run(options) {
    calls.push(options);
    const dir = join(options.outputRoot, 'level-81-run-20261117-000000-000001');
    await mkdir(dir);
    await writeFile(join(dir, 'original.png'), 'test-image');
    await writeFile(join(dir, 'result.json'), JSON.stringify({ level: 81, status: 'inspection_only', clicks: 0, confirmed: 0 }));
    return { code: 2, success: false };
  } };
  return { root, bridge, calls };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('中层找到已验证布局时自动求解并在 plan-only 停止', async () => {
  const { root, bridge } = await setup();
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts/pig-nav-middle.py'), '');
  const calls = [];
  const processRunner = async (_command, args) => {
    calls.push(args[0]);
    const output = args[args.indexOf('--output') + 1];
    if (args[0].endsWith('pig-nav-middle.py')) await writeFile(output, JSON.stringify({ status: 'reviewed', layout: { reviewed: true } }));
    else await writeFile(output, JSON.stringify({ status: 'solved', navigation: { strategy: 'auto', replayed: true } }));
  };
  const nav = new PigNavigation({ level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, allowExecution: false, activate: async () => {} });
  const state = await nav.advance();
  expect(state.next).toBe('execute');
  expect(calls).toEqual(['scripts/pig-nav-middle.py', 'scripts/pig-nav-plan.py']);
});

it('中层接管可识别铁笼，plan-only 不点击，实际运行确认胜利', async () => {
  const { root, bridge } = await setup();
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts/pig-nav-middle.py'), '');
  const calls = [];
  const processRunner = async (_command, args) => {
    calls.push(args[0]);
    const output = args[args.indexOf('--output') + 1];
    if (args[0].endsWith('pig-nav-middle.py')) {
      await writeFile(output, JSON.stringify({ status: 'local_cage' }));
    } else {
      await mkdir(output);
      await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'victory' }));
      await writeFile(join(output, 'victory.png'), 'victory');
    }
  };
  const options = { level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, activate: async () => {} };
  const first = new PigNavigation({ ...options, allowExecution: false });
  const pending = await first.advance();
  expect(pending).toMatchObject({ executionDisabled: true, completed: false });
  expect(calls).toEqual(['scripts/pig-nav-middle.py']);
  const resumed = new PigNavigation({ ...options, sessionDir: pending.sessionDir });
  expect(await resumed.advance()).toMatchObject({ completed: true });
  expect(calls).toEqual(['scripts/pig-nav-middle.py', 'scripts/pig-nav-middle.py', 'scripts/pig-nav-cage.py']);
});

it('本地铁笼阶段中断时停止并拒绝重复执行', async () => {
  const { root, bridge } = await setup();
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts/pig-nav-middle.py'), '');
  let executions = 0;
  const processRunner = async (_command, args) => {
    if (args[0].endsWith('pig-nav-middle.py')) {
      await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ status: 'local_cage' }));
    } else { executions++; throw new Error('interrupted'); }
  };
  const nav = new PigNavigation({ level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, activate: async () => {} });
  expect(await nav.advance()).toMatchObject({ executionUncertain: true, completed: false });
  expect(await nav.advance()).toMatchObject({ executionUncertain: true, completed: false });
  expect(executions).toBe(1);
});

it('复核的保守铁笼阶段只在计划重放后执行并交回新现场', async () => {
  const { root, bridge } = await setup();
  const calls = [];
  const processRunner = async (_command, args) => {
    calls.push(args);
    const output = args[args.indexOf('--output') + 1];
    if (!args.includes('--execute')) {
      await writeFile(output, JSON.stringify({ status: 'partial', navigation: { stage: 'conservative_cage', strategy: 'auto', replayed: true } }));
    } else {
      await mkdir(output);
      await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'stage_complete' }));
    }
  };
  const options = { level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, activate: async () => {} };
  const first = new PigNavigation({ ...options, allowExecution: false });
  const initial = await first.advance();
  const layout = join(root, 'stage-layout.json');
  await writeFile(layout, JSON.stringify({ stage_mode: 'conservative_cage' }));
  const planned = await first.advance({ reviewedLayout: layout });
  expect(planned).toMatchObject({ next: 'execute', completed: false });
  expect(calls).toHaveLength(1);
  const resumed = new PigNavigation({ ...options, sessionDir: initial.sessionDir });
  expect(await resumed.advance()).toMatchObject({ stageComplete: true, completed: false });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain('--execute');
  expect(calls[1]).toContain('--plan');
  expect(await resumed.advance()).toMatchObject({ stageComplete: true });
  expect(calls).toHaveLength(2);
});

it('从导航包取得步骤，采集后在未复核处阻塞并保留跨进程进度', async () => {
  const { root, bridge, calls } = await setup();
  const options = { level: 81, windowId: '0x123', gameRoot: root, bridge, activate: async () => {} };
  const first = new PigNavigation(options);
  const state = await first.advance();
  expect(state).toMatchObject({ next: 'review', completed: false, reason: '当前布局和机制尚未复核' });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ inspectOnly: true, startLevel: 81, maxLevels: 1 });
  const second = new PigNavigation({ ...options, sessionDir: state.sessionDir });
  expect(await second.advance()).toMatchObject({ next: 'review', completed: false });
  expect(calls).toHaveLength(1);
});

it('试探开始后旧会话不可恢复或重复执行', async () => {
  const { root, bridge } = await setup();
  const options = { level: 81, windowId: '0x123', gameRoot: root, bridge, activate: async () => {} };
  const first = new PigNavigation(options);
  const state = await first.advance();
  await mkdir(join(state.sessionDir, 'probes', 'probe-pending'), { recursive: true });
  const resumed = new PigNavigation({ ...options, sessionDir: state.sessionDir });
  expect((await resumed.advance()).reason).toContain('重新采集现场');
});

it('只有求解重放和通关证据均存在才完成所有导航目标', async () => {
  const { root, bridge } = await setup();
  const calls = [];
  const processRunner = async (_cmd, args) => {
    calls.push(args[0]);
    const output = args[args.indexOf('--output') + 1];
    if (args[0].endsWith('pig-nav-plan.py')) {
      await writeFile(output, JSON.stringify({ status: 'solved', navigation: { strategy: 'auto', replayed: true } }));
    } else {
      await mkdir(output);
      await writeFile(join(output, 'result.json'), '{"status":"victory"}');
      await writeFile(join(output, 'victory.png'), 'victory');
    }
  };
  const navigation = new PigNavigation({ level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, activate: async () => {} });
  const initial = await navigation.advance();
  const layout = join(root, 'reviewed.json');
  await writeFile(layout, '{}');
  const complete = await navigation.advance({ reviewedLayout: layout });
  expect(complete).toMatchObject({ completed: true, next: null, sessionDir: initial.sessionDir });
  expect(complete.gaps.pending).toBe(0);
  expect(calls).toEqual(['scripts/pig-nav-plan.py', 'scripts/pig-nav-execute.py']);
  expect(JSON.parse(await readFile(join(complete.sessionDir, 'progress.json'), 'utf8')).periods.persistent.goals.victory.completed).toBe(true);
});

it('执行中断后保留标记并阻止在未知现场重试', async () => {
  const { root, bridge } = await setup();
  let executions = 0;
  const processRunner = async (_cmd, args) => {
    if (args[0].endsWith('pig-nav-plan.py')) {
      await writeFile(args[args.indexOf('--output') + 1], '{"status":"solved","navigation":{"strategy":"auto","replayed":true}}');
    } else { executions++; throw new Error('execution interrupted'); }
  };
  const navigation = new PigNavigation({ level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, activate: async () => {} });
  await navigation.advance();
  const layout = join(root, 'reviewed.json');
  await writeFile(layout, '{}');
  expect((await navigation.advance({ reviewedLayout: layout })).reason).toContain('interrupted');
  expect((await navigation.advance()).reason).toContain('上次执行');
  expect(executions).toBe(1);
});

it('首屏或已验证计划被修改时拒绝求解和执行', async () => {
  const { root, bridge } = await setup();
  let executions = 0;
  const processRunner = async (_cmd, args) => {
    if (args[0].endsWith('pig-nav-plan.py')) {
      await writeFile(args[args.indexOf('--output') + 1], '{"status":"solved","navigation":{"strategy":"auto","replayed":true}}');
    } else executions++;
  };
  const options = { level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, activate: async () => {}, allowExecution: false };
  const first = new PigNavigation(options);
  const captured = await first.advance();
  await writeFile(join(captured.evidence, 'original.png'), 'changed');
  expect((await first.advance()).reason).toContain('首屏证据已改变');
  await writeFile(join(captured.evidence, 'original.png'), 'test-image');
  const layout = join(root, 'layout.json');
  await writeFile(layout, '{}');
  const solved = await first.advance({ reviewedLayout: layout });
  expect(solved.next).toBe('execute');
  await writeFile(join(solved.sessionDir, 'plan.json'), '{}');
  const resumed = new PigNavigation({ ...options, allowExecution: true, sessionDir: solved.sessionDir });
  expect((await resumed.advance()).reason).toContain('求解计划已改变');
  expect(executions).toBe(0);
});

it('导航步骤调用真实 auto 求解器并保存经重放的完整计划', async () => {
  const { root, bridge } = await setup();
  const gameRoot = fileURLToPath(new URL('../../../aasc-game/', import.meta.url));
  const execute = promisify(execFile);
  const processRunner = async (command, args) => execute(command, args, { cwd: gameRoot, timeout: 60000 });
  const navigation = new PigNavigation({ level: 81, windowId: '0x123', gameRoot: root, bridge, processRunner, allowExecution: false, activate: async () => {} });
  await navigation.advance();
  const layout = join(root, 'reviewed.json');
  await writeFile(layout, JSON.stringify({ level: 81, reviewed: true, mechanicsReviewed: true, mechanics: ['ordinary'],
    source_sha256: createHash('sha256').update('test-image').digest('hex'), grid: [10, 10, 20, 3, 2], board: [0, 0, 80, 60], locks: {},
    pigs: [{ id: 1, center: [20, 10], direction: 'east', length: 2, grid: { col: 0, row: 0, cells: [[0, 0], [1, 0]] } }] }));
  const state = await navigation.advance({ reviewedLayout: layout });
  expect(state).toMatchObject({ next: 'execute', completed: false, reason: '执行未启用' });
  const plan = JSON.parse(await readFile(join(state.sessionDir, 'plan.json'), 'utf8'));
  expect(plan).toMatchObject({ status: 'solved', navigation: { strategy: 'auto', replayed: true } });
}, 90000);
