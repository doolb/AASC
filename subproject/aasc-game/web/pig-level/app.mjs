import { createState, cloneState, movePig, sameAction, verifyPlan } from './engine.mjs';

const $ = id => document.getElementById(id);
const ui = { board: $('board'), remaining: $('remaining'), rope: $('ropeCount'), status: $('status'), slider: $('slider'), previous: $('previous'), next: $('next'), undo: $('undo'), hint: $('hintToggle'), step: $('stepText'), progress: $('progressText'), win: $('win') };
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
        if (!result.ok || !sameAction(result.action, level.steps[index])) throw new Error(`第 ${index + 1} 步回放失败`);
        history.push({ state: cloneState(state), cursor });
        state = result.state;
        cursor += 1;
    }
    notice = '';
    render();
}

function pigArt(pig) {
    const horizontal = pig.direction === 'east' || pig.direction === 'west';
    const width = horizontal ? pig.length * 100 : 100;
    const height = horizontal ? 100 : pig.length * 100;
    const cx = width / 2, cy = height / 2;
    const dx = pig.direction === 'east' ? 1 : pig.direction === 'west' ? -1 : 0;
    const dy = pig.direction === 'south' ? 1 : pig.direction === 'north' ? -1 : 0;
    const hx = cx + dx * (width / 2 - 31), hy = cy + dy * (height / 2 - 31);
    const eyeX = dx ? hx + dx * 9 : hx, eyeY = dy ? hy + dy * 9 : hy;
    const eyes = dx ? `<circle cx="${eyeX}" cy="${eyeY - 9}" r="3.3"/><circle cx="${eyeX}" cy="${eyeY + 9}" r="3.3"/>` : `<circle cx="${eyeX - 9}" cy="${eyeY}" r="3.3"/><circle cx="${eyeX + 9}" cy="${eyeY}" r="3.3"/>`;
    const rope = pig.kind === 'rope' ? Array.from({ length: state.remainingScissors }, (_, i) => `<line x1="${cx - 33}" y1="${cy - 16 + i * 15}" x2="${cx + 33}" y2="${cy - 16 + i * 15}" stroke="#397aa9" stroke-width="8" stroke-linecap="round"/>`).join('') : '';
    const lockRemaining = pig.kind === 'lock' ? Math.max(0, pig.unlockAfter - state.exitCount) : 0;
    const lock = lockRemaining ? `<rect x="${cx - 23}" y="${cy - 20}" width="46" height="40" rx="8" fill="#edb83f" stroke="#a66b22" stroke-width="3"/><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="27" font-weight="bold" fill="white">${lockRemaining}</text>` : '';
    const scissors = pig.kind === 'scissors' ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="49">✂️</text>` : '';
    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><ellipse cx="${cx}" cy="${cy}" rx="${width / 2 - 9}" ry="${height / 2 - 9}" fill="#f4a6a2" stroke="#ce807d" stroke-width="3"/><ellipse cx="${hx}" cy="${hy}" rx="27" ry="27" fill="#f6b7ad" stroke="#d48580" stroke-width="3"/><g fill="#5b3934">${eyes}</g>${rope}${scissors}${lock}</svg>`;
}

function render() {
    const remaining = state.pigs.filter(pig => !pig.gone).length;
    const expected = cursor === null ? null : level.steps[cursor];
    const fragment = document.createDocumentFragment();
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
        button.style.width = `${100 * (horizontal ? pig.length : 1) / level.columns}%`;
        button.style.height = `${100 * (horizontal ? 1 : pig.length) / level.rows}%`;
        const locked = pig.kind === 'lock' && state.exitCount < pig.unlockAfter;
        button.disabled = locked || (pig.kind === 'rope' && state.remainingScissors > 0);
        button.setAttribute('aria-label', `${pig.kind === 'scissors' ? '剪刀猪' : pig.kind === 'rope' ? '绳子猪' : pig.kind === 'lock' ? '锁猪' : '小猪'} ${pig.id}${locked ? `，锁还剩 ${pig.unlockAfter - state.exitCount}` : button.disabled ? '，绳子未解开' : ''}`);
        button.innerHTML = pigArt(pig) + (hinted ? '<span class="hint-arrow">▼</span>' : '');
        button.addEventListener('click', () => apply(pig.id));
        fragment.append(button);
    }
    ui.board.replaceChildren(fragment);
    ui.remaining.textContent = `剩余 ${remaining} 只`;
    const lock = state.pigs.find(pig => pig.kind === 'lock' && !pig.gone);
    ui.rope.textContent = lock ? (state.exitCount < lock.unlockAfter ? `🔒 还需 ${lock.unlockAfter - state.exitCount} 只` : '🔓 锁已解开') : level.id === 40 ? '🔓 锁已解开' : state.remainingScissors ? `✂ 还需 ${state.remainingScissors} 把剪刀` : '✂ 绳子已全部解开';
    ui.step.textContent = cursor === null ? '自由游玩中' : cursor === level.steps.length ? '步骤已完成' : `下一步 · ${cursor + 1} / ${level.steps.length}`;
    ui.progress.textContent = cursor === null ? '已偏离参考步骤' : `${cursor} / ${level.steps.length}`;
    ui.status.textContent = notice || (cursor === null ? '拖动进度条可回到参考步骤。' : ui.hint.checked ? '红色光圈提示下一只小猪，也可以自己尝试。' : '点击小猪自由操作，或使用步骤按钮。');
    ui.slider.max = level.steps.length;
    if (cursor !== null) ui.slider.value = cursor;
    ui.previous.disabled = history.length === 0;
    ui.undo.disabled = history.length === 0;
    ui.next.disabled = cursor === null || cursor >= level.steps.length;
    ui.win.hidden = remaining !== 0;
}

async function start() {
    try {
        const id = new URLSearchParams(location.search).get('level') || '48';
        if (!['40', '48'].includes(id)) throw new Error('暂时只有第 40、48 关');
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
        $('ruleText').textContent = id === '40' ? '每只猪离场后锁计数减一；计数归零后才能移动锁猪。' : '剪刀猪离场后会解除一根绳；绳子全部解开后才能移动绳子猪。';
        state = createState(level);
        ui.slider.addEventListener('input', event => seek(Number(event.target.value)));
        ui.previous.addEventListener('click', undo);
        ui.undo.addEventListener('click', undo);
        ui.next.addEventListener('click', () => { if (cursor !== null && cursor < level.steps.length) apply(level.steps[cursor].id); });
        ui.hint.addEventListener('change', render);
        $('resetButton').addEventListener('click', () => seek(0));
        $('winReset').addEventListener('click', () => seek(0));
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
