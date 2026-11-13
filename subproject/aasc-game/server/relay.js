'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const catalog = require('../games/catalog');

const assets = path.join(__dirname, '../app/src/main/assets');
const files = new Map([['/index.html', 'text/html'], ['/app.js', 'application/javascript'], ['/style.css', 'text/css'], ['/third-party-licenses.txt', 'text/plain']]);
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const message = (topic, payload = {}) => JSON.stringify({ id: crypto.randomUUID(), version: '1.0', type: 'event', timestamp: Date.now(), source: { ip: 'server', role: 'server', name: 'relay' }, topic, payload });

/** 中转只绑定身份和转发消息，不代替房主决定棋局。 */
function createRelay({ games = catalog.games, assetDir = assets } = {}) {
    const rooms = new Map();
    const resolveGame = payload => {
        const id = payload.gameId === undefined ? catalog.defaultGame : payload.gameId;
        if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(games, id)) throw Error('未知游戏');
        const game = games[id];
        const version = payload.protocolVersion === undefined && id === catalog.defaultGame ? 1 : payload.protocolVersion;
        if (!Number.isSafeInteger(version) || version !== game.version) throw Error('游戏协议版本不兼容');
        if (!Number.isInteger(game.minPlayers) || !Number.isInteger(game.maxPlayers) || game.minPlayers < 1 || game.maxPlayers < game.minPlayers || game.maxPlayers > 16 || !Array.isArray(game.actions)) throw Error('游戏配置无效');
        return game;
    };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://local');
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
        if (url.pathname === '/' && !url.searchParams.has('relay')) { res.writeHead(302, { Location: '/?relay=1' }).end(); return; }
        const file = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!files.has(file)) { res.writeHead(404).end(); return; }
        try {
            const data = fs.readFileSync(path.join(assetDir, file));
            res.writeHead(200, { 'Content-Type': `${files.get(file)}; charset=utf-8`, 'Cache-Control': 'no-store', 'Content-Length': data.length });
            res.end(req.method === 'HEAD' ? undefined : data);
        } catch (_) { res.writeHead(500).end(); }
    });
    const wss = new WebSocketServer({ server, path: '/relay', maxPayload: 8192, perMessageDeflate: false });
    const send = (ws, topic, payload) => { if (ws?.readyState === WebSocket.OPEN) ws.send(message(topic, payload)); };
    const presence = room => {
        const players = room.seats.map((entry, seat) => ({ seat, name: entry?.name || '', online: Boolean(entry?.socket) }));
        send(room.host, 'relay.presence', { players, guestOnline: players[1]?.online || false, guestName: players[1]?.name || '' });
    };
    const eachGuest = (room, callback) => { for (let seat = 1; seat < room.seats.length; seat++) if (room.seats[seat]?.socket) callback(room.seats[seat].socket, seat); };
    const disconnect = ws => {
        const room = ws.room;
        if (!room) return;
        if (room.host === ws) { room.host = null; eachGuest(room, guest => send(guest, 'relay.paused', { message: '房主离线，等待重连' })); }
        if (ws.seat > 0 && room.seats[ws.seat]?.socket === ws) { room.seats[ws.seat].socket = null; presence(room); }
        room.touched = Date.now();
    };
    const handlers = {
        'relay.host': (ws, payload) => {
            if (ws.room || !validId(payload.room) || !validId(payload.key)) throw Error('房间身份无效');
            const game = resolveGame(payload);
            let room = rooms.get(payload.room);
            if (!room) {
                if (rooms.size >= 100) throw Error('房间数量已达上限');
                room = { id: payload.room, key: payload.key, game, host: null, seats: Array(game.maxPlayers).fill(null), touched: Date.now() };
                rooms.set(room.id, room);
            }
            if (room.key !== payload.key || room.host) throw Error('房主身份无效或已在线');
            if (room.game.id !== game.id || room.game.version !== game.version) throw Error('房间游戏不匹配');
            room.host = ws; ws.room = room; ws.seat = 0; room.touched = Date.now();
            room.seats[0] = { socket: ws, name: '', token: null };
            send(ws, 'relay.ready', { seat: 0, gameId: game.id, protocolVersion: game.version }); presence(room);
            eachGuest(room, guest => send(guest, 'relay.resumed', {}));
        },
        'relay.join': (ws, payload) => {
            if (ws.room || !validId(payload.room) || !validId(payload.token) || typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 24) throw Error('玩家身份无效');
            const room = rooms.get(payload.room);
            if (!room?.host) throw Error('房间未开放，等待房主');
            const game = resolveGame(payload);
            if (room.game.id !== game.id || room.game.version !== game.version) throw Error('房间游戏不匹配');
            let seat = room.seats.findIndex((entry, index) => index > 0 && entry?.token === payload.token);
            if (seat < 0) seat = room.seats.findIndex((entry, index) => index > 0 && !entry);
            if (seat < 0 || room.seats[seat]?.socket) throw Error('玩家座位已被占用');
            room.seats[seat] = { token: payload.token, name: payload.name.trim(), socket: ws }; ws.room = room; ws.seat = seat; room.touched = Date.now();
            send(ws, 'relay.ready', { seat, gameId: game.id, protocolVersion: game.version }); presence(room);
        },
        'relay.action': (ws, payload) => {
            if (!ws.room || ws.seat < 1 || !ws.room.host) throw Error('房主离线');
            if (!ws.room.game.actions.includes(payload.topic) || !payload.payload || typeof payload.payload !== 'object' || Array.isArray(payload.payload)) throw Error('操作无效');
            send(ws.room.host, 'relay.action', { seat: ws.seat, topic: payload.topic, payload: payload.payload, gameId: ws.room.game.id, protocolVersion: ws.room.game.version });
        },
        'relay.snapshot': (ws, payload) => {
            if (!ws.room || ws.seat !== 0 || !payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw Error('快照无效');
            const snapshot = { ...payload.state, gameId: ws.room.game.id, protocolVersion: ws.room.game.version };
            send(ws, 'game.snapshot', { ...snapshot, seat: 0 });
            eachGuest(ws.room, (guest, seat) => send(guest, 'game.snapshot', { ...snapshot, seat }));
        },
        'relay.error': (ws, payload) => {
            if (!ws.room || ws.seat !== 0 || typeof payload.message !== 'string') throw Error('错误消息无效');
            const seat = payload.seat === undefined ? 1 : payload.seat;
            if (!Number.isInteger(seat) || seat < 1 || seat >= ws.room.seats.length) throw Error('座位无效');
            send(ws.room.seats[seat]?.socket, 'game.error', { message: payload.message.slice(0, 120) });
        }
    };
    wss.on('connection', (ws, req) => {
        const origin = req.headers.origin;
        if (origin) {
            try { if (new URL(origin).host !== req.headers.host) { ws.close(1008, 'origin'); return; } }
            catch (_) { ws.close(1008, 'origin'); return; }
        }
        let count = 0; let windowStart = Date.now();
        ws.on('message', data => {
            try {
                if (Date.now() - windowStart > 10000) { windowStart = Date.now(); count = 0; }
                if (++count > 100) { ws.close(1008, 'rate'); return; }
                const input = JSON.parse(data.toString());
                if (input.type !== 'command' || !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload) || !Object.prototype.hasOwnProperty.call(handlers, input.topic)) throw Error('消息无效');
                handlers[input.topic](ws, input.payload);
            } catch (error) { send(ws, 'game.error', { message: error.message }); }
        });
        ws.on('close', () => disconnect(ws));
        ws.on('error', () => ws.close());
    });
    const cleanup = setInterval(() => {
        for (const [id, room] of rooms) if (!room.host && !room.seats.some((entry, seat) => seat > 0 && entry?.socket) && Date.now() - room.touched > 3600000) rooms.delete(id);
    }, 60000); cleanup.unref();
    server.on('close', () => { clearInterval(cleanup); wss.close(); });
    return { server, wss };
}
if (require.main === module) {
    const bind = process.env.AASC_GAME_BIND || '127.0.0.1';
    const port = Number(process.env.AASC_GAME_PORT || 8787);
    createRelay().server.listen(port, bind, () => console.log(`AASC 游戏中转运行于 http://${bind}:${port}/`));
}
module.exports = { createRelay };
