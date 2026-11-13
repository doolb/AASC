// 棋盘状态与界面分离，所有点击、回放和撤回共用同一套规则。
const VECTORS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export function createState(level) {
    return { exitCount: 0, pigs: level.pigs.map(pig => ({ ...pig, gone: false })), remainingScissors: level.pigs.filter(pig => pig.kind === 'scissors').length };
}

export function cloneState(state) {
    return { exitCount: state.exitCount, pigs: state.pigs.map(pig => ({ ...pig })), remainingScissors: state.remainingScissors };
}

function cells(pig) {
    return Array.from({ length: pig.length }, (_, offset) => [pig.x + (pig.direction === 'east' || pig.direction === 'west' ? offset : 0), pig.y + (pig.direction === 'north' || pig.direction === 'south' ? offset : 0)]);
}

export function movePig(level, state, id) {
    const next = cloneState(state);
    const pig = next.pigs.find(item => item.id === id);
    if (!pig || pig.gone) return { ok: false, message: '这只小猪已经离开' };
    if (pig.kind === 'lock' && next.exitCount < pig.unlockAfter) return { ok: false, message: `锁还剩 ${pig.unlockAfter - next.exitCount}，先送走其他猪` };
    if (pig.kind === 'rope' && next.remainingScissors > 0) return { ok: false, message: `绳子还剩 ${next.remainingScissors} 根，先送走剪刀猪` };
    const occupied = new Set(next.pigs.filter(item => !item.gone && item.id !== id).flatMap(cells).map(([x, y]) => `${x},${y}`));
    const vector = VECTORS[pig.direction];
    if (!vector) return { ok: false, message: '小猪朝向无效' };
    const [dx, dy] = vector;
    const from = [pig.x, pig.y];
    let distance = 0;
    // 沿朝向前进至最近的障碍；头部越过棋盘则整只猪离场。
    while (true) {
        const headX = pig.x + (dx > 0 ? pig.length - 1 : 0) + dx;
        const headY = pig.y + (dy > 0 ? pig.length - 1 : 0) + dy;
        if (headX < 0 || headY < 0 || headX >= level.columns || headY >= level.rows) {
            pig.gone = true;
            next.exitCount += 1;
            if (pig.kind === 'scissors') next.remainingScissors -= 1;
            return { ok: true, state: next, action: { id, from, to: null, exited: true }, won: next.pigs.every(item => item.gone) };
        }
        if (occupied.has(`${headX},${headY}`)) {
            if (!distance) return { ok: false, message: '前方有阻挡' };
            return { ok: true, state: next, action: { id, from, to: [pig.x, pig.y], exited: false }, won: false };
        }
        pig.x += dx;
        pig.y += dy;
        distance += 1;
    }
}

export function sameAction(a, b) {
    return a.id === b.id && a.exited === b.exited && JSON.stringify(a.from) === JSON.stringify(b.from) && JSON.stringify(a.to) === JSON.stringify(b.to);
}

export function verifyPlan(level) {
    let state = createState(level);
    for (let index = 0; index < level.steps.length; index += 1) {
        const expected = level.steps[index];
        const result = movePig(level, state, expected.id);
        if (!result.ok || !sameAction(result.action, expected)) throw new Error(`第 ${index + 1} 步不符合棋盘规则`);
        state = result.state;
    }
    if (!state.pigs.every(pig => pig.gone)) throw new Error('步骤结束后棋盘仍有小猪');
    return true;
}
