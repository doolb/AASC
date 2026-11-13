import catalog from './catalog';
import { GameHost } from './gomoku/host';
import { initGomoku, renderGomoku } from './gomoku/view';

// 正式模块与目录逐项绑定；不存在或版本不匹配时拒绝加入。
export const modules = Object.freeze({ gomoku: Object.freeze({ ...catalog.games.gomoku, Host: GameHost, init: initGomoku, render: renderGomoku }) });
export const defaultGame = catalog.defaultGame;
