'use strict';

// 仅在测试注入注册表，模拟三人游戏及不同的游戏操作。
const game = Object.freeze({ id: 'test-three', name: '测试用三人游戏', version: 2, minPlayers: 3, maxPlayers: 3, actions: ['game.pulse'] });
function apply(state, seat, topic) {
    if (topic !== 'game.pulse' || seat < 1 || seat > 2) throw new Error('测试操作无效');
    return { revision: state.revision + 1, lastSeat: seat };
}
module.exports = { game, apply };
