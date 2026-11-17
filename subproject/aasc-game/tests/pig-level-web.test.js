const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const level = require('../web/pig-level/level-48.json');
const level40 = require('../web/pig-level/level-40.json');
const engine = import('../web/pig-level/engine.mjs');
const supportedLevels = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70];

for (const levelId of supportedLevels) {
    test(`第${levelId}关网页数据可独立重放`, async () => {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../web/pig-level/level-${levelId}.json`), 'utf8'));
        const { verifyPlan } = await engine;
        assert.equal(verifyPlan(data), true);
        if (data.evidence) assert.equal(data.evidence.status, 'victory_verified');
        else assert.ok([40, 48].includes(levelId));
    });
}

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

test('铁笼计数归零后释放笼内小猪，快照可恢复', async () => {
    const { createState, cloneState, movePig } = await engine;
    const board = { columns: 4, rows: 2, pigs: [
        { id: 1, x: 0, y: 0, length: 1, direction: 'west', kind: 'normal' },
        { id: 2, x: 1, y: 1, length: 1, direction: 'east', kind: 'normal' }
    ], cages: [{ unlockAfter: 1, cells: [[1, 1]] }] };
    const before = createState(board);
    const saved = cloneState(before);
    assert.equal(movePig(board, before, 2).ok, false);
    const opened = movePig(board, before, 1);
    assert.equal(opened.state.exitCount, 1);
    assert.equal(movePig(board, opened.state, 2).ok, true);
    assert.equal(movePig(board, saved, 2).ok, false);
});

test('第59关锁猪与铁笼在各自计数达到后才释放', async () => {
    const level59 = require('../web/pig-level/level-59.json');
    const { createState, movePig } = await engine;
    let state = createState(level59);
    const cage = level59.cages[0];
    const cageCell = new Set(cage.cells.map(cell => cell.join(',')));
    const inside = level59.pigs.find(pig => cageCell.has([pig.x, pig.y].join(',')) && pig.kind !== 'lock');
    const lock = level59.pigs.find(pig => pig.kind === 'lock' && pig.unlockAfter === 60);
    assert.ok(inside && lock);
    assert.equal(movePig(level59, state, inside.id).ok, false);
    assert.equal(movePig(level59, state, lock.id).ok, false);
    for (const step of level59.steps) {
        if (state.exitCount < lock.unlockAfter) assert.equal(movePig(level59, state, lock.id).ok, false);
        const result = movePig(level59, state, step.id);
        assert.equal(result.ok, true);
        state = result.state;
    }
    assert.equal(state.exitCount, 86);
});

test('鸭子被包围时阻挡，打开通路后离场，撤回保留原状态', async () => {
    const { createState, movePig } = await engine;
    const board = { columns: 3, rows: 3, ducks: [[1, 1]], pigs: [
        { id: 1, x: 1, y: 0, length: 1, direction: 'north' },
        { id: 2, x: 0, y: 1, length: 1, direction: 'west' },
        { id: 3, x: 2, y: 1, length: 1, direction: 'east' },
        { id: 4, x: 1, y: 2, length: 1, direction: 'south' }
    ] };
    const state = createState(board);
    assert.deepEqual(state.ducks, [[1, 1]]);
    const result = movePig(board, state, 1);
    assert.deepEqual(result.state.ducks, []);
    assert.deepEqual(state.ducks, [[1, 1]]);
});

test('小象整个前沿均须畅通才能移动', async () => {
    const { createState, movePig } = await engine;
    const board = { columns: 5, rows: 3, pigs: [
        { id: 1, x: 0, y: 0, length: 2, width: 2, direction: 'east', kind: 'elephant' },
        { id: 2, x: 2, y: 1, length: 1, direction: 'east' }
    ] };
    assert.equal(movePig(board, createState(board), 1).ok, false);
});
