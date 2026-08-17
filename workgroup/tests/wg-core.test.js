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
