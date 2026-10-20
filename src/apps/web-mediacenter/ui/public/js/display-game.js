(function exposeDisplayGame(root) {
    const SUPPORTED_GAMES = Object.freeze(['五子棋']);
    const refs = {};
    let game = null;
    let send = () => false;
    let pending = false;
    let conversationState = 'waitingWake';

    function isConversationActive() {
        return conversationState === 'activeGroup' || conversationState === 'activePrivate';
    }

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

    function activeGame() {
        return game?.demo !== true && game?.result === '进行中' && isConversationActive();
    }

    function refreshMenu() {
        if (!refs.toggle || !refs.list) return;
        refs.toggle.textContent = activeGame() ? '五子棋' : '游戏';
        for (const button of refs.list.querySelectorAll('[data-game-name]')) {
            const name = button.dataset.gameName;
            let status = '未开局';
            if (name === '五子棋' && game?.demo !== true && game) {
                status = !isConversationActive() ? '等待对话'
                    : game.result !== '进行中' ? '已结束'
                        : game.visible === false ? '已隐藏' : '进行中';
            }
            button.querySelector('.display-game-list-status').textContent = status;
        }
    }

    function setMenuOpen(open) {
        if (!refs.menu || !refs.toggle) return;
        refs.menu.hidden = !open;
        refs.toggle.setAttribute('aria-expanded', String(open));
        if (open) refreshMenu();
    }

    function refreshView() {
        refreshMenu();
        if (!game || !refs.layer) return;
        // 演示独立展示；真实棋盘只在当前 AI 对话活动时可见，隐藏不会改写棋局。
        const available = game.demo === true || isConversationActive();
        refs.layer.hidden = !available;
        refs.shell.hidden = !available || game.visible === false;
        refs.layer.setAttribute('aria-hidden', String(!available));
        setStatus(turnLabel());
        refs.board.querySelectorAll('.display-game-point').forEach(button => {
            const playable = available && game.visible !== false && game.demo !== true
                && game.result === '进行中' && game.turn === 'User'
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
        if (message?.type === 'voiceConversationState') {
            conversationState = message.state || 'waitingWake';
            refreshView();
            if (!isConversationActive()) setMenuOpen(false);
            // 语音模块还需要处理该事件，不能由游戏层独占。
            return false;
        }
        if (!message || !['gameSnapshot', 'gameDelta', 'gameVisibility', 'gameProposal', 'gameError',
            'gameDemoEnd'].includes(message.type)) return false;
        if (message.type === 'gameDemoEnd') {
            if (game?.demo === true && game.gameId === message.gameId) {
                game = null;
                pending = false;
                refs.layer.hidden = true;
                refs.shell.hidden = true;
                refs.layer.setAttribute('aria-hidden', 'true');
                refreshMenu();
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
            // 演示和真实棋局共用权威增量；减少动态效果时直接显示最终棋子。
            if (!root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
                const stone = point.querySelector('.display-game-stone');
                if (stone) {
                    point.classList.add('is-placing');
                    stone.addEventListener('animationend', () => point.classList.remove('is-placing'),
                        { once: true });
                }
            }
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
        refs.toggle = document.getElementById('displayGameToggle');
        refs.menu = document.getElementById('displayGameMenu');
        refs.list = document.getElementById('displayGameList');
        refs.hint = document.getElementById('displayGameMenuHint');
        refs.actions = document.getElementById('displayGameChatActions');
        if (!refs.layer || !refs.board) return;
        if (refs.list) {
            // 游戏目录与本显示端向服务端声明的能力共用同一列表。
            const fragment = document.createDocumentFragment();
            for (const name of SUPPORTED_GAMES) {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.gameName = name;
                const title = document.createElement('span');
                title.textContent = name;
                const status = document.createElement('small');
                status.className = 'display-game-list-status';
                button.append(title, status);
                fragment.appendChild(button);
            }
            refs.list.replaceChildren(fragment);
        }
        bus.subscribe('server.message', handleMessage);
        bus.subscribe('stage.resize', resize);
        // 首次初始化可能早于 WebSocket OPEN；本地无棋盘时重连也必须补拉服务端旧棋局。
        bus.subscribe('transport.changed', ({ available }) => { if (available) requestRecovery(); });
        bus.subscribe('chat.visibility', ({ visible }) => { if (visible) setMenuOpen(false); });
        refs.toggle?.addEventListener('click', () => setMenuOpen(refs.menu.hidden));
        refs.list?.addEventListener('click', event => {
            const entry = event.target.closest('[data-game-name]');
            if (!entry || entry.dataset.gameName !== '五子棋') return;
            if (!game || game.demo === true) {
                refs.hint.textContent = '请在聊天中告诉 AI 开始五子棋';
                return;
            }
            if (!isConversationActive()) {
                refs.hint.textContent = '进入 AI 对话后可查看棋盘';
                return;
            }
            if (game.visible === false) {
                if (!send({ type: 'gameView', visible: true, revision: game.revision })) {
                    refs.hint.textContent = '连接中断，请重试';
                    return;
                }
            }
            setMenuOpen(false);
        });
        document.addEventListener('pointerdown', event => {
            if (!refs.menu?.hidden && !refs.actions?.contains(event.target)) setMenuOpen(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') setMenuOpen(false);
        });
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
        const state = stage.getState();
        conversationState = state.voiceConversationState || 'waitingWake';
        refreshMenu();
        if (state.rotationGeometry) resize({ width: state.rotationGeometry.logicalWidth,
            height: state.rotationGeometry.logicalHeight, rotation: state.rotationGeometry.rotation });
        // 页面脚本可能在舞台订阅前已收到首连快照，因此主动补拉一次权威状态。
        send({ type: 'gameRecover' });
    }

    root.DisplayGame = Object.freeze({ init, handleMessage, supportedGames: SUPPORTED_GAMES });
    root.addEventListener('display-stage-ready', init, { once: true });
})(window);
