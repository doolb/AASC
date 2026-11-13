import { modules as productionModules, defaultGame } from '../../games/modules';

// 此模块仅通过测试打包别名注入，不进入正式游戏目录或 APK。
class TestHost {
    constructor(storage, room, name, publish, reject) {
        this.publish = publish; this.reject = reject;
        this.state = { result: 'waiting', revision: 0, lastSeat: -1, players: [{ name, online: true }, { name: '', online: false }, { name: '', online: false }] };
    }
    presence(payload) {
        for (const player of payload.players) if (player.seat > 0) this.state.players[player.seat] = { name: player.name, online: player.online };
        this.publish(this.state);
    }
    apply(seat, topic) {
        if (topic !== 'game.pulse') { this.reject(seat, '无效操作'); return; }
        this.state.revision++; this.state.lastSeat = seat; this.publish(this.state);
    }
}
function init({ element, send }) {
    element('gameArea').innerHTML = '<button id="test-pulse">测试操作</button><p id="test-state"></p>';
    element('test-pulse').onclick = () => send('game.pulse', {});
}
function render(state, { element }) { element('test-state').textContent = `${state.seat}:${state.lastSeat}:${state.players.filter(player => player.online).length}`; }
export const modules = { ...productionModules, 'test-three': { id: 'test-three', name: '测试三人游戏', version: 2, minPlayers: 3, maxPlayers: 3, actions: ['game.pulse'], Host: TestHost, init, render } };
export { defaultGame };
