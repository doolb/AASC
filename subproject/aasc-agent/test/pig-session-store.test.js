import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PigSessionStore } from '../src/pig-session-store.js';

test('续接点跨导航会话保存；并发或未完成状态不能盲目续接', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pig-store-'));
  try {
    const first = join(root, 'first');
    const second = join(root, 'second');
    await mkdir(first); await mkdir(second);
    let directory = first;
    const api = { baseUrl: 'http://localhost/v1', model: 'gemini', apiKey: 'secret' };
    const create = () => new PigSessionStore({ getDirectory: async () => directory, evidenceRoot: root, api });
    const store = create();
    assert.equal(await store.load(), null);
    await store.save({ heads: { 主管: 'resp-1' }, uncertain: [], pending: null });
    directory = second;
    await store.save({ heads: { 主管: 'resp-2' }, uncertain: [], pending: null });
    const resumed = create();
    assert.equal((await resumed.load()).heads.主管, 'resp-2');
    await store.save({ heads: { 主管: 'resp-2' }, uncertain: [], pending: { type: 'tool' } });
    assert.deepEqual(await create().inspect(), { uncertain: true, reason: '上次模型请求或工具执行未完成' });
    await assert.rejects(resumed.save({ heads: {}, uncertain: [], pending: null }), /其他进程修改/);
    await assert.rejects(create().load(), /未完成/);
    const fresh = new PigSessionStore({ getDirectory: async () => directory, evidenceRoot: root, api, newConversation: true });
    assert.equal(await fresh.load(), null);
    await fresh.save({ heads: { 主管: 'resp-new' }, uncertain: [], pending: null });
    assert.equal((await create().load()).heads.主管, 'resp-new');
  } finally { await rm(root, { recursive: true, force: true }); }
});
