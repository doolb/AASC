import { createState, cloneState, movePig, sameAction, verifyPlan } from './engine.mjs?v=20261123h';

const SUPPORTED_LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66', '67', '68', '69', '70', '71', '72', '73', '74', '75', '76', '77', '78', '79', '80', '81', '82', '83', '84', '85', '86', '87', '88', '89', '90', '91', '94', '95', '97', '98', '99', '100', '101', '102', '103', '104', '112', '113', '114', '115', '116', '117', '118'];
const $ = id => document.getElementById(id);
const ui = { board: $('board'), scene3d: $('scene3d'), remaining: $('remaining'), rope: $('ropeCount'), status: $('status'), slider: $('slider'), previous: $('previous'), next: $('next'), undo: $('undo'), hint: $('hintToggle'), step: $('stepText'), progress: $('progressText'), win: $('win'), failure: $('failure'), prevLevel: $('prevLevelButton'), nextLevel: $('nextLevelButton'), modeBadge: $('modeBadge') };
let level;
let state;
let cursor = 0;
let history = [];
let notice = '';
let noticeKind = '';
let moving = false;
let activeAnimation = null;
let animationVersion = 0;
let view3d = null;
let show2dControls = false;

// 离场时先保留棋盘上的小猪，根据方向移动到棋盘外并淡出；结束后才提交游戏状态。
async function animateExit(id) {
    if (view3d) {
        await view3d.animateExit(id);
        return;
    }
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
    const duration = Math.max(300, Math.min(780, Math.hypot(x, y) * 1.35));
    activeAnimation = element.animate(
        [{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${x}px, ${y}px)`, opacity: 0.15 }],
        { duration, easing: 'ease-in', fill: 'forwards' }
    );
    try { await activeAnimation.finished; } catch (error) {
        if (error.name !== 'AbortError') throw error;
    }
}

function cancelAnimation() {
    animationVersion += 1;
    if (activeAnimation) activeAnimation.cancel();
    activeAnimation = null;
    moving = false;
    ui.board.style.pointerEvents = '';
    if (level?.steps?.length) ui.hint.disabled = false;
    view3d?.cancelAnimations();
}

// 同一套可逆状态用于自由操作、回放和撤回，动画期间不重复提交动作。
async function apply(id) {
    if (moving) return;
    const result = movePig(level, state, id);
    if (!result.ok) {
        notice = result.message;
        noticeKind = 'warn';
        render();
        if (view3d) {
            view3d.shake(id, result.message);
            return;
        }
        const el = ui.board.querySelector(`[data-pig-id="${id}"]`);
        if (el) {
            el.classList.remove('shake');
            void el.offsetWidth;
            el.classList.add('shake');
        }
        return;
    }
    const version = ++animationVersion;
    if (result.action.exited) {
        if (view3d) {
            // 3D 模式下不阻塞后续点击，离场猪在场外独立冲刺淡出，玩家可连续点击下一只猪。
            view3d.animateExit(id).catch(error => console.error('离场动画失败', error));
        } else {
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
            if (level.steps.length) ui.hint.disabled = false;
        }
    }
    history.push({ state: cloneState(state), cursor });
    const hasSteps = level.steps.length > 0;
    const expected = !hasSteps || cursor === null ? null : level.steps[cursor];
    cursor = expected && sameAction(result.action, expected) ? cursor + 1 : null;
    state = result.state;
    notice = !hasSteps ? '自由试玩中（本关未附带参考步骤）。' : cursor === null ? '已偏离参考步骤，可以自由操作或撤回。' : '';
    noticeKind = result.won ? 'ok' : '';
    render();
}

function undo() {
    if (moving) return;
    const previous = history.pop();
    if (!previous) return;
    state = previous.state;
    // 撤回后若在场计时炸弹剩余秒数过少，保底恢复至 15 秒以免再次瞬间引爆
    for (const pig of state.pigs) {
        if (pig.kind === 'timer_bomb' && !pig.gone && pig.timerSeconds <= 5) {
            pig.timerSeconds = Math.max(pig.timerSeconds, 15);
        }
    }
    cursor = previous.cursor;
    notice = '';
    noticeKind = '';
    render();
}

function seek(target) {
    cancelAnimation();
    state = createState(level);
    cursor = level.steps.length ? 0 : null;
    history = [];
    for (let index = 0; index < target; index += 1) {
        const result = movePig(level, state, level.steps[index].id);
        if (!result.ok || result.state.failed || !sameAction(result.action, level.steps[index])) throw new Error(`第 ${index + 1} 步回放失败`);
        history.push({ state: cloneState(state), cursor });
        state = result.state;
        cursor += 1;
    }
    notice = '';
    noticeKind = '';
    render();
}

function pigArt(pig) {
    const dirMarks = { north: '▲', south: '▼', west: '◀', east: '▶' };
    if (pig.kind === 'elephant') {
        return `<span class="animal-icon" aria-hidden="true">🐘<span class="elephant-dir">${dirMarks[pig.direction] || ''}</span></span>`;
    }
    const horizontal = pig.direction === 'east' || pig.direction === 'west';
    const width = horizontal ? pig.length * 100 : (pig.width || 1) * 100;
    const height = horizontal ? (pig.width || 1) * 100 : pig.length * 100;
    const cx = width / 2, cy = height / 2;
    const dx = pig.direction === 'east' ? 1 : pig.direction === 'west' ? -1 : 0;
    const dy = pig.direction === 'south' ? 1 : pig.direction === 'north' ? -1 : 0;
    const hx = cx + dx * (width / 2 - 31), hy = cy + dy * (height / 2 - 31);
    const tx = cx - dx * (width / 2 - 10), ty = cy - dy * (height / 2 - 10);
    const tail = `<path d="M ${tx} ${ty} q ${-dx * 7 - dy * 7} ${-dy * 7 + dx * 7} ${-dx * 3} ${-dy * 3}" fill="none" stroke="#d98784" stroke-width="3" stroke-linecap="round"/>`;
    const ears = dx
        ? `<ellipse cx="${hx - dx * 12}" cy="${hy - 22}" rx="8" ry="6" fill="#f39d98" stroke="#ce7d78" stroke-width="2"/><ellipse cx="${hx - dx * 12}" cy="${hy + 22}" rx="8" ry="6" fill="#f39d98" stroke="#ce7d78" stroke-width="2"/>`
        : `<ellipse cx="${hx - 22}" cy="${hy - dy * 12}" rx="6" ry="8" fill="#f39d98" stroke="#ce7d78" stroke-width="2"/><ellipse cx="${hx + 22}" cy="${hy - dy * 12}" rx="6" ry="8" fill="#f39d98" stroke="#ce7d78" stroke-width="2"/>`;
    const eyeX = dx ? hx + dx * 6 : hx, eyeY = dy ? hy + dy * 6 : hy;
    const eyes = dx
        ? `<circle cx="${eyeX}" cy="${eyeY - 10}" r="3.6"/><circle cx="${eyeX}" cy="${eyeY + 10}" r="3.6"/>`
        : `<circle cx="${eyeX - 10}" cy="${eyeY}" r="3.6"/><circle cx="${eyeX + 10}" cy="${eyeY}" r="3.6"/>`;
    const snoutX = hx + dx * 19, snoutY = hy + dy * 19;
    const snout = `<ellipse cx="${snoutX}" cy="${snoutY}" rx="${dx ? 6 : 9}" ry="${dx ? 9 : 6}" fill="#f49492" stroke="#cc7673" stroke-width="2"/>`;
    const rope = pig.kind === 'rope' ? Array.from({ length: state.remainingScissors }, (_, i) => {
        const offset = (i - (state.remainingScissors - 1) / 2) * 15;
        const [x1, y1, x2, y2] = horizontal
            ? [cx + offset, cy - 33, cx + offset, cy + 33]
            : [cx - 33, cy + offset, cx + 33, cy + offset];
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#397aa9" stroke-width="8" stroke-linecap="round"/>`;
    }).join('') : '';
    const spring = pig.kind === 'spring' ? [-14, 0, 14].map(offset => (horizontal
        ? `<ellipse cx="${cx + offset}" cy="${cy}" rx="6" ry="33" fill="none" stroke="#2c6eb5" stroke-width="6"/><ellipse cx="${cx + offset}" cy="${cy}" rx="6" ry="33" fill="none" stroke="#85c7ff" stroke-width="2"/>`
        : `<ellipse cx="${cx}" cy="${cy + offset}" rx="33" ry="6" fill="none" stroke="#2c6eb5" stroke-width="6"/><ellipse cx="${cx}" cy="${cy + offset}" rx="33" ry="6" fill="none" stroke="#85c7ff" stroke-width="2"/>`
    )).join('') : '';
    const lockRemaining = pig.kind === 'lock' ? Math.max(0, pig.unlockAfter - state.exitCount) : 0;
    const lock = lockRemaining ? `<rect x="${cx - 23}" y="${cy - 20}" width="46" height="40" rx="9" fill="#edb83f" stroke="#a66b22" stroke-width="3"/><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="26" font-weight="bold" fill="white">${lockRemaining}</text>` : '';
    const scissors = pig.kind === 'scissors' ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="46">✂️</text>` : '';
    const bomb = pig.kind === 'bomb' ? `<rect x="${cx - 22}" y="${cy - 22}" width="44" height="44" rx="10" fill="#b44332" stroke="#6d2319" stroke-width="3"/><text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="28" font-weight="bold" fill="white">${pig.bombCount}</text>` : '';
    const timerBomb = pig.kind === 'timer_bomb' ? `<rect x="${cx - 26}" y="${cy - 18}" width="52" height="36" rx="9" fill="#2b2628" stroke="#c83728" stroke-width="3"/><text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="21" font-weight="900" fill="#ff5b45">${pig.timerSeconds}s</text>` : '';
    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${tail}${ears}<ellipse cx="${cx}" cy="${cy}" rx="${width / 2 - 9}" ry="${height / 2 - 9}" fill="#f6a7a3" stroke="#ce7d79" stroke-width="3"/><ellipse cx="${hx}" cy="${hy}" rx="27" ry="27" fill="#fac0b7" stroke="#d4837d" stroke-width="3"/>${snout}<g fill="#4d2e28">${eyes}</g>${rope}${spring}${scissors}${lock}${bomb}${timerBomb}</svg>`;
}

function render() {
    const remaining = state.pigs.filter(pig => !pig.gone).length;
    const hasSteps = level.steps.length > 0;
    const expected = !hasSteps || cursor === null ? null : level.steps[cursor];

    if (!view3d) {
        const fragment = document.createDocumentFragment();
        const backdrop = document.createElement('div');
        backdrop.className = 'board-backdrop';
        backdrop.style.setProperty('--cols', level.columns);
        backdrop.style.setProperty('--rows', level.rows);
        fragment.append(backdrop);

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
            const hinted = hasSteps && ui.hint.checked && expected?.id === pig.id;
            button.type = 'button';
            button.className = `pig${hinted ? ' hinted' : ''}`;
            button.dataset.pigId = pig.id;
            button.style.left = `${100 * pig.x / level.columns}%`;
            button.style.top = `${100 * pig.y / level.rows}%`;
            button.style.width = `${100 * (horizontal ? pig.length : (pig.width || 1)) / level.columns}%`;
            button.style.height = `${100 * (horizontal ? (pig.width || 1) : pig.length) / level.rows}%`;
            const locked = pig.kind === 'lock' && state.exitCount < pig.unlockAfter;
            button.disabled = state.failed || locked || (pig.kind === 'rope' && state.remainingScissors > 0);
            const label = pig.kind === 'bomb'
                ? `炸弹猪 ${pig.id}，剩余 ${pig.bombCount} 次`
                : pig.kind === 'timer_bomb'
                    ? `计时炸弹猪 ${pig.id}，限时 ${pig.timerSeconds} 秒`
                    : pig.kind === 'spring'
                        ? `弹簧猪 ${pig.id}`
                        : `${pig.kind === 'elephant' ? '小象' : pig.kind === 'scissors' ? '剪刀猪' : pig.kind === 'rope' ? '绳子猪' : pig.kind === 'lock' ? '锁猪' : '小猪'} ${pig.id}${locked ? `，锁还剩 ${pig.unlockAfter - state.exitCount}` : pig.kind === 'rope' && state.remainingScissors > 0 ? '，绳子未解开' : ''}`;
            button.setAttribute('aria-label', label);
            button.innerHTML = pigArt(pig) + (hinted ? '<span class="hint-arrow" aria-hidden="true">▼</span>' : '');
            button.addEventListener('click', () => apply(pig.id));
            fragment.append(button);
        }
        ui.board.replaceChildren(fragment);
    }

    ui.remaining.textContent = `剩余 ${remaining} 只`;
    const lock = state.pigs.find(pig => pig.kind === 'lock' && !pig.gone);
    ui.rope.textContent = lock
        ? (state.exitCount < lock.unlockAfter ? `🔒 还需 ${lock.unlockAfter - state.exitCount} 只` : '🔓 锁已解开')
        : level.id === 40
            ? '🔓 锁已解开'
            : state.remainingScissors
                ? `✂ 还需 ${state.remainingScissors} 把剪刀`
                : '✂ 绳子已全部解开';
    if (level.cages?.length) ui.rope.textContent = level.cages.map(cage => `铁笼 ${Math.max(0, cage.unlockAfter - state.exitCount)}`).join(' · ');
    if (level.pigs.some(pig => pig.kind === 'bomb')) ui.rope.textContent = `💣 剩余 ${state.pigs.filter(pig => pig.kind === 'bomb' && !pig.gone).length} 只`;
    if (level.pigs.some(pig => pig.kind === 'timer_bomb') && !lock && !level.cages?.length && !level.pigs.some(pig => pig.kind === 'bomb')) {
        ui.rope.textContent = `⏱ 计时炸弹 ${state.pigs.filter(pig => pig.kind === 'timer_bomb' && !pig.gone).length} 只`;
    }
    ui.modeBadge.hidden = hasSteps;
    ui.step.textContent = !hasSteps ? '自由试玩（无参考步骤）' : cursor === null ? '自由游玩中' : cursor === level.steps.length ? '步骤已完成' : `下一步 · ${cursor + 1} / ${level.steps.length}`;
    ui.progress.textContent = !hasSteps ? '仅支持手动点击与撤回' : cursor === null ? '已偏离参考步骤' : `${cursor} / ${level.steps.length}`;
    ui.status.textContent = state.failed
        ? '炸弹爆炸，请撤回一步或重新开始。'
        : notice || (!hasSteps ? '本关暂无官方参考步骤，可直接点击任意可移动小猪尝试（支持撤回与重开）。' : cursor === null ? '拖动进度条可回到参考步骤。' : ui.hint.checked ? '提示标记下一只小猪，支持键盘 ←/→ 步进、Z 撤回。' : '点击小猪自由操作，或使用步骤按钮。');
    ui.status.className = `status${state.failed || noticeKind === 'warn' ? ' is-warn' : remaining === 0 && !state.ducks.length ? ' is-ok' : ''}`;
    ui.slider.max = level.steps.length;
    ui.slider.disabled = !hasSteps;
    ui.hint.disabled = !hasSteps;
    if (hasSteps && cursor !== null) ui.slider.value = cursor;
    ui.previous.disabled = history.length === 0;
    ui.undo.disabled = history.length === 0;
    ui.next.disabled = !hasSteps || state.failed || cursor === null || cursor >= level.steps.length;
    const won = !state.failed && remaining === 0 && state.ducks.length === 0;
    ui.win.hidden = !won;
    ui.failure.hidden = !state.failed;

    if (view3d) {
        view3d.sync({
            level,
            state,
            hintId: hasSteps && ui.hint.checked && expected ? expected.id : null,
            ui: {
                levelId: String(level.id),
                remaining,
                ropeText: ui.rope.textContent,
                stepText: ui.step.textContent,
                progressText: ui.progress.textContent,
                statusText: ui.status.textContent,
                statusKind: state.failed || noticeKind === 'warn' ? 'warn' : won ? 'ok' : '',
                ruleText: $('ruleText').textContent,
                hintChecked: ui.hint.checked,
                hintDisabled: ui.hint.disabled,
                hasSteps,
                cursor,
                totalSteps: level.steps.length,
                canPrev: !ui.previous.disabled,
                canNext: !ui.next.disabled,
                canUndo: !ui.undo.disabled,
                won,
                failed: state.failed,
                freeMode: !hasSteps,
                show2dControls
            }
        });
    }
}

function goLevel(id, extra = {}) {
    view3d?.dispose();
    view3d = null;
    const url = new URL(location.href);
    url.searchParams.set('level', id);
    for (const [k, v] of Object.entries(extra)) {
        if (v === null) url.searchParams.delete(k);
        else url.searchParams.set(k, v);
    }
    location.assign(url.toString());
}

function toggle2dControls() {
    show2dControls = !show2dControls;
    document.body.classList.toggle('show-2d-controls', show2dControls);
    try { localStorage.setItem('pig3d.show2dControls', show2dControls ? '1' : '0'); } catch (_) {}
    render();
}

async function start() {
    try {
        const params = new URLSearchParams(location.search);
        const id = params.get('level') || '48';
        if (!SUPPORTED_LEVELS.includes(id)) throw new Error(`暂时只有第 ${SUPPORTED_LEVELS.join('、')} 关`);
        const pos = SUPPORTED_LEVELS.indexOf(id);
        ui.prevLevel.disabled = pos <= 0;
        ui.nextLevel.disabled = pos >= SUPPORTED_LEVELS.length - 1;
        ui.prevLevel.addEventListener('click', () => { if (pos > 0) goLevel(SUPPORTED_LEVELS[pos - 1]); });
        ui.nextLevel.addEventListener('click', () => { if (pos < SUPPORTED_LEVELS.length - 1) goLevel(SUPPORTED_LEVELS[pos + 1]); });

        const response = await fetch(`./level-${id}.json`);
        if (!response.ok) throw new Error('关卡数据加载失败');
        level = await response.json();
        level.steps = level.steps || [];
        verifyPlan(level);
        ui.board.style.aspectRatio = `${level.columns} / ${level.rows}`;
        ui.board.style.setProperty('--cols', level.columns);
        ui.board.style.setProperty('--rows', level.rows);
        $('levelNumber').textContent = id;
        $('levelSelect').value = id;
        $('levelSelect').addEventListener('change', event => goLevel(event.target.value));
        document.title = `猪了个猪 · 第 ${id} 关`;
        const rules = [];
        if (level.pigs.some(p => p.kind === 'spring')) rules.push('弹簧猪遇阻会弹回原位');
        if (level.pigs.some(p => p.kind === 'bomb')) rules.push('数字炸弹碰撞减一，归零爆炸');
        if (level.pigs.some(p => p.kind === 'timer_bomb')) rules.push('计时炸弹可在场内停靠并带有限时提示');
        if (level.cages?.length) rules.push('小猪离场减少铁笼计数，归零打开');
        if (level.pigs.some(p => p.kind === 'lock')) rules.push('离场累计到锁计数后解锁');
        if (level.pigs.some(p => p.kind === 'scissors' || p.kind === 'rope')) rules.push('剪刀猪离场逐根解开绳索');
        $('ruleText').textContent = rules.length ? `${rules.join('；')}。支持撤回与重开。` : '小猪沿朝向滑到阻挡前或离开棋盘；点击、撤回和步骤回放使用同一套规则。';
        state = createState(level);
        cursor = level.steps.length ? 0 : null;

        // 默认启用 3D 模式；URL 含 ?view=2d 或 WebGL 不可用时回退原 2D 视图。
        const want2d = params.get('view') === '2d';
        if (!want2d && ui.scene3d) {
            try {
                const probe = document.createElement('canvas');
                const hasGl = Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
                if (hasGl) {
                    const mod = await import('./3d/view.mjs?v=20261123h');
                    const actionHandlers = {
                        next: () => { if (level.steps.length && cursor !== null && cursor < level.steps.length && !ui.next.disabled) apply(level.steps[cursor].id); },
                        previous: () => { if (!ui.previous.disabled) undo(); },
                        undo: () => { if (!ui.undo.disabled) undo(); },
                        reset: () => seek(0),
                        seek: target => { if (level.steps.length) seek(Math.max(0, Math.min(level.steps.length, Number(target) || 0))); },
                        hint: () => { if (!ui.hint.disabled) { ui.hint.checked = !ui.hint.checked; render(); } },
                        level: nextId => { if (SUPPORTED_LEVELS.includes(String(nextId))) goLevel(String(nextId)); },
                        prevLevel: () => { if (pos > 0) goLevel(SUPPORTED_LEVELS[pos - 1]); },
                        nextLevel: () => { if (pos < SUPPORTED_LEVELS.length - 1) goLevel(SUPPORTED_LEVELS[pos + 1]); },
                        toggle2dControls: () => toggle2dControls(),
                        view2d: () => goLevel(id, { view: '2d' })
                    };
                    view3d = await mod.createView3D({
                        container: ui.scene3d,
                        level,
                        levels: SUPPORTED_LEVELS,
                        onPick: apply,
                        onAction: (name, payload) => actionHandlers[name]?.(payload)
                    });
                    document.body.classList.add('mode-3d');
                    try {
                        show2dControls = localStorage.getItem('pig3d.show2dControls') === '1';
                        document.body.classList.toggle('show-2d-controls', show2dControls);
                    } catch (_) {}
                }
            } catch (error) {
                console.warn('3D 视图初始化失败，已自动回退 2D 模式', error);
                view3d = null;
            }
        }

        ui.slider.addEventListener('input', event => seek(Number(event.target.value)));
        ui.previous.addEventListener('click', undo);
        ui.undo.addEventListener('click', undo);
        ui.next.addEventListener('click', () => { if (level.steps.length && cursor !== null && cursor < level.steps.length) apply(level.steps[cursor].id); });
        ui.hint.addEventListener('change', render);
        $('resetButton').addEventListener('click', () => seek(0));
        $('winReset').addEventListener('click', () => seek(0));
        $('failureReset').addEventListener('click', () => seek(0));
        $('failureUndo').addEventListener('click', undo);
        document.addEventListener('keydown', event => {
            if (event.target?.tagName === 'SELECT' || event.target?.tagName === 'INPUT') return;
            if (event.key === 'ArrowRight' && !ui.next.disabled) ui.next.click();
            else if (event.key === 'ArrowLeft' && !ui.previous.disabled) ui.previous.click();
            else if ((event.key === 'z' || event.key === 'Z') && !ui.undo.disabled) undo();
            else if (event.key === 'r' || event.key === 'R') seek(0);
            else if ((event.key === 'h' || event.key === 'H') && !ui.hint.disabled) { ui.hint.checked = !ui.hint.checked; render(); }
            else if ((event.key === 'm' || event.key === 'M') && view3d) view3d.toggleMusic();
            else if ((event.key === 'v' || event.key === 'V') && view3d) view3d.resetCamera();
            else if ((event.key === 'c' || event.key === 'C') && view3d) toggle2dControls();
        });
        // 计时炸弹每秒实时倒计时；归零时引爆失败，支持撤回恢复
        const timerInterval = setInterval(() => {
            if (!level || !state || state.failed || moving || document.hidden) return;
            const remainingPigs = state.pigs.some(p => !p.gone);
            if (!remainingPigs && !state.ducks.length) return;
            const timers = state.pigs.filter(p => !p.gone && p.kind === 'timer_bomb');
            if (!timers.length) return;
            let exploded = false;
            for (const pig of timers) {
                pig.timerSeconds = Math.max(0, (Number(pig.timerSeconds) || 0) - 1);
                if (pig.timerSeconds <= 0) exploded = true;
            }
            if (exploded) {
                state.failed = true;
                notice = '计时炸弹时间到爆炸，请撤回一步或重新开始。';
                noticeKind = 'warn';
            }
            render();
        }, 1000);
        window.addEventListener('beforeunload', () => clearInterval(timerInterval));
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
