'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { genId, validateName, roleTemplate, buildPrompt } = require('../tools/wg-core.js');

test('genId 生成 YYYYMMDD-HHMM-SEQ 格式', () => {
    const now = new Date(2026, 7, 17, 15, 30); // 2026-08-17 15:30
    assert.strictEqual(genId(now, 1), '20260817-1530-001');
    assert.strictEqual(genId(now, 42), '20260817-1530-042');
});

test('validateName 拒绝空/路径分隔符', () => {
    assert.strictEqual(validateName(''), '名字不能为空');
    assert.strictEqual(validateName('  '), '名字不能为空');
    assert.strictEqual(validateName('a/b'), '名字不能包含路径分隔符');
    assert.strictEqual(validateName('frontend'), null);
});

test('roleTemplate 生成角色模板骨架', () => {
    const t = roleTemplate('voice');
    assert.ok(t.includes('# 角色：voice'));
    assert.ok(t.includes('职责'));
    assert.ok(t.includes('负责目录'));
    assert.ok(t.includes('工作规范'));
});

test('buildPrompt 包含角色/成员/总结/任务与结果路径', () => {
    const p = buildPrompt({
        role: 'frontend', name: 'alice',
        summary: '擅长UI',
        taskFile: '/t.json', resultFile: '/r.json'
    });
    assert.ok(p.includes('frontend'));
    assert.ok(p.includes('alice'));
    assert.ok(p.includes('擅长UI'));
    assert.ok(p.includes('/t.json'));
    assert.ok(p.includes('/r.json'));
    assert.ok(p.includes('learnings'));
});

const { parseHistory, updateHistory, buildSummary, MAX_LEARNINGS, MAX_RECORDS } = require('../tools/wg-core.js');

test('parseHistory 解析空文本返回空结构', () => {
    const h = parseHistory('');
    assert.deepStrictEqual(h.profile, {});
    assert.deepStrictEqual(h.learnings, []);
    assert.deepStrictEqual(h.records, []);
});

test('parseHistory 解析已有三段内容', () => {
    const text = [
        '# 专长画像', '{"frontend": 3, "UI": 2}',
        '', '## 经验约定', '- 同步 spec 文档',
        '', '## 最近记录', '- {"id":"x","title":"t","tags":["frontend"],"at":1}'
    ].join('\n');
    const h = parseHistory(text);
    assert.strictEqual(h.profile.frontend, 3);
    assert.deepStrictEqual(h.learnings, ['同步 spec 文档']);
    assert.strictEqual(h.records.length, 1);
    assert.strictEqual(h.records[0].id, 'x');
});

test('updateHistory 累加专长画像并追加记录', () => {
    const out = updateHistory('', {
        tags: ['frontend', 'UI'],
        learnings: ['约定A'],
        record: { id: 'a', title: 't', tags: ['frontend'], at: 1 }
    });
    const h = parseHistory(out);
    assert.strictEqual(h.profile.frontend, 1);
    assert.strictEqual(h.profile.UI, 1);
    assert.strictEqual(h.learnings.length, 1);
    assert.strictEqual(h.records.length, 1);
});

test('updateHistory learnings 去重且超限删最旧', () => {
    let text = '';
    for (let i = 0; i < MAX_LEARNINGS; i++) {
        text = updateHistory(text, { tags: [], learnings: [`约定${i}`], record: null });
    }
    text = updateHistory(text, { tags: [], learnings: ['约定0'], record: null }); // 重复不追加
    let h = parseHistory(text);
    assert.strictEqual(h.learnings.length, MAX_LEARNINGS);
    text = updateHistory(text, { tags: [], learnings: ['新约定'], record: null });
    h = parseHistory(text);
    assert.strictEqual(h.learnings.length, MAX_LEARNINGS);
    assert.ok(!h.learnings.includes('约定0'));
    assert.ok(h.learnings.includes('新约定'));
});

test('updateHistory records 超限删最旧', () => {
    let text = '';
    for (let i = 0; i < MAX_RECORDS + 2; i++) {
        text = updateHistory(text, { tags: [], learnings: [], record: { id: `r${i}`, title: 't', tags: [], at: i } });
    }
    const h = parseHistory(text);
    assert.strictEqual(h.records.length, MAX_RECORDS);
    assert.strictEqual(h.records[0].id, 'r2'); // r0、r1 被删
});

test('buildSummary 提取专长画像与经验约定，不含最近记录', () => {
    const text = [
        '# 专长画像', '{"frontend": 3}',
        '', '## 经验约定', '- 同步 spec',
        '', '## 最近记录', '- {"id":"x","title":"旧任务"}'
    ].join('\n');
    const s = buildSummary(text);
    assert.ok(s.includes('frontend'));
    assert.ok(s.includes('同步 spec'));
    assert.ok(!s.includes('最近记录'));
    assert.ok(!s.includes('旧任务'));
});
