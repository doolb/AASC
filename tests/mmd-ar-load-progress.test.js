'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

async function fixture() {
    const { createLoadProgressView } = await import('../3rd/mmd-ar-test/web-local-assets-ui.mjs');
    const attributes = new Map();
    const progress = { hidden: true, dataset: {},
        setAttribute: (key, value) => attributes.set(key, value),
        removeAttribute: (key) => attributes.delete(key) };
    const text = { textContent: '' }, fill = { style: {} }, timers = [];
    const view = createLoadProgressView({ progress, text, fill,
        schedule: (fn, delay) => { timers.push({ fn, delay, canceled: false }); return timers.length - 1; },
        cancel: (id) => { timers[id].canceled = true; } });
    return { view, progress, text, fill, attributes, timers };
}

test('开始立即可见，不定进度不伪造百分比，读取比例单调且只有提交成功达到100%', async () => {
    const { view, progress, text, attributes, timers } = await fixture();
    const token = view.begin('读取VMD');
    assert.equal(progress.hidden, false);
    assert.equal(progress.dataset.indeterminate, 'true');
    assert.equal(attributes.has('aria-valuenow'), false);
    assert.equal(text.textContent, '读取VMD');
    view.update(token, { phase: '读取VMD', percent: 70 });
    view.update(token, { phase: '贴图', percent: 30 });
    assert.equal(attributes.get('aria-valuenow'), '70');
    view.update(token, { phase: '应用动作', percent: 100 });
    assert.equal(attributes.get('aria-valuenow'), '99');
    view.update(token, { phase: '初始化物理', indeterminate: true });
    assert.equal(attributes.has('aria-valuenow'), false);
    assert.equal(text.textContent, '初始化物理');
    view.finish(token, '加载完成');
    assert.equal(attributes.get('aria-valuenow'), '100');
    assert.equal(progress.dataset.state, 'complete');
    assert.equal(timers[0].delay, 1500);
    timers[0].fn();
    assert.equal(progress.hidden, true);
});

test('新的加载隔离旧回调与旧收起定时器，完成后的迟到消息不覆盖结果', async () => {
    const { view, progress, text, timers } = await fixture();
    const old = view.begin('旧模型');
    view.finish(old, '旧模型完成');
    const current = view.begin('新动作');
    assert.equal(timers[0].canceled, true);
    timers[0].fn();
    assert.equal(progress.hidden, false);
    assert.equal(view.update(old, { phase: '旧物理', percent: 95 }), false);
    assert.equal(text.textContent, '新动作');
    view.finish(current, '新动作完成');
    assert.equal(view.update(current, { error: '迟到的旧错误' }), false);
    assert.equal(progress.dataset.state, 'complete');
});

test('失败终止进度并保留原因，不显示100%或成功定时器；重新开始可恢复', async () => {
    const { view, progress, text, attributes, timers } = await fixture();
    const token = view.begin('读取模型');
    view.update(token, { phase: '贴图', percent: 80 });
    view.update(token, { error: '缺少贴图a.png' });
    assert.equal(text.textContent, '加载失败：缺少贴图a.png');
    assert.equal(progress.dataset.state, 'error');
    assert.equal(attributes.has('aria-valuenow'), false);
    assert.equal(view.finish(token, '加载完成'), false);
    assert.equal(timers.length, 0);
    view.begin('重试');
    assert.equal(progress.dataset.state, 'loading');
});

test('多PMX等待选择结束文件检查，不宣称模型加载完成', async () => {
    const { view, progress, text, attributes } = await fixture();
    const token = view.begin('检查目录');
    view.finish(token, '找到2个PMX，请选择模型', true);
    assert.equal(progress.dataset.state, 'waiting');
    assert.equal(text.textContent, '找到2个PMX，请选择模型');
    assert.equal(attributes.has('aria-valuenow'), false);
});
