// 棋盘状态与界面分离，所有点击、回放和撤回共用同一套规则。
const VECTORS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export function createState(level) {
    const state = { exitCount: 0, failed: false, pigs: level.pigs.map(pig => ({ ...pig, gone: false })), ducks: (level.ducks || []).map(cell => [...cell]), remainingScissors: level.pigs.filter(pig => pig.kind === 'scissors').length };
    settleDucks(level, state);
    return state;
}

export function cloneState(state) {
    return { exitCount: state.exitCount, failed: state.failed, pigs: state.pigs.map(pig => ({ ...pig })), ducks: state.ducks.map(cell => [...cell]), remainingScissors: state.remainingScissors };
}

function cells(pig) {
    if (pig.shape) return pig.shape.map(([x, y]) => [pig.x + x, pig.y + y]);
    const horizontal = pig.direction === 'east' || pig.direction === 'west';
    return Array.from({ length: pig.length }, (_, offset) => Array.from({ length: pig.width || 1 }, (_, side) => [pig.x + (horizontal ? offset : side), pig.y + (horizontal ? side : offset)])).flat();
}

// 鸭子可穿过相互连通的空格，接通棋盘边缘时自动离场。
function settleDucks(level, state) {
    if (!state.ducks.length) return;
    const blocked = new Set(state.pigs.filter(p => !p.gone).flatMap(cells).map(c => c.join(',')));
    for (const cage of level.cages || []) if (state.exitCount < cage.unlockAfter) for (const c of cage.cells) blocked.add(c.join(','));
    const queue = [], seen = new Set();
    const add = (x, y) => { const key = `${x},${y}`; if (x < 0 || y < 0 || x >= level.columns || y >= level.rows || blocked.has(key) || seen.has(key)) return; seen.add(key); queue.push([x, y]); };
    for (let x = 0; x < level.columns; x++) { add(x, 0); add(x, level.rows - 1); }
    for (let y = 0; y < level.rows; y++) { add(0, y); add(level.columns - 1, y); }
    for (let i = 0; i < queue.length; i++) for (const [dx, dy] of Object.values(VECTORS)) add(queue[i][0] + dx, queue[i][1] + dy);
    const before = state.ducks.length;
    state.ducks = state.ducks.filter(cell => !seen.has(cell.join(',')));
    state.exitCount += before - state.ducks.length;
}

export function movePig(level, state, id) {
    if (state.failed) return { ok: false, message: '炸弹已爆炸，请撤回或重新开始' };
    const next = cloneState(state);
    const pig = next.pigs.find(item => item.id === id);
    if (!pig || pig.gone) return { ok: false, message: '这只小猪已经离开' };
    if (pig.kind === 'lock' && next.exitCount < pig.unlockAfter) return { ok: false, message: `锁还剩 ${pig.unlockAfter - next.exitCount}，先送走其他猪` };
    if (pig.kind === 'rope' && next.remainingScissors > 0) return { ok: false, message: `绳子还剩 ${next.remainingScissors} 根，先送走剪刀猪` };
    const cages = (level.cages || []).filter(cage => next.exitCount < cage.unlockAfter);
    const cageCells = new Set(cages.flatMap(cage => cage.cells.map(([x, y]) => `${x},${y}`)));
    if (cells(pig).some(([x, y]) => cageCells.has(`${x},${y}`))) return { ok: false, message: '铁笼尚未打开' };
    const pigCells = new Map();
    for (const other of next.pigs.filter(item => !item.gone && item.id !== id)) {
        for (const [x, y] of cells(other)) pigCells.set(`${x},${y}`, other);
    }
    const occupied = new Set(pigCells.keys());
    for (const cell of cageCells) occupied.add(cell);
    for (const cell of next.ducks) occupied.add(cell.join(','));
    const vector = VECTORS[pig.direction];
    if (!vector) return { ok: false, message: '小猪朝向无效' };
    const [dx, dy] = vector;
    const from = [pig.x, pig.y];
    if (pig.shape && pig.kind === 'elephant') {
        // 特殊小象只在完整通道畅通时离场，并释放不规则占格。
        for (const [x, y] of cells(pig)) {
            let px = x + dx, py = y + dy;
            while (px >= 0 && py >= 0 && px < level.columns && py < level.rows) {
                if (occupied.has(`${px},${py}`)) return { ok: false, message: '小象前方有阻挡' };
                px += dx; py += dy;
            }
        }
        pig.gone = true;
        settleDucks(level, next);
        return { ok: true, state: next, action: { id, from, to: null, exited: true }, won: next.pigs.every(item => item.gone) && !next.ducks.length };
    }
    let distance = 0;
    // 沿朝向前进至最近的障碍；头部越过棋盘则整只猪离场。
    while (true) {
        const horizontal = dx !== 0;
        const headX = pig.x + (dx > 0 ? pig.length - 1 : 0) + dx;
        const headY = pig.y + (dy > 0 ? pig.length - 1 : 0) + dy;
        if (headX < 0 || headY < 0 || headX >= level.columns || headY >= level.rows) {
            pig.gone = true;
            next.exitCount += 1;
            if (pig.kind === 'scissors') next.remainingScissors -= 1;
            settleDucks(level, next);
            return { ok: true, state: next, action: { id, from, to: null, exited: true }, won: next.pigs.every(item => item.gone) };
        }
        const front = Array.from({ length: pig.width || 1 }, (_, side) => `${headX + (horizontal ? 0 : side)},${headY + (horizontal ? side : 0)}`);
        if (front.some(cell => occupied.has(cell))) {
            // 同一次碰撞可能涉及多个占格，按炸弹对象去重后各减一次。
            const struck = [...new Set(front.map(cell => pigCells.get(cell)).filter(Boolean))];
            const bombs = new Set(struck.filter(item => item.kind === 'bomb'));
            if (struck.length && pig.kind === 'bomb') bombs.add(pig);
            if (!distance && !bombs.size) return { ok: false, message: '前方有阻挡' };
            for (const bomb of bombs) bomb.bombCount = Math.max(0, bomb.bombCount - 1);
            next.failed = [...bombs].some(bomb => bomb.bombCount === 0);
            settleDucks(level, next);
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
        if (!result.ok || result.state.failed || !sameAction(result.action, expected)) throw new Error(`第 ${index + 1} 步不符合棋盘规则`);
        state = result.state;
    }
    if (!state.pigs.every(pig => pig.gone) || state.ducks.length) throw new Error('步骤结束后棋盘仍有动物');
    return true;
}
