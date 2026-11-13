'use strict';

// 客户端和中转读取同一份声明，避免不同实现对人数与协议版本产生分歧。
const games = Object.freeze({
    gomoku: Object.freeze({ id: 'gomoku', name: '五子棋', version: 1, minPlayers: 2, maxPlayers: 2, actions: Object.freeze(['game.move', 'game.start', 'game.config']) })
});
module.exports = { games, defaultGame: 'gomoku' };
