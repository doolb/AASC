'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const task = require('./search');
const registry = require('./registry');

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

function createSearchHtml() {
    return `
        <ul id="b_results">
            <li class="b_ans"><a>不是网页结果</a></li>
            <li class="b_algo">
                <h2><a href="https://example.test/old">旧页面</a></h2>
                <div class="b_caption"><p>2026年8月21日 · 旧摘要</p></div>
            </li>
            <li class="b_algo">
                <h2><a href="https://example.test/latest">最新页面</a></h2>
                <div class="b_caption"><p>Aug 29, 2026 · 最新摘要</p></div>
            </li>
            <li class="b_algo">
                <h2><a href="https://example.test/relative">相对日期页面</a></h2>
                <div class="b_caption"><p>2天前 · 相对日期摘要</p></div>
            </li>
            <li class="b_algo"><h2><a href="https://example.test/27">27日页面</a></h2><div class="b_caption"><p>2026-08-27 · 摘要</p></div></li>
            <li class="b_algo"><h2><a href="https://example.test/26">26日页面</a></h2><div class="b_caption"><p>2026-08-26 · 摘要</p></div></li>
            <li class="b_algo"><h2><a href="https://example.test/25">25日页面</a></h2><div class="b_caption"><p>2026-08-25 · 摘要</p></div></li>
            <li class="b_algo"><h2><a href="https://example.test/24">24日页面</a></h2><div class="b_caption"><p>2026-08-24 · 摘要</p></div></li>
            <li class="b_algo"><h2><a href="https://example.test/23">23日页面</a></h2><div class="b_caption"><p>2026-08-23 · 摘要</p></div></li>
            <li class="b_algo"><h2><a href="https://example.test/22">22日页面</a></h2><div class="b_caption"><p>2026-08-22 · 摘要</p></div></li>
            <li class="b_algo"><h2><a href="https://example.test/20">20日页面</a></h2><div class="b_caption"><p>2026-08-20 · 摘要</p></div></li>
            <li class="b_algo">
                <h2><a href="https://example.test/outside">第四条不应参与</a></h2>
                <div class="b_caption"><p>2026年8月30日 · 不应参与</p></div>
            </li>
        </ul>
    `;
}

test('search.web 注册为可手动调用的单次内置任务', () => {
    assert.equal(registry.getTask('search.web'), task);
    assert.equal(task.mode, 'one-shot');
    assert.equal(task.target, 'server');
    assert.equal(task.params.some((item) => item.name === 'query'), true);
    assert.deepEqual(
        task.params.filter((item) => item.globalOnly).map((item) => item.name),
        ['fetchLimit', 'displayLimit', 'ttsLimit']
    );
});

test('search.web 搜索前十条并返回日期最新的前五条', async () => {
    const result = await task.run({
        params: { query: '黄金' },
        now: NOW,
        fetchHtml: async (query) => {
            assert.equal(query, '黄金');
            return createSearchHtml();
        }
    });

    assert.equal(result.success, true);
    assert.equal(result.data.result.length, 5);
    assert.deepEqual(result.data.result.map(item => item.title), [
        '最新页面', '相对日期页面', '27日页面', '26日页面', '25日页面'
    ]);
});

test('search.web 结果都无日期时按 Bing 顺序返回', async () => {
    const result = await task.run({
        params: { query: '无日期' },
        now: NOW,
        fetchHtml: async () => `
            <ul id="b_results">
                <li class="b_algo"><h2><a href="/first">第一条</a></h2><div class="b_caption"><p>无日期</p></div></li>
                <li class="b_algo"><h2><a href="/second">第二条</a></h2><div class="b_caption"><p>暂无时间</p></div></li>
                <li class="b_algo"><h2><a href="/third">第三条</a></h2><div class="b_caption"><p>没有日期</p></div></li>
            </ul>
        `
    });

    assert.equal(result.data.result.length, 3);
    assert.deepEqual(result.data.result.map(item => item.title), ['第一条', '第二条', '第三条']);
});

test('search.web 日期解析支持绝对日期、相对日期和未知日期', () => {
    assert.equal(task.parseBingResultDate('2026年8月21日', NOW), Date.UTC(2026, 7, 21));
    assert.equal(task.parseBingResultDate('Aug 29, 2026', NOW), Date.UTC(2026, 7, 29));
    assert.equal(task.parseBingResultDate('1天前', NOW), NOW - 24 * 60 * 60 * 1000);
    assert.equal(task.parseBingResultDate('1 day ago', NOW), NOW - 24 * 60 * 60 * 1000);
    assert.equal(task.parseBingResultDate('没有日期', NOW), null);
});

test('search.web 从无实例的任务全局配置读取数量限制', async () => {
    const result = await task.run({
        taskName: 'search.web',
        params: { query: '黄金' },
        taskIO: {
            async getTaskConfig(taskName) {
                assert.equal(taskName, 'search.web');
                return { fetchLimit: 4, displayLimit: 2, ttsLimit: 1 };
            }
        },
        fetchHtml: async () => createSearchHtml(),
        now: NOW
    });

    assert.deepEqual(result.data.result.map(item => item.title), ['最新页面', '相对日期页面']);
});

console.log('search.test.js: 5/5 passed');
