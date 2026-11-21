import { createState, cloneState, movePig, sameAction, verifyPlan } from './engine.mjs';

const SUPPORTED_LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66', '67', '68', '69', '70'];
const $ = id => document.getElementById(id);
SUPPORTED_LEVELS.push('82');
const ui = { board: $('board'), remaining: $('remaining'), rope: $('ropeCount'), status: $('status'), slider: $('slider'), previous: $('previous'), next: $('next'), undo: $('undo'), hint: $('hintToggle'), step: $('stepText'), progress: $('progressText'), win: $('win'), failure: $('failure') };
let level;
let state;
let cursor = 0;
let history = [];
let notice = '';
let moving = false;
let activeAnimation = null;
let animationVersion = 0;

// 离场时先保留棋盘上的小猪，根据方向移动到棋盘外；结束后才提交游戏状态。
async function animateExit(id) {
    const element = ui.board.querySelector(`[data-pig-id="${id}"]`);
    const pig = state.pigs.find(item => item.id === id);
    if (!element || !pig || !element.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const board = ui.board.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const offsets = {
        north: [0, board.top - rect.bottom - 12],
        south: [0, board.bottom - rect.top + 12],
        west: [board.left - rect.right - 12, 0],
        east: [board.right - rect.left + 12, 0]
    };
    const [x, y] = offsets[pig.direction];
    const duration = Math.max(320, Math.min(850, Math.hypot(x, y) * 1.4));
    activeAnimation = element.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${x}px, ${y}px)` }], { duration, easing: 'ease-in', fill: 'forwards' });
    try { await activeAnimation.finished; } catch (error) {
        // 拖动进度或重置时会取消当前动画，由调用方依据版本丢弃旧结果。
        if (error.name !== 'AbortError') throw error;
    }
}

function cancelAnimation() {
    animationVersion += 1;
    if (activeAnimation) activeAnimation.cancel();
    activeAnimation = null;
    moving = false;
    ui.board.style.pointerEvents = '';
    ui.hint.disabled = false;
}

// 同一套可逆状态用于自由操作、回放和撤回，动画期间不重复提交动作。
async function apply(id) {
    if (moving) return;
    const result = movePig(level, state, id);
    if (!result.ok) { notice = result.message; render(); return; }
    const version = ++animationVersion;
    if (result.action.exited) {
        moving = true;
        ui.board.style.pointerEvents = 'none';
        ui.previous.disabled = true;
        ui.next.disabled = true;
        ui.undo.disabled = true;
        ui.hint.disabled = true;
        try { await animateExit(id); } catch (error) { console.error('离场动画失败', error); }
        if (version !== animationVersion) return;
        activeAnimation = null;
        moving = false;
        ui.board.style.pointerEvents = '';
        ui.hint.disabled = false;
    }
    history.push({ state: cloneState(state), cursor });
    const expected = cursor === null ? null : level.steps[cursor];
    cursor = expected && sameAction(result.action, expected) ? cursor + 1 : null;
    state = result.state;
    notice = cursor === null ? '已偏离参考步骤，可以自由操作或撤回。' : '';
    render();
}

function undo() {
    if (moving) return;
    const previous = history.pop();
    if (!previous) return;
    state = previous.state;
    cursor = previous.cursor;
    notice = '';
    render();
}

function seek(target) {
    cancelAnimation();
    state = createState(level);
    cursor = 0;
    history = [];
    for (let index = 0; index < target; index += 1) {
        const result = movePig(level, state, level.steps[index].id);
        if (!result.ok || result.state.failed || !sameAction(result.action, level.steps[index])) throw new Error(`第 ${index + 1} 步回放失败`);
        history.push({ state: cloneState(state), cursor });
        state = result.state;
        cursor += 1;
    }
    notice = '';
    render();
}

function pigArt(pig) {
    if (pig.kind === 'elephant') return '<span class="animal-icon" aria-hidden="true">🐘</span>';
    const horizontal = pig.direction === 'east' || pig.direction === 'west';
    const width = horizontal ? pig.length * 100 : 100;
    const height = horizontal ? 100 : pig.length * 100;
    const cx = width / 2, cy = height / 2;
    const dx = pig.direction === 'east' ? 1 : pig.direction === 'west' ? -1 : 0;
    const dy = pig.direction === 'south' ? 1 : pig.direction === 'north' ? -1 : 0;
    const hx = cx + dx * (width / 2 - 31), hy = cy + dy * (height / 2 - 31);
    const eyeX = dx ? hx + dx * 9 : hx, eyeY = dy ? hy + dy * 9 : hy;
    const eyes = dx ? `<circle cx="${eyeX}" cy="${eyeY - 9}" r="3.3"/><circle cx="${eyeX}" cy="${eyeY + 9}" r="3.3"/>` : `<circle cx="${eyeX - 9}" cy="${eyeY}" r="3.3"/><circle cx="${eyeX + 9}" cy="${eyeY}" r="3.3"/>`;
    // 绳索始终横跨猪身，沿身体方向均匀排列并随剩余数量居中。
    const rope = pig.kind === 'rope' ? Array.from({ length: state.remainingScissors }, (_, i) => {
        const offset = (i - (state.remainingScissors - 1) / 2) * 15;
        const [x1, y1, x2, y2] = horizontal
            ? [cx + offset, cy - 33, cx + offset, cy + 33]
            : [cx - 33, cy + offset, cx + 33, cy + offset];
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#397aa9" stroke-width="8" stroke-linecap="round"/>`;
    }).join('') : '';
    const lockRemaining = pig.kind === 'lock' ? Math.max(0, pig.unlockAfter - state.exitCount) : 0;
    const lock = lockRemaining ? `<rect x="${cx - 23}" y="${cy - 20}" width="46" height="40" rx="8" fill="#edb83f" stroke="#a66b22" stroke-width="3"/><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="27" font-weight="bold" fill="white">${lockRemaining}</text>` : '';
    const scissors = pig.kind === 'scissors' ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="49">✂️</text>` : '';
    const bomb = pig.kind === 'bomb' ? `<rect x="${cx - 22}" y="${cy - 22}" width="44" height="44" rx="10" fill="#9c4938" stroke="#663025" stroke-width="3"/><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="29" font-weight="bold" fill="white">${pig.bombCount}</text>` : '';
    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><ellipse cx="${cx}" cy="${cy}" rx="${width / 2 - 9}" ry="${height / 2 - 9}" fill="#f4a6a2" stroke="#ce807d" stroke-width="3"/><ellipse cx="${hx}" cy="${hy}" rx="27" ry="27" fill="#f6b7ad" stroke="#d48580" stroke-width="3"/><g fill="#5b3934">${eyes}</g>${rope}${scissors}${lock}${bomb}</svg>`;
}

function render() {
    const remaining = state.pigs.filter(pig => !pig.gone).length;
    const expected = cursor === null ? null : level.steps[cursor];
    const fragment = document.createDocumentFragment();
    for (const [x, y] of state.ducks) {
        const duck = document.createElement('span');
        duck.className = 'duck';
        duck.style.left = `${100 * x / level.columns}%`;
        duck.style.top = `${100 * y / level.rows}%`;
        duck.style.width = `${100 / level.columns}%`;
        duck.style.height = `${100 / level.rows}%`;
        duck.textContent = '🐤';
        duck.setAttribute('aria-label', '小鸭');
        fragment.append(duck);
    }
    // 以格子覆盖层表示尚未打开的笼子，保留不规则和重叠笼体的真实占格。
    for (const cage of level.cages || []) {
        if (state.exitCount >= cage.unlockAfter) continue;
        for (const [x, y] of cage.cells) {
            const cell = document.createElement('span');
            cell.className = 'cage-cell';
            cell.style.left = `${100 * x / level.columns}%`;
            cell.style.top = `${100 * y / level.rows}%`;
            cell.style.width = `${100 / level.columns}%`;
            cell.style.height = `${100 / level.rows}%`;
            fragment.append(cell);
        }
        // 选择最靠近几何中心的实际笼格，使不规则笼的计数也位于笼体内。
        const centerX = cage.cells.reduce((sum, cell) => sum + cell[0], 0) / cage.cells.length;
        const centerY = cage.cells.reduce((sum, cell) => sum + cell[1], 0) / cage.cells.length;
        const [labelX, labelY] = cage.cells.reduce((best, cell) =>
            Math.hypot(cell[0] - centerX, cell[1] - centerY) < Math.hypot(best[0] - centerX, best[1] - centerY) ? cell : best);
        const label = document.createElement('span');
        label.className = 'cage-count';
        label.style.left = `${100 * (labelX + 0.5) / level.columns}%`;
        label.style.top = `${100 * (labelY + 0.5) / level.rows}%`;
        label.textContent = String(cage.unlockAfter - state.exitCount);
        label.setAttribute('aria-label', `铁笼还需 ${label.textContent} 只小猪离场`);
        fragment.append(label);
    }
    for (const pig of state.pigs) {
        if (pig.gone) continue;
        const horizontal = pig.direction === 'east' || pig.direction === 'west';
        const button = document.createElement('button');
        const hinted = ui.hint.checked && expected?.id === pig.id;
        button.type = 'button';
        button.className = `pig${hinted ? ' hinted' : ''}`;
        button.dataset.pigId = pig.id;
        button.style.left = `${100 * pig.x / level.columns}%`;
        button.style.top = `${100 * pig.y / level.rows}%`;
        button.style.width = `${100 * (horizontal ? pig.length : (pig.width || 1)) / level.columns}%`;
        button.style.height = `${100 * (horizontal ? (pig.width || 1) : pig.length) / level.rows}%`;
        const locked = pig.kind === 'lock' && state.exitCount < pig.unlockAfter;
        button.disabled = state.failed || locked || (pig.kind === 'rope' && state.remainingScissors > 0);
        const label = pig.kind === 'bomb' ? `炸弹猪 ${pig.id}，剩余 ${pig.bombCount} 次碰撞` : `${pig.kind === 'elephant' ? '小象' : pig.kind === 'scissors' ? '剪刀猪' : pig.kind === 'rope' ? '绳子猪' : pig.kind === 'lock' ? '锁猪' : '小猪'} ${pig.id}${locked ? `，锁还剩 ${pig.unlockAfter - state.exitCount}` : pig.kind === 'rope' && state.remainingScissors > 0 ? '，绳子未解开' : ''}`;
        button.setAttribute('aria-label', label);
        button.innerHTML = pigArt(pig) + (hinted ? '<span class="hint-arrow">▼</span>' : '');
        button.addEventListener('click', () => apply(pig.id));
        fragment.append(button);
    }
    ui.board.replaceChildren(fragment);
    ui.remaining.textContent = `剩余 ${remaining} 只`;
    const lock = state.pigs.find(pig => pig.kind === 'lock' && !pig.gone);
    ui.rope.textContent = lock ? (state.exitCount < lock.unlockAfter ? `🔒 还需 ${lock.unlockAfter - state.exitCount} 只` : '🔓 锁已解开') : level.id === 40 ? '🔓 锁已解开' : state.remainingScissors ? `✂ 还需 ${state.remainingScissors} 把剪刀` : '✂ 绳子已全部解开';
    if (level.cages?.length) ui.rope.textContent = level.cages.map(cage => `铁笼 ${Math.max(0, cage.unlockAfter - state.exitCount)}`).join(' · ');
    if (level.pigs.some(pig => pig.kind === 'bomb')) ui.rope.textContent = `💣 剩余 ${state.pigs.filter(pig => pig.kind === 'bomb' && !pig.gone).length} 只`;
    ui.step.textContent = cursor === null ? '自由游玩中' : cursor === level.steps.length ? '步骤已完成' : `下一步 · ${cursor + 1} / ${level.steps.length}`;
    ui.progress.textContent = cursor === null ? '已偏离参考步骤' : `${cursor} / ${level.steps.length}`;
    ui.status.textContent = state.failed ? '炸弹爆炸，请撤回一步或重新开始。' : notice || (cursor === null ? '拖动进度条可回到参考步骤。' : ui.hint.checked ? '红色光圈提示下一只小猪，也可以自己尝试。' : '点击小猪自由操作，或使用步骤按钮。');
    ui.slider.max = level.steps.length;
    if (cursor !== null) ui.slider.value = cursor;
    ui.previous.disabled = history.length === 0;
    ui.undo.disabled = history.length === 0;
    ui.next.disabled = state.failed || cursor === null || cursor >= level.steps.length;
    ui.win.hidden = state.failed || remaining !== 0 || state.ducks.length !== 0;
    ui.failure.hidden = !state.failed;
}

async function start() {
    try {
        const id = new URLSearchParams(location.search).get('level') || '48';
        if (!SUPPORTED_LEVELS.includes(id)) throw new Error(`暂时只有第 ${SUPPORTED_LEVELS.join('、')} 关`);
        const response = await fetch(`./level-${id}.json`);
        if (!response.ok) throw new Error('关卡数据加载失败');
        level = await response.json();
        verifyPlan(level);
        $('levelNumber').textContent = id;
        $('levelSelect').value = id;
        $('levelSelect').addEventListener('change', event => {
            const url = new URL(location.href);
            url.searchParams.set('level', event.target.value);
            location.assign(url.toString());
        });
        document.title = `猪了个猪 · 第 ${id} 关`;
        $('ruleText').textContent = level.pigs.some(pig => pig.kind === 'bomb') ? '炸弹猪碰撞后计数减一，归零爆炸；可以撤回或重新开始。' : level.cages?.length ? '小猪离场使铁笼计数减少，计数归零后铁笼打开。' : level.pigs.some(pig => pig.kind === 'lock')
            ? '每只普通猪离场后锁计数减一；计数归零后才能移动锁猪。'
            : level.pigs.some(pig => pig.kind === 'scissors' || pig.kind === 'rope')
                ? '剪刀猪离场后会解除一根绳；绳子全部解开后才能移动绳子猪。'
                : '小猪沿朝向滑到阻挡前或离开棋盘；点击、撤回和步骤回放使用同一套规则。';
        state = createState(level);
        ui.slider.addEventListener('input', event => seek(Number(event.target.value)));
        ui.previous.addEventListener('click', undo);
        ui.undo.addEventListener('click', undo);
        ui.next.addEventListener('click', () => { if (cursor !== null && cursor < level.steps.length) apply(level.steps[cursor].id); });
        ui.hint.addEventListener('change', render);
        $('resetButton').addEventListener('click', () => seek(0));
        $('winReset').addEventListener('click', () => seek(0));
        $('failureReset').addEventListener('click', () => seek(0));
        $('failureUndo').addEventListener('click', undo);
        render();
    } catch (error) {
        ui.status.textContent = error.message;
        ui.board.setAttribute('aria-label', '关卡加载失败');
        ui.next.disabled = true;
        ui.previous.disabled = true;
        ui.undo.disabled = true;
    }
}
start();
