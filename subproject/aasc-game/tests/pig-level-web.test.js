'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const level = require('../web/pig-level/level-48.json');
const level40 = require('../web/pig-level/level-40.json');
const engine = import('../web/pig-level/engine.mjs');

test('完整步骤独立重放并在解绳前阻止绳猪', async () => {
    const { createState, movePig, verifyPlan } = await engine;
    assert.equal(verifyPlan(level), true);
    let state = createState(level);
    const rope = level.pigs.find(pig => pig.kind === 'rope');
    assert.equal(movePig(level, state, rope.id).ok, false);
    let scissorsExited = 0;
    for (const step of level.steps) {
        const pig = state.pigs.find(item => item.id === step.id);
        if (pig.kind === 'rope') assert.equal(state.remainingScissors, 0);
        const result = movePig(level, state, step.id);
        assert.equal(result.ok, true);
        state = result.state;
        if (pig.kind === 'scissors' && result.action.exited) {
            scissorsExited += 1;
            assert.equal(state.remainingScissors, 3 - scissorsExited);
        }
    }
    assert.equal(scissorsExited, 3);
    assert.ok(state.pigs.every(pig => pig.gone));
});

test('阻挡、滑动和撤回快照相互独立', async () => {
    const { createState, cloneState, movePig } = await engine;
    const small = { columns: 6, rows: 2, pigs: [
        { id: 1, x: 0, y: 0, length: 2, direction: 'east', kind: 'normal' },
        { id: 2, x: 4, y: 0, length: 2, direction: 'west', kind: 'normal' }
    ] };
    const original = createState(small);
    const saved = cloneState(original);
    const moved = movePig(small, original, 1);
    assert.deepEqual(moved.action.to, [2, 0]);
    assert.equal(movePig(small, moved.state, 1).ok, false);
    assert.deepEqual(saved, original);
    assert.deepEqual(saved.pigs[0].x, 0);
});

test('篡改候选步骤会被拒绝', async () => {
    const { verifyPlan } = await engine;
    const changed = { ...level, steps: level.steps.map(step => ({ ...step })) };
    changed.steps[0] = { ...changed.steps[0], to: [0, 0], exited: false };
    assert.throws(() => verifyPlan(changed), /第 1 步/);
});


test('第40关完整重放，计数锁在30只离场后解开', async () => {
    const { createState, movePig, verifyPlan } = await engine;
    assert.equal(verifyPlan(level40), true);
    let state = createState(level40);
    const lock = level40.pigs.find(pig => pig.kind === 'lock');
    assert.equal(movePig(level40, state, lock.id).ok, false);
    let beforeUnlock;
    for (const step of level40.steps) {
        const result = movePig(level40, state, step.id);
        assert.equal(result.ok, true);
        if (state.exitCount === 29 && result.state.exitCount === 30) beforeUnlock = state;
        state = result.state;
    }
    assert.ok(beforeUnlock);
    assert.equal(movePig(level40, beforeUnlock, lock.id).ok, false);
    assert.ok(state.pigs.every(pig => pig.gone));
});
