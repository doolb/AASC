/** 房主端权威棋局：中转只分发已绑定座位的命令。 */
export class GameHost {
    constructor(storage, room, name, publish, reject) {
        this.storage = storage; this.key = `aasc-game-room-${room}`; this.publish = publish; this.reject = reject;
        const fresh = { size: 15, revision: 0, turn: 0, result: 'waiting', board: Array(225).fill(0), players: [{ name, online: true }, { name: '', online: false }] };
        try {
            const value = JSON.parse(storage.getItem(this.key));
            this.state = value && [9, 11, 13, 15].includes(value.size) && Array.isArray(value.board) && value.board.length === value.size ** 2 && value.board.every(cell => [0, 1, 2].includes(cell)) && Number.isSafeInteger(value.revision) && ['waiting', 'playing', 'black', 'white', 'draw'].includes(value.result) && [0, 1].includes(value.turn) && Array.isArray(value.players) && value.players.length === 2 ? value : fresh;
        } catch (_) { this.state = fresh; }
        this.state.players[0] = { name, online: true };
        this.state.players[1].online = false;
    }
    sync() {
        try { this.storage.setItem(this.key, JSON.stringify(this.state)); }
        catch (_) { this.reject(0, '保存棋局失败'); return; }
        this.publish(this.state);
    }
    presence(payload) {
        this.state.players[1] = { name: payload.guestName || this.state.players[1].name, online: payload.guestOnline === true };
        this.sync();
    }
    apply(seat, topic, payload = {}) {
        const state = this.state;
        const fail = message => this.reject(seat, message);
        const actions = {
            'game.config': () => {
                if (seat !== 0 || state.result === 'playing' || ![9, 11, 13, 15].includes(payload.size)) return fail('无法修改尺寸');
                state.size = payload.size; state.board = Array(state.size ** 2).fill(0); state.result = 'waiting'; state.revision++; this.sync();
            },
            'game.start': () => {
                if (seat !== 0 || !state.players[1].online || state.result === 'playing') return fail('需要两人在线且当前没有进行中的棋局');
                state.board = Array(state.size ** 2).fill(0); state.turn = 0; state.result = 'playing'; state.revision++; this.sync();
            },
            'game.move': () => {
                const { x, y, revision } = payload;
                if (!state.players[1].online || state.result !== 'playing' || seat !== state.turn || revision !== state.revision || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.size || y >= state.size || state.board[y * state.size + x]) return fail('落子无效，请检查回合或同步状态');
                const color = seat + 1; state.board[y * state.size + x] = color;
                if (this.wins(x, y, color)) state.result = seat === 0 ? 'black' : 'white';
                else if (state.board.every(Boolean)) state.result = 'draw';
                else state.turn = 1 - seat;
                state.revision++; this.sync();
            }
        };
        if (actions[topic]) actions[topic](); else fail('操作无效');
    }
    wins(x, y, color) {
        const { board, size } = this.state;
        return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => {
            let count = 1;
            for (const direction of [-1, 1]) {
                let nx = x + direction * dx, ny = y + direction * dy;
                while (nx >= 0 && ny >= 0 && nx < size && ny < size && board[ny * size + nx] === color) { count++; nx += direction * dx; ny += direction * dy; }
            }
            return count >= 5;
        });
    }
}
