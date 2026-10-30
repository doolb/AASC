'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../3rd/imu-six-axis-test/imu-trail.mjs');
const point = (x, time, speed = 1, status = 'tracking') => ({ position: [x, 0, 0], time, velocity: [speed, 0, 0], status });

test('可见轨迹兼容旧XYZ空值，新点深拷贝及非法字段整批拒绝', async () => {
    const { normalizeEstimatedTrail: normalize } = await modulePromise;
    const raw = point(1, 2), original = structuredClone(raw);
    const result = normalize([[0, 0, 0], { ...raw, ignored: true }]);
    assert.deepEqual(result, [{ position: [0, 0, 0], time: null, velocity: null, status: null }, original]);
    result[1].position[0] = 99; result[1].velocity[0] = 88;
    assert.deepEqual(raw, original);
    for (const bad of [{ position: [1, 2] }, { position: [Infinity, 0, 0] }, { time: -1 }, { time: NaN },
        { time: 1e9 }, { time: '2' }, { velocity: [0, 1] }, { velocity: [10001, 0, 0] },
        { status: 'unknown' }, { status: 1 }]) {
        assert.equal(normalize([raw, { ...raw, ...bad }]), null);
    }
    assert.equal(normalize(Array.from({ length: 601 }, () => raw)), null);
    assert.deepEqual(normalize([]), []);
});

test('停止/暂停/恢复各保留一次端点，重复暂停及时间推进不挤掉运动记录', async () => {
    const { appendEstimatedTrail: append } = await modulePromise;
    const trail = [];
    append(trail, [point(0, 0), point(.03, .02), point(.03, .04, 0), point(.03, .04, 0, 'paused')]);
    assert.equal(trail.length, 4);
    for (let i = 0; i < 1000; i += 1) append(trail, [point(.03, 1 + i * .02, 0, 'paused')]);
    assert.equal(trail.length, 4);
    assert.deepEqual(trail[0], point(0, 0));
    append(trail, [point(.03, 22, 0), point(.03, 22.02, 1)]);
    assert.equal(trail.length, 6);
    assert.equal(trail[4].status, 'tracking'); assert.deepEqual(trail[5].velocity, [1, 0, 0]);
});

test('600点滚动时坐标/时间/速度一致，不持有输入对象引用', async () => {
    const { appendEstimatedTrail: append } = await modulePromise;
    const trail = [], inputs = Array.from({ length: 650 }, (_, i) => point(i * .03, i * .02, i + 1));
    append(trail, inputs);
    assert.equal(trail.length, 600); assert.deepEqual(trail[0], inputs[50]); assert.deepEqual(trail.at(-1), inputs.at(-1));
    inputs[649].velocity[0] = 0; assert.equal(trail.at(-1).velocity[0], 650);
});
