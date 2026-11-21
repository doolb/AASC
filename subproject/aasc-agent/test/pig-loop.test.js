import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pigGapFingerprint, projectPigResults, runPigLoop } from '../src/pig-loop.js';

const gap = () => ({ source_sha256: 'abc', imageDataUrl: 'data:image/png;base64,YQ==',
  navigation: { next: 'review', reason: '未知物件' } });

test('中层完成或 plan-only 计划就绪时不调用高层', async () => {
  for (const state of [{ completed: true }, { next: 'execute' }]) {
    let calls = 0;
    await runPigLoop({ async runMiddle() { return { navigation: state }; }, async chat() { calls++; } }, 81, { planOnly: true });
    assert.equal(calls, 0);
  }
});

test('本地阶段不确定或 plan-only 禁止执行时不调用高层', async () => {
  for (const state of [{ executionUncertain: true }, { executionDisabled: true }]) {
    let calls = 0;
    await runPigLoop({ async runMiddle() { return { ...gap(), navigation: state }; }, async chat() { calls++; } }, 81, { planOnly: true });
    assert.equal(calls, 0);
  }
});

test('相同缺口无新进展时只请求一次高层', async () => {
  const claimed = new Set(), statuses = []; let calls = 0;
  const agent = { async runMiddle() { return gap(); }, async claimGap(key) {
    if (claimed.has(key)) return false; claimed.add(key); return true;
  }, async finishGap(_, status) { statuses.push(status); },
  async chat() { calls++; return { text: '只有建议', results: [] }; } };
  const result = await runPigLoop(agent, 81, { maxRounds: 3, wait: async () => {} });
  assert.match(result.text, /停止重复请求/);
  assert.equal(calls, 1);
  assert.deepEqual(statuses, ['requested', 'unresolved']);
});

test('高层完成工具批次后先由中层处理，观察不等于确认进展', async () => {
  const order = [], statuses = [];
  const agent = { async runMiddle() {
    order.push('middle'); return order.filter(x => x === 'middle').length === 1 ? gap() : { navigation: { completed: true } };
  }, async finishGap(_, status) { statuses.push(status); },
  async chat(_, options) {
    order.push('model'); assert.equal(options.returnAfterToolBatch, true);
    return { text: '试探', results: [{ result: { probe: { status: 'observed' } } }] };
  } };
  await runPigLoop(agent, 81, { maxRounds: 3, wait: async () => {} });
  assert.deepEqual(order, ['middle', 'model', 'middle']);
  assert.deepEqual(statuses, ['requested', 'unresolved']);
});

test('同一缺口先交回中层，再将工具结果反馈高层继续调查', async () => {
  const order = [], claimed = new Set(); let calls = 0;
  const agent = { async runMiddle() {
    order.push('middle'); return calls >= 2 ? { navigation: { completed: true } } : gap();
  }, async claimGap(key) { if (claimed.has(key)) return false; claimed.add(key); return true; },
  async chat(_message, options) {
    order.push('model'); calls++;
    if (calls === 1) return { text: '读取脚本列表', results: [{ role: '游戏', result: { scripts: ['pig.js'] } }] };
    assert.deepEqual(options.initialToolResults[0].result.scripts, ['pig.js']);
    assert.equal(options.initialToolResults[1].result.source_sha256, 'abc');
    return { text: '复核布局', results: [{ role: '游戏', result: { checked: true } }] };
  } };
  await runPigLoop(agent, 112, { wait: async () => {}, maxRounds: 4 });
  assert.deepEqual(order, ['middle', 'model', 'middle', 'model', 'middle']);
});

test('相同工具结果不反复发送高层，新的结果也受到调查轮数限制', async () => {
  for (const varying of [false, true]) {
    let calls = 0;
    const claimed = new Set();
    const agent = { async runMiddle() { return gap(); },
      async claimGap(key) { if (claimed.has(key)) return false; claimed.add(key); return true; },
      async chat() { calls++; return { text: '读取', results: [{ result: { scripts: [varying ? String(calls) : 'same'] } }] }; } };
    const result = await runPigLoop(agent, 112, { maxGapFollowups: 2, maxRounds: 8, wait: async () => {} });
    assert.match(result.text, /停止重复请求/);
    assert.equal(calls, varying ? 3 : 2);
  }
});

test('提示词和现场证据在需要高层时一起发送，高层返回后交还中层', async () => {
  let middleCalls = 0, calls = 0;
  const agent = { async runMiddle() { middleCalls++; return middleCalls === 1 ? gap() : { navigation: { completed: true } }; },
    async chat(message, options) {
      calls++;
      assert.match(message, /请复核大象占位/);
      assert.equal(options.initialToolResults[0].result.imageDataUrl, gap().imageDataUrl);
      return { text: '调查', results: [{ result: { checked: true } }] };
    } };
  await runPigLoop(agent, 112, { prompt: '请复核大象占位', wait: async () => {} });
  assert.equal(calls, 1);
  assert.equal(middleCalls, 2);
});

test('会话未完成时先停止，不能因为缺口去重掩盖错误或执行中层动作', async () => {
  let actions = 0, calls = 0;
  const agent = { async inspectSession() { return { uncertain: true, reason: '上次模型请求未完成' }; },
    async runMiddle() { actions++; return gap(); }, async chat() { calls++; } };
  const result = await runPigLoop(agent, 112, { retryGap: true });
  assert.match(result.text, /会话状态不确定/);
  assert.equal(actions, 0);
  assert.equal(calls, 0);
});

test('无进展缺口报告未解决，明确重试才重新交给高层', async () => {
  let calls = 0;
  const agent = { async runMiddle() { return gap(); }, async claimGap() { return false; },
    async gapStatus() { return 'unresolved'; }, async chat() { calls++; return { text: '建议', results: [] }; } };
  const stopped = await runPigLoop(agent, 112, { wait: async () => {}, maxRounds: 1 });
  assert.match(stopped.text, /高层已响应，但缺口仍未解决/);
  assert.equal(calls, 0);
  await runPigLoop(agent, 112, { retryGap: true, wait: async () => {}, maxRounds: 1 });
  assert.equal(calls, 1);
});

test('首次模型请求中断后检查持久会话，停止并报告不确定', async () => {
  let pending = false, middleCalls = 0, calls = 0;
  const agent = { async inspectSession() { return { uncertain: pending, reason: '请求未完成' }; },
    async runMiddle() { middleCalls++; return gap(); },
    async chat() { calls++; pending = true; throw new Error('连接断开'); } };
  const result = await runPigLoop(agent, 112, { wait: async () => {}, maxRounds: 3 });
  assert.match(result.text, /状态不确定/);
  assert.equal(middleCalls, 1);
  assert.equal(calls, 1);
});

test('候选位置稳定时截图动画不产生新缺口，实际棋子变化产生新缺口', () => {
  const first = { ...gap(), observation: { pigs: [{ center: [100, 200], bbox: [90, 190, 20, 40], direction: 'north' }] } };
  const animation = { ...first, source_sha256: 'new-image', observation: { pigs: [{ center: [101, 200], bbox: [91, 190, 20, 40], direction: 'north' }] } };
  const moved = { ...animation, observation: { pigs: [{ center: [120, 200], bbox: [110, 190, 20, 40], direction: 'north' }] } };
  assert.equal(pigGapFingerprint(81, first), pigGapFingerprint(81, animation));
  assert.notEqual(pigGapFingerprint(81, first), pigGapFingerprint(81, moved));
});

test('模型续接状态不确定时停止，不重复请求或点击', async () => {
  let calls = 0, waits = 0;
  const agent = { async runMiddle() { return gap(); }, async chat() {
    calls++; throw new Error('上次模型请求或工具执行未完成，会话状态不确定');
  } };
  const result = await runPigLoop(agent, 81, { maxRounds: 5, wait: async () => { waits++; } });
  assert.match(result.text, /已停止/);
  assert.equal(calls, 1);
  assert.equal(waits, 0);
});

test('压缩发送给高层的候选，保留图片与所有字段', () => {
  const input = [{ role: '游戏', result: { imageDataUrl: 'data:image/png;base64,YQ==', source_sha256: 'abc',
    navigation: { level: 81, reason: '待复核', next: 'review', goal: { huge: true } },
    observation: { pigs: [{ id: 1, center: [1, 2], bbox: [0, 0, 3, 4], direction: 'east', confidence: 'medium' }], other_entities: [] } } }];
  const result = projectPigResults(input)[0].result;
  assert.equal(result.imageDataUrl, input[0].result.imageDataUrl);
  assert.deepEqual(result.observation.pigs[0], [1, [1, 2], [0, 0, 3, 4], 'east', 'medium']);
  assert.equal(result.navigation.goal, undefined);
  assert.equal(input[0].result.observation.pigs[0].id, 1);
});
