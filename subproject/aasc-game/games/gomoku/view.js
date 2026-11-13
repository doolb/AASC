/** 仅加载常量模板；用户数据均通过 textContent 赋值。 */
export function initGomoku({ element, send }) {
    element('gameArea').innerHTML = '<div class="controls"><label>棋盘尺寸 <select id="size"><option>9</option><option>11</option><option>13</option><option selected>15</option></select></label><button id="config">设置尺寸</button><button id="start">开始对局</button></div><p id="players"></p><p id="state"></p><div id="board" role="grid" aria-label="五子棋棋盘"></div>';
    element('config').onclick = () => send('game.config', { size: Number(element('size').value) });
    element('start').onclick = () => send('game.start');
}

/** 五子棋棋盘渲染与操作只依赖游戏提供的状态，不耦合中转实现。 */
export function renderGomoku(next, { element, send }) {
    element('size').value = String(next.size);
    const labels = ['黑棋', '白棋'];
    element('players').textContent = next.players.map((player, i) => `${labels[i]}：${player.name || '等待加入'}${player.name ? (player.online ? '（在线）' : '（离线）') : ''}`).join('　');
    const messages = { waiting: '等待开始', playing: `轮到${labels[next.turn]}`, black: '黑棋获胜', white: '白棋获胜', draw: '平局' };
    element('state').textContent = `${messages[next.result]}　你是${labels[next.seat]}`;
    element('config').disabled = next.seat !== 0 || next.result === 'playing';
    element('start').disabled = next.seat !== 0 || next.result === 'playing' || !next.players[1].online;
    const board = element('board'); board.style.gridTemplateColumns = `repeat(${next.size},1fr)`;
    const fragment = document.createDocumentFragment();
    next.board.forEach((cell, index) => {
        const square = document.createElement('button'); square.setAttribute('aria-label', `${String.fromCharCode(65 + index % next.size)}${Math.floor(index / next.size) + 1}`);
        square.disabled = cell !== 0 || next.result !== 'playing' || next.turn !== next.seat;
        if (cell) { const stone = document.createElement('span'); stone.className = cell === 1 ? 'stone' : 'stone white'; square.appendChild(stone); }
        square.onclick = () => send('game.move', { x: index % next.size, y: Math.floor(index / next.size), revision: next.revision }); fragment.appendChild(square);
    });
    board.replaceChildren(fragment);
}
