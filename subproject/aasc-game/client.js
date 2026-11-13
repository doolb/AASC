import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { modules, defaultGame } from './games/modules';

const element = id => document.getElementById(id);
const notice = text => { element('notice').textContent = text; };
const params = new URLSearchParams(location.search);
const isRelay = params.get('relay') === '1';
const roomId = params.get('room') || '';
const gameId = params.get('game') || defaultGame;
const protocolVersion = params.has('version') ? Number(params.get('version')) : (gameId === defaultGame ? 1 : NaN);
const gameModule = Object.prototype.hasOwnProperty.call(modules, gameId) ? modules[gameId] : null;
const compatibleGame = gameModule && gameModule.version === protocolVersion && (!params.has('version') || params.get('version') === String(protocolVersion));
const isRoom = (location.protocol === 'http:' || location.protocol === 'https:') && (!isRelay || Boolean(roomId));
let stream = null;
let socket = null;
let state = null;
let manager = null;
let pausedGame = false;
// getRandomValues 在局域网 HTTP 下可用，randomUUID 则要求安全上下文。
function randomId() {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

/** 二维码只接受局域网房间地址，避免扫码跳转到其他协议。 */
function roomUrl(value) {
    const raw = value.trim();
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const room = url.searchParams.get('room');
    const requestedGame = url.searchParams.get('game');
    const requestedVersion = url.searchParams.get('version');
    const validGame = !requestedGame || /^[a-z][a-z0-9-]{0,31}$/.test(requestedGame);
    const validVersion = !requestedVersion || /^[1-9][0-9]*$/.test(requestedVersion);
    const validQuery = !url.search || (url.searchParams.get('relay') === '1' && (!room || /^[a-f0-9]{32}$/.test(room)) && validGame && validVersion && [...url.searchParams.keys()].every(key => ['relay', 'room', 'game', 'version'].includes(key)));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || !validQuery || url.hash) throw new Error('请使用有效的游戏房间地址');
    return url.href;
}
function navigate(value) {
    try { location.href = roomUrl(value); } catch (error) { notice(error.message); }
}
element('join').onclick = () => navigate(element('address').value);
element('otherRoom').onclick = () => { element('lobby').hidden = !element('lobby').hidden; };
if (isRelay && !roomId) {
    const select = element('gameSelect');
    for (const game of Object.values(modules)) { const option = document.createElement('option'); option.value = game.id; option.textContent = game.name; select.appendChild(option); }
    element('gamePicker').hidden = false;
    element('relayHost').hidden = false;
    element('relayHost').onclick = () => {
        const game = modules[select.value];
        if (!game) { notice('未知游戏'); return; }
        const room = randomId();
        localStorage.setItem(`aasc-game-host-${room}`, randomId());
        localStorage.setItem(`aasc-game-meta-${room}`, JSON.stringify({ gameId: game.id, protocolVersion: game.version }));
        location.href = `/?relay=1&room=${room}&game=${encodeURIComponent(game.id)}&version=${game.version}`;
    };
}
if (window.AascNative) {
    element('host').hidden = false;
    element('host').onclick = () => {
        const result = window.AascNative.startHost();
        if (result.startsWith('ERROR:')) notice(result.slice(6)); else location.href = result;
    };
}
function stopScan() {
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null; element('video').hidden = true; element('stopScan').hidden = true;
}
element('stopScan').onclick = stopScan;
function decodeImage(image) {
    const canvas = document.createElement('canvas'); canvas.width = image.videoWidth || image.width; canvas.height = image.videoHeight || image.height;
    if (!canvas.width || !canvas.height) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(pixels.data, pixels.width, pixels.height)?.data || null;
}
element('scan').onclick = async () => {
    try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前网页无法调用摄像头，请使用系统相机扫码或选择二维码图片');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = element('video'); video.srcObject = stream; video.hidden = false; element('stopScan').hidden = false; await video.play();
        const tick = () => { if (!stream) return; const found = decodeImage(video); if (found) { stopScan(); navigate(found); } else requestAnimationFrame(tick); }; tick();
    } catch (error) { stopScan(); notice(error.message); }
};
element('image').onchange = event => {
    const file = event.target.files[0]; if (!file) return;
    const image = new Image(); const url = URL.createObjectURL(file);
    image.onload = () => { const found = decodeImage(image); URL.revokeObjectURL(url); if (found) navigate(found); else notice('未识别到二维码'); };
    image.onerror = () => { URL.revokeObjectURL(url); notice('无法读取图片'); }; image.src = url;
};
function sendRaw(topic, payload = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) { notice('连接已断开'); return; }
    socket.send(JSON.stringify({ id: randomId(), version: '1.0', type: 'command', timestamp: Date.now(), source: { ip: 'client', role: 'control', name: 'player' }, topic, payload }));
}
function send(topic, payload = {}) {
    if (!isRelay || !topic.startsWith('game.')) { sendRaw(topic, payload); return; }
    if (!socket || socket.readyState !== WebSocket.OPEN) { notice('连接已断开'); return; }
    if (manager) manager.apply(0, topic, payload);
    else sendRaw('relay.action', { topic, payload });
}
function render(next) {
    if ((next.gameId && next.gameId !== gameId) || (next.protocolVersion !== undefined && next.protocolVersion !== protocolVersion)) { notice('棋局游戏或协议版本不匹配'); return; }
    element('gameArea').removeAttribute('inert'); element('gameArea').removeAttribute('aria-disabled'); element('gameArea').style.pointerEvents = '';
    if (pausedGame) { notice(''); pausedGame = false; }
    state = next; gameModule.render(next, { element, send });
}
// 离线状态由平台禁用整个游戏区域，不改写具体游戏的状态字段。
function pauseGame(message) {
    notice(message);
    if (!isRoom || !compatibleGame) return;
    pausedGame = true;
    element('gameArea').setAttribute('inert', ''); element('gameArea').setAttribute('aria-disabled', 'true'); element('gameArea').style.pointerEvents = 'none';
}
let bindingValid = true;
if (isRelay && roomId && localStorage.getItem(`aasc-game-host-${roomId}`)) {
    try {
        const saved = localStorage.getItem(`aasc-game-meta-${roomId}`);
        const binding = saved ? JSON.parse(saved) : { gameId: defaultGame, protocolVersion: 1 };
        bindingValid = binding?.gameId === gameId && binding?.protocolVersion === protocolVersion;
        if (bindingValid && !saved) localStorage.setItem(`aasc-game-meta-${roomId}`, JSON.stringify(binding));
    } catch (_) { bindingValid = false; }
}
if (isRoom && !compatibleGame) notice('未知游戏或游戏协议版本不兼容');
if (isRoom && compatibleGame && !bindingValid) notice('房间游戏与已保存的房主信息不匹配');
if (isRoom && compatibleGame && bindingValid) {
    element('lobby').hidden = true; element('room').hidden = false;
    gameModule.init({ element, send });
    const hostKey = isRelay ? localStorage.getItem(`aasc-game-host-${roomId}`) || '' : params.get('host') || '';
    if (isRelay && hostKey) {
        const address = `${location.origin}/?relay=1&room=${roomId}&game=${encodeURIComponent(gameId)}&version=${protocolVersion}`;
        element('invite').hidden = false; element('roomAddress').textContent = address;
        QRCode.toCanvas(element('qr'), address, { width: 180, margin: 2 }).catch(error => notice(error.message));
    }
    if (hostKey && params.get('address')) {
        const address = `http://${params.get('address')}/`; element('invite').hidden = false; element('roomAddress').textContent = address;
        QRCode.toCanvas(element('qr'), address, { width: 180, margin: 2 }).catch(error => notice(error.message));
    }
    let token = localStorage.getItem('aasc-game-token');
    if (!token) { token = randomId(); localStorage.setItem('aasc-game-token', token); }
    let name = localStorage.getItem('aasc-game-name');
    if (!name) { name = (prompt('请输入昵称', hostKey ? '房主' : '玩家') || '玩家').trim().slice(0, 24) || '玩家'; localStorage.setItem('aasc-game-name', name); }
    if (isRelay && hostKey) manager = new gameModule.Host(localStorage, roomId, name, value => sendRaw('relay.snapshot', { state: value }), (seat, message) => seat === 0 ? notice(message) : sendRaw('relay.error', { seat, message }));
    const connect = () => {
        let ready = false;
        socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${isRelay ? '/relay' : '/'}`);
        socket.onopen = () => {
            notice('');
            if (isRelay) sendRaw(hostKey ? 'relay.host' : 'relay.join', hostKey ? { room: roomId, key: hostKey, gameId, protocolVersion } : { room: roomId, token, name, gameId, protocolVersion });
            else sendRaw('game.join', { token, name, hostKey, gameId, protocolVersion });
        };
        socket.onmessage = event => {
            try {
                const message = JSON.parse(event.data);
                if (message.topic === 'relay.ready') { if (message.payload.gameId && (message.payload.gameId !== gameId || message.payload.protocolVersion !== protocolVersion)) throw Error('游戏版本不匹配'); ready = true; notice(''); }
                if (message.topic === 'relay.presence' && manager) manager.presence(message.payload);
                if (message.topic === 'relay.action' && manager) manager.apply(message.payload.seat, message.payload.topic, message.payload.payload);
                if (message.topic === 'relay.paused') pauseGame(message.payload.message);
                if (message.topic === 'game.snapshot') render(message.payload);
                if (message.topic === 'game.error') { notice(message.payload.message); if (isRelay && !ready) setTimeout(() => socket.close(), 2000); }
            } catch (_) { notice('收到无效消息'); }
        };
        socket.onclose = () => { pauseGame('连接断开，正在重连'); setTimeout(connect, 2000); };
    };
    connect();
}
