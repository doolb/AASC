'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCategoryName } = require('../src/apps/server/modules/media/download-path');

test('分类名清洗路径分隔符、控制字符与空白', () => {
    assert.equal(sanitizeCategoryName(' 课程 / 2026 '), '课程 _ 2026');
    assert.equal(sanitizeCategoryName('a\\b'), 'a_b');
    assert.equal(sanitizeCategoryName('a\u0000b'), 'a_b');
    assert.equal(sanitizeCategoryName('  多个   空格  '), '多个 空格');
});

test('空值与点目录回退为未分类', () => {
    assert.equal(sanitizeCategoryName(''), '未分类');
    assert.equal(sanitizeCategoryName('   '), '未分类');
    assert.equal(sanitizeCategoryName('.'), '未分类');
    assert.equal(sanitizeCategoryName('..'), '未分类');
    assert.equal(sanitizeCategoryName(null), '未分类');
    assert.equal(sanitizeCategoryName(undefined), '未分类');
});

test('分类名截断到 50 字，路径穿越残留不会被当作目录层级', () => {
    assert.equal(sanitizeCategoryName('a'.repeat(80)).length, 50);
    assert.equal(sanitizeCategoryName('../../etc'), '.._.._etc');
    assert.equal(sanitizeCategoryName('/'), '_');
});
