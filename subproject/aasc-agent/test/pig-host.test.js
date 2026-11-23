import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPigAgent } from '../src/pig-host.js';
import { runPigLoop } from '../src/pig-loop.js';

test('重复缺口跨进程去重，显式重试才再次调用高层', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pig-gap-resume-'));
  try {
    const evidenceRoot = join(root, 'docs/references/pig-game/play-runs');
    const sessionDir = join(evidenceRoot, 'nav-level-81-test');
    const evidence = join(sessionDir, 'capture');
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, 'original.png'), 'same-image');
    let highCalls = 0;
    const bridge = { async snapshot() { return { observation: { layout: { level: 81 } }, plans: [], gaps: [] }; } };
    const navigation = { sessionDir, async initialize() {}, async advance() { return { sessionDir, evidence, next: 'review', reason: '未知', completed: false }; } };
    const fetchImpl = async () => { highCalls++; return { ok: true, async json() { return { id: 'resp-1', status: 'completed', output_text: '[游戏,run]' }; } }; };
    const config = { api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } };
    const options = { startLevel: 81, windowId: '0x123', gameRoot: root, bridge, navigation, fetchImpl, activate: async () => {} };
    await runPigLoop(createPigAgent(config, options), 81, { maxRounds: 1, wait: async () => {} });
    const ref = JSON.parse(await readFile(join(sessionDir, 'agent-session-ref.json'), 'utf8'));
    const saved = JSON.parse(await readFile(join(evidenceRoot, '.agent-sessions', ref.id + '.json'), 'utf8'));
    assert.equal(saved.pending, null);
    assert.equal(saved.heads['游戏主管'], 'resp-1');
    await runPigLoop(createPigAgent(config, options), 81, { maxRounds: 1, wait: async () => {} });
    assert.equal(highCalls, 1);
    await runPigLoop(createPigAgent(config, options), 81, { maxRounds: 1, retryGap: true, wait: async () => {} });
    assert.equal(highCalls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('保守阶段完成后中层重新采集，不复用旧截图绑定的布局', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pig-stage-recapture-'));
  try {
    let captures = 0;
    const bridge = {
      async run(options) {
        captures++;
        const dir = join(options.outputRoot, 'level-81-run-20261120-000000-000001');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'original.png'), 'new-image');
        await writeFile(join(dir, 'result.json'), JSON.stringify({ level: 81, status: 'inspection_only', clicks: 0, confirmed: 0 }));
        return { code: 2 };
      },
      async snapshot() { return { observation: { layout: { level: 81, pigs: [] } }, plans: [], gaps: [] }; },
    };
    const navigation = { async advance() { return { stageComplete: true, sessionDir: 'old-stage', completed: false }; } };
    const config = { api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } };
    const agent = createPigAgent(config, { startLevel: 81, windowId: '0x123', gameRoot: root, bridge, navigation,
      reviewedLayout: '/stale-layout.json', activate: async () => {}, fetchImpl: async () => { throw new Error('不应请求高层'); } });
    const result = await agent.runMiddle();
    assert.equal(captures, 1);
    assert.equal(result.navigation.previousStage, 'old-stage');
    assert.equal(result.navigation.next, 'review');
    assert.equal(result.source_sha256, createHash('sha256').update('new-image').digest('hex'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('游戏宿主默认拒绝模型更新脚本', async () => {
  const config = { api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } };
  const agent = createPigAgent(config, { startLevel: 81, windowId: '0x123', navigation: {},
    fetchImpl: async () => { throw new Error('不应请求高层'); } });
  await assert.rejects(agent.run('游戏', 'update_script', ['example.js', 'x', 'changed']), /脚本更新未启用/);
});

test('工具批次交回中层后可安全续接且不重复发送系统说明', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pig-tool-handoff-'));
  try {
    const evidenceRoot = join(root, 'docs/references/pig-game/play-runs');
    const sessionDir = join(evidenceRoot, 'nav-level-81-handoff');
    const evidence = join(sessionDir, 'capture');
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, 'original.png'), 'image');
    const bridge = { async snapshot() { return { observation: { layout: { level: 81, pigs: [] } }, plans: [], gaps: [] }; } };
    const navigation = { sessionDir, async initialize() {}, async advance() { return { sessionDir, evidence, next: 'review', reason: '待复核' }; },
      async status() { return { sessionDir, evidence, next: 'review' }; } };
    const requests = [];
    const fetchImpl = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, async json() { return { id: `resp-${requests.length}`, status: 'completed',
        output_text: requests.length === 1 ? '[游戏,snapshot]' : '已确认' }; } };
    };
    const config = { api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } };
    const options = { startLevel: 81, windowId: '0x123', gameRoot: root, bridge, navigation, fetchImpl, activate: async () => {} };
    const first = createPigAgent(config, options);
    await first.runMiddle();
    const result = await first.chat('复核', { returnAfterToolBatch: true });
    assert.equal(result.results.length, 1);
    const ref = JSON.parse(await readFile(join(sessionDir, 'agent-session-ref.json'), 'utf8'));
    const saved = JSON.parse(await readFile(join(evidenceRoot, '.agent-sessions', ref.id + '.json'), 'utf8'));
    assert.equal(saved.pending, null);
    const second = createPigAgent(config, options);
    await second.chat('继续');
    assert.equal(requests[1].previous_response_id, 'resp-1');
    assert.equal(requests[1].instructions, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('模型通过受限 HIE 工具运行固定关卡并收到真实结果和截图', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-pig-'));
  try {
    const evidence = join(root, 'docs/references/pig-game/play-runs');
    await mkdir(evidence, { recursive: true });
    const calls = [];
    const bridge = {
      async capture(options) {
        calls.push(options);
        const dir = join(evidence, 'level-81-run-20261117-190000-000001');
        await mkdir(dir);
        await writeFile(join(dir, 'original.png'), Buffer.from('image'));
        return { evidence: dir, next: 'review', reason: '未复核', completed: false };
      },
      async snapshot(dir) { return { observation: { layout: { level: 81, count: 85, unknown_directions: 4 } }, plans: [], feedback: { status: 'blocked' }, gaps: [], evidence: { directory: dir } }; },
    };
    const requests = [];
    const replies = [
      '[游戏,run]',
      '[游戏,snapshot]',
      '已停止：识别未确认',
    ];
    const fetchImpl = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, async json() { return { id: 'resp-' + requests.length, status: 'completed', output_text: replies.shift() }; } };
    };
    const navigation = { advance: options => bridge.capture(options), status: async () => ({ next: 'review', completed: false }) };
    const agent = createPigAgent({ api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } }, { startLevel: 81, windowId: '0x123', gameRoot: root, bridge, navigation, fetchImpl, activate: async () => {} });
    const result = await agent.chat('开始游戏');
    assert.equal(result.results[0].result.feedback.status, 'blocked');
    assert.deepEqual(calls, [{ reviewedLayout: undefined }]);
    assert.equal(result.results[0].result.navigation.next, 'review');
    assert.equal(requests[1].previous_response_id, 'resp-1');
    assert.equal(requests[1].instructions, undefined);
    assert.equal(requests[1].input[0].content[1].type, 'input_image');
    assert.equal(requests[2].previous_response_id, 'resp-2');
    assert.equal(typeof requests[2].input, 'string');
    assert.match(result.text, /识别未确认/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('高层试探后收到前后图片并重新采集，不能复用旧会话', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-pig-probe-'));
  try {
    const image = Buffer.from('initial-image');
    const hash = createHash('sha256').update(image).digest('hex');
    let captures = 0;
    let probeCalls = 0;
    const bridge = {
      async run(options) {
        captures++;
        const dir = join(options.outputRoot, 'level-81-run-20261117-190000-000001');
        await mkdir(dir);
        await writeFile(join(dir, 'original.png'), image);
        await writeFile(join(dir, 'level.json'), JSON.stringify({ level: 81, board: [0, 0, 10, 10] }));
        await writeFile(join(dir, 'result.json'), JSON.stringify({ level: 81, status: 'inspection_only', clicks: 0, confirmed: 0 }));
        return { code: 0 };
      },
      async snapshot() { return { observation: { layout: { level: 81, board: [0, 0, 10, 10], pigs: [] } }, plans: [], feedback: {}, gaps: [] }; },
    };
    const replies = [
      '[游戏,run]',
      `[游戏,probe,${hash},5,5,观察物件,画面变化]`,
      '已观察一次',
    ];
    const requests = [];
    const fetchImpl = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, async json() { return { id: 'resp-' + requests.length, status: 'completed', output_text: replies.shift() }; } };
    };
    const probeRunner = async (_cmd, args) => {
      probeCalls++;
      const output = args[args.indexOf('--output') + 1];
      const request = JSON.parse(await readFile(join(output, 'request.json'), 'utf8'));
      assert.deepEqual(request.point, [5, 5]);
      await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'observed' }));
      await writeFile(join(output, 'comparison.png'), 'comparison');
    };
    const agent = createPigAgent({ api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } },
      { startLevel: 81, windowId: '0x123', gameRoot: root, bridge, fetchImpl, probeRunner, activate: async () => {} });
    const result = await agent.chat('开始');
    assert.equal(captures, 2);
    assert.notEqual(result.results[0].result.navigation.sessionDir, result.results[1].result.navigation.sessionDir);
    assert.equal(result.results[1].result.probe.status, 'observed');
    const repeated = await agent.run('游戏', 'probe', [hash, '5', '5', '复核相同目标', '避免重复点击']);
    assert.equal(repeated.probe.status, 'refused');
    assert.equal(probeCalls, 1);
    assert.equal(requests[2].input[0].content[1].type, 'input_image');
    const oldSession = result.results[0].result.navigation.sessionDir;
    const newSession = result.results[1].result.navigation.sessionDir;
    const oldRef = JSON.parse(await readFile(join(oldSession, 'agent-session-ref.json'), 'utf8'));
    const newRef = JSON.parse(await readFile(join(newSession, 'agent-session-ref.json'), 'utf8'));
    assert.equal(oldRef.id, newRef.id);
    let resumed;
    const nextAgent = createPigAgent({ api: { baseUrl: 'http://localhost/v1', apiKey: 'test', model: 'gemini-flash', timeoutMs: 1000 } },
      { startLevel: 81, windowId: '0x123', gameRoot: root, bridge, sessionDir: newSession, activate: async () => {},
        fetchImpl: async (_url, options) => { resumed = JSON.parse(options.body); return { ok: true, async json() { return { id: 'resp-4', status: 'completed', output_text: '继续调查' }; } }; } });
    assert.equal((await nextAgent.chat('继续')).text, '继续调查');
    assert.equal(resumed.previous_response_id, 'resp-3');
    assert.equal(resumed.instructions, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
