(function exposeDisplayGame(root) {
    const refs = {};
    let game = null;
    let send = () => false;
    let pending = false;

    function resize({ width, height, rotation }) {
        const layer = refs.layer;
        if (!layer) return;
        layer.style.inset = 'auto';
        layer.style.left = '50%';
        layer.style.top = '50%';
        layer.style.width = `${width}px`;
        layer.style.height = `${height}px`;
        layer.style.transformOrigin = 'center center';
        layer.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    }

    function setStatus(text) {
        if (refs.status) refs.status.textContent = text;
    }

    function turnLabel() {
        if (!game) return '';
        const label = game.result === 'User胜' ? '你赢了'
            : game.result === 'AI胜' ? 'AI 赢了'
                : game.result === '平局' ? '平局'
                    : game.turn === 'User' ? '轮到你（黑子）' : 'AI 思考中（白子）';
        return game.demo === true ? `演示 · ${label}` : label;
    }

    function refreshView() {
        if (!game || !refs.layer) return;
        refs.layer.hidden = false;
        refs.shell.hidden = game.visible === false;
        refs.reopen.hidden = game.visible !== false;
        refs.layer.setAttribute('aria-hidden', String(game.visible === false));
        setStatus(turnLabel());
        refs.board.querySelectorAll('.display-game-point').forEach(button => {
            const playable = game.demo !== true && game.result === '进行中' && game.turn === 'User'
                && !pending && button.dataset.stone === '.';
            button.disabled = !playable;
        });
    }

    function requestRecovery() {
        pending = false;
        setStatus('正在同步棋盘…');
        send({ type: 'gameRecover' });
    }

    function isStar(x, y, size) {
        const points = size === 15 ? [3, 7, 11] : size === 13 ? [3, 6, 9]
            : size === 11 ? [2, 5, 8] : [2, 4, 6];
        return points.includes(x) && points.includes(y);
    }

    function buildBoard() {
        refs.board.style.setProperty('--game-size', String(game.size));
        const fragment = document.createDocumentFragment();
        const rows = game.board.split('/');
        for (let y = 0; y < game.size; y += 1) {
            for (let x = 0; x < game.size; x += 1) {
                const button = document.createElement('button');
                const coordinate = `${String.fromCharCode(65 + x)}${y + 1}`;
                const stone = rows[y]?.[x] || '.';
                button.type = 'button';
                button.className = 'display-game-point';
                button.dataset.coordinate = coordinate;
                button.dataset.stone = stone;
                button.dataset.star = String(isStar(x, y, game.size));
                button.setAttribute('role', 'gridcell');
                button.setAttribute('aria-label', `${coordinate} ${stone === 'X' ? '黑子' : stone === 'O' ? '白子' : '空位'}`);
                const disk = document.createElement('span');
                disk.className = 'display-game-stone';
                button.appendChild(disk);
                fragment.appendChild(button);
            }
        }
        refs.board.replaceChildren(fragment);
    }

    function handleMessage(message) {
        if (!message || !['gameSnapshot', 'gameDelta', 'gameVisibility', 'gameProposal', 'gameError',
            'gameDemoEnd'].includes(message.type)) return false;
        if (message.type === 'gameDemoEnd') {
            if (game?.demo === true && game.gameId === message.gameId) {
                game = null;
                pending = false;
                refs.layer.hidden = true;
                refs.shell.hidden = true;
                refs.reopen.hidden = true;
                refs.layer.setAttribute('aria-hidden', 'true');
            }
            return true;
        }
        if (message.type === 'gameError') {
            pending = false;
            if (message.code === '版本过期') requestRecovery();
            else {
                refreshView();
                setStatus(`操作失败：${message.code || '未知错误'}`);
            }
            return true;
        }
        if (message.type === 'gameSnapshot') {
            const rows = String(message.board || '').split('/');
            if (!Number.isInteger(message.size) || rows.length !== message.size
                || rows.some(row => row.length !== message.size || /[^.XO]/.test(row))) return true;
            game = { ...message };
            pending = false;
            buildBoard();
            refreshView();
            return true;
        }
        if (!game || message.gameId !== game.gameId || message.revision !== game.revision + 1) {
            requestRecovery();
            return true;
        }
        game.revision = message.revision;
        if (message.type === 'gameDelta') {
            const point = refs.board.querySelector(`[data-coordinate="${message.coordinate}"]`);
            if (!point || point.dataset.stone !== '.') {
                requestRecovery();
                return true;
            }
            point.dataset.stone = message.actor === 'User' ? 'X' : 'O';
            point.setAttribute('aria-label', `${message.coordinate} ${message.actor === 'User' ? '黑子' : '白子'}`);
            game.turn = message.turn;
            game.result = message.result;
        } else if (message.type === 'gameVisibility') {
            game.visible = message.visible;
        } else if (message.type === 'gameProposal') {
            game.pendingSize = message.pendingSize;
        }
        pending = false;
        refreshView();
        return true;
    }

    function init() {
        const stage = root.DisplayStage;
        if (!stage) return;
        const bus = stage.getBus();
        send = stage.send;
        refs.layer = document.getElementById('displayGameLayer');
        refs.shell = document.getElementById('displayGameShell');
        refs.board = document.getElementById('displayGameBoard');
        refs.status = document.getElementById('displayGameStatus');
        refs.reopen = document.getElementById('displayGameReopen');
        if (!refs.layer || !refs.board) return;
        bus.subscribe('server.message', handleMessage);
        bus.subscribe('stage.resize', resize);
        bus.subscribe('transport.changed', ({ available }) => { if (available && game) requestRecovery(); });
        refs.board.addEventListener('click', event => {
            const point = event.target.closest('.display-game-point');
            if (!point || !game || game.demo === true || pending || game.turn !== 'User'
                || game.result !== '进行中') return;
            pending = true;
            refreshView();
            const sent = send({ type: 'gameMove', coordinate: point.dataset.coordinate,
                revision: game.revision, requestId: `game-${Date.now()}` });
            if (!sent) { pending = false; setStatus('连接中断，请重试'); refreshView(); }
        });
        document.getElementById('displayGameClose')?.addEventListener('click', () => {
            if (game && game.demo !== true) send({ type: 'gameView', visible: false, revision: game.revision });
        });
        refs.reopen.addEventListener('click', () => {
            if (game && game.demo !== true) send({ type: 'gameView', visible: true, revision: game.revision });
        });
        const state = stage.getState();
        if (state.rotationGeometry) resize({ width: state.rotationGeometry.logicalWidth,
            height: state.rotationGeometry.logicalHeight, rotation: state.rotationGeometry.rotation });
        // 页面脚本可能在舞台订阅前已收到首连快照，因此主动补拉一次权威状态。
        send({ type: 'gameRecover' });
    }

    root.DisplayGame = Object.freeze({ init, handleMessage });
    root.addEventListener('display-stage-ready', init, { once: true });
})(window);
