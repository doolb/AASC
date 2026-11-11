'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildDisplayPlaylistStart, createDisplayPlaylistRequestHandler
} = require('../src/apps/server/modules/media/display-local-media');

function createWs(address) {
    return {
        _socket: { remoteAddress: address },
        sent: [],
        send(payload) { this.sent.push(JSON.parse(payload)); }
    };
}

test('批量播放开始数据固定不循环、不递归、只发给请求方', () => {
    const startData = buildDisplayPlaylistStart({
        playlist: [{ url: '/a.mp4', fileName: 'a.mp4', mediaType: 'video' }],
        displayId: 'display-1'
    });
    assert.match(startData.listId, /^pl-\d+-[a-z0-9]+$/);
    assert.equal(startData.loop, false);
    assert.equal(startData.interval, 5);
    assert.equal(startData.announceName, false);
    assert.deepEqual(startData.selectedDisplayIds, ['display-1']);
    assert.deepEqual(startData.selectedVoiceDisplayIds, []);
    assert.deepEqual(startData.voiceRouteByDisplayId, {});
});

test('非回环连接被拒绝且不生成列表', async () => {
    const ws = createWs('192.168.1.20');
    const displayData = { state: {}, ws };
    let built = 0;
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'local1', type: 'local' }],
        buildPlaylist: async () => { built++; return []; },
        getDisplayData: () => displayData,
        persist: () => {},
        sendToDisplay: () => {}
    });
    await handler('display-1', { libraryId: 'local1', path: '/' }, ws);
    assert.equal(built, 0);
    assert.deepEqual(ws.sent, [{ type: 'displayPlaylistError', message: '仅限本机使用' }]);
});

test('回环连接生成列表、持久化状态并只发送给请求方', async () => {
    const ws = createWs('::ffff:7f00:1');
    const displayData = { state: {}, ws };
    const sent = [];
    const persisted = [];
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'local1', type: 'local' }],
        buildPlaylist: async (libraryId, dirPath) => {
            assert.equal(libraryId, 'local1');
            assert.equal(dirPath, '/电影/合集A');
            return [{ url: '/a.mp4', path: '/电影/合集A/a.mp4', fileName: 'a.mp4', mediaType: 'video' }];
        },
        getDisplayData: () => displayData,
        persist: (data, partial) => persisted.push(partial),
        sendToDisplay: (displayId, message) => sent.push({ displayId, message })
    });
    await handler('display-1', { libraryId: 'local1', path: '/电影/合集A' }, ws);
    assert.equal(ws.sent.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].displayId, 'display-1');
    assert.equal(sent[0].message.type, 'playlistStart');
    assert.equal(sent[0].message.loop, false);
    assert.equal(sent[0].message.playlist.length, 1);
    assert.equal(displayData.state.currentPlaylist.index, 0);
    assert.equal(displayData.state.currentPlaylist.startData.listId, sent[0].message.listId);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].currentPlaylist.startData.playlist.length, 1);
});

test('空目录返回错误且不发送空列表', async () => {
    const ws = createWs('127.0.0.1');
    const displayData = { state: {}, ws };
    const sent = [];
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'local1', type: 'local' }],
        buildPlaylist: async () => [],
        getDisplayData: () => displayData,
        persist: () => {},
        sendToDisplay: (...args) => sent.push(args)
    });
    await handler('display-1', { libraryId: 'local1', path: '/空目录' }, ws);
    assert.equal(sent.length, 0);
    assert.deepEqual(ws.sent, [{ type: 'displayPlaylistError', message: '该目录没有可播放的媒体' }]);
});

test('生成列表异常时返回统一错误文案', async () => {
    const ws = createWs('127.0.0.1');
    const displayData = { state: {}, ws };
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'local1', type: 'local' }],
        buildPlaylist: async () => { throw new Error('boom'); },
        getDisplayData: () => displayData,
        persist: () => {},
        sendToDisplay: () => {}
    });
    await handler('display-1', { libraryId: 'local1', path: '/' }, ws);
    assert.deepEqual(ws.sent, [{ type: 'displayPlaylistError', message: '媒体库加载失败，请稍后重试' }]);
});

test('旧连接或已离线显示端不处理', async () => {
    const ws = createWs('127.0.0.1');
    const displayData = { state: {}, ws };
    let built = 0;
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'local1', type: 'local' }],
        buildPlaylist: async () => { built++; return []; },
        getDisplayData: () => ({ state: {}, ws: createWs('127.0.0.1') }),
        persist: () => {},
        sendToDisplay: () => {}
    });
    await handler('display-1', { libraryId: 'local1', path: '/' }, ws);
    assert.equal(built, 0);
    assert.equal(ws.sent.length, 0);
});

const fs = require('node:fs');
const vm = require('node:vm');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service');
const { listDisplayLibraries } = require('../src/apps/server/modules/media/display-local-media');
const { registerTextMediaDisplayHandlers } = require('../src/apps/server/modules/media/text-media-ws-integration');

// 使用入口实际注册类型和分派代码，组合真实列表服务，避免仅验证手写的测试分派。
function createRoutedHarness(manager, displays, persisted) {
    const source = fs.readFileSync(require.resolve('../src/apps/server/boot/server-app'), 'utf8');
    const playlistManager = new PlaylistManager(manager);
    const start = source.indexOf('const handleDisplayPlaylistRequest =');
    const end = source.indexOf('\n});', start) + 4;
    const fallbackStart = source.indexOf('function handleDisplayMessageFallback(');
    const fallbackEnd = source.indexOf("    if (data.type === 'chatAction')", fallbackStart);
    const context = vm.createContext({
        createDisplayPlaylistRequestHandler, listDisplayLibraries, mediaLibraryManager: manager,
        DISPLAY_BILIBILI_ID: 'display-bilibili', displayBilibiliSource: { playlist: async () => [] },
        buildTextVoiceRoute: displayId => ({ selectedDisplayIds: [displayId], selectedVoiceDisplayIds: [displayId], voiceTargetDisplayId: displayId }),
        textMediaTtsService: { setDisplayRoute: () => {} },
        playlistManager, displayClients: displays,
        persistDisplayState: (display, partial) => persisted.push(partial),
        sendToDisplay: (id, data) => displays.get(id).ws.send(JSON.stringify(data))
    });
    vm.runInContext(source.slice(start, end) + '\n' + source.slice(fallbackStart, fallbackEnd) + '}', context);
    const handlers = new Map();
    const types = JSON.parse(source.match(/displayTypes: (\[[^\n]+\]),/)[1].replaceAll("'", '"'));
    registerTextMediaDisplayHandlers({
        wsServer: { registerHandler: (type, callback) => handlers.set(type, callback) },
        displayTypes: types,
        handleDisplayMessage: context.handleDisplayMessageFallback
    }, {});
    return async (id, data) => {
        handlers.get(data.type)(data, { displayId: id, ws: displays.get(id).ws });
        await new Promise(resolve => setImmediate(resolve));
    };
}

test('实际注册路由组合真实列表服务：白名单、媒体筛选、单层名称排序及目标隔离', async () => {
    const requested = [];
    const manager = {
        listLibraries: () => [{ id: 'local1', type: 'local' }, { id: 'blocked', type: 'task' }],
        listTaskMediaSources: () => [{ id: 'task1', libraryId: 'task-real' }],
        async list(id, path) {
            requested.push({ id, path });
            return [
                { name: 'z.mp4', path: '/z.mp4', url: '/z.mp4', mediaType: 'video', proxyPassword: 'secret' },
                { name: 'a.gif', path: '/a.gif', url: '/a.gif', mediaType: 'gif' },
                { name: 'page.html', path: '/page.html', url: '/page.html', mediaType: 'html' },
                { name: 'folder', path: '/folder', type: 'folder' },
                { name: 'b.txt', path: '/b.txt', url: '/b.txt', mediaType: 'text', format: 'txt' }
            ];
        }
    };
    const ws = createWs('127.0.0.1');
    const other = createWs('127.0.0.1');
    const displays = new Map([['one', { state: {}, ws }], ['two', { state: {}, ws: other }]]);
    const persisted = [];
    const route = createRoutedHarness(manager, displays, persisted);
    await route('one', { type: 'displayPlaylistRequest', libraryId: 'blocked', path: '/', displayId: 'two' });
    assert.equal(requested.length, 0);
    assert.equal(ws.sent.pop().type, 'displayPlaylistError');
    await route('one', { type: 'displayPlaylistRequest', libraryId: 'task-real', path: '/collection', recursive: true, loop: true, displayId: 'two' });
    assert.deepEqual(requested, [{ id: 'task-real', path: '/collection' }]);
    assert.deepEqual(ws.sent[0].playlist.map(item => item.fileName), ['a.gif', 'b.txt', 'z.mp4']);
    assert.deepEqual(ws.sent[0].playlist.map(item => item.mediaType), ['image', 'text', 'video']);
    assert.match(ws.sent[0].playlist[0].url, /^\/api\/media-libraries\/task-real\/proxy\//);
    assert.equal(ws.sent[0].loop, false);
    assert.equal(ws.sent[0].temp, false);
    assert.deepEqual(ws.sent[0].selectedDisplayIds, ['one']);
    assert.equal(other.sent.length, 0);
    assert.equal(persisted.length, 1);
    assert.equal(JSON.stringify(ws.sent).includes('secret'), false);
});

test('目录扫描期间换连接或任务停止时不持久化和发送播放列表', async () => {
    for (const change of ['connection', 'task']) {
        const ws = createWs('127.0.0.1');
        const display = { ws, state: {} };
        let active = true;
        let persisted = 0;
        const handler = createDisplayPlaylistRequestHandler({
            getLibraries: () => active ? [{ id: 'task-real', type: 'task' }] : [],
            getDisplayData: () => display,
            buildPlaylist: async () => {
                if (change === 'connection') display.ws = createWs('127.0.0.1');
                if (change === 'task') active = false;
                return [{ mediaType: 'video', url: '/a.mp4' }];
            },
            persist: () => { persisted++; },
            sendToDisplay: () => assert.fail('不得发送失效列表')
        });
        await handler('one', { libraryId: 'task-real' }, ws);
        assert.equal(persisted, 0);
        assert.equal(ws.sent.some(message => message.type === 'playlistStart'), false);
    }
});

test('真实回环 WebSocket 与磁盘媒体库只向请求连接发送可恢复播放列表', async t => {
    const os = require('node:os');
    const path = require('node:path');
    const fsp = require('node:fs/promises');
    const { once } = require('node:events');
    const { WebSocket, WebSocketServer } = require('ws');
    const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-display-playlist-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const mediaRoot = path.join(root, 'media');
    await fsp.mkdir(path.join(mediaRoot, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(mediaRoot, 'z.mp4'), 'video');
    await fsp.writeFile(path.join(mediaRoot, 'a.txt'), 'text');
    await fsp.writeFile(path.join(mediaRoot, 'page.html'), '<html></html>');
    await fsp.writeFile(path.join(mediaRoot, 'nested', 'hidden.mp4'), 'nested');
    const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), getLocalIP: () => '192.168.1.10', isHttps: () => true });
    await manager.addLibraryFromConfig({ id: 'disk', name: '磁盘', type: 'local', path: mediaRoot });
    const displays = new Map();
    const persisted = [];
    const route = createRoutedHarness(manager, displays, persisted);
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    t.after(() => { for (const ws of server.clients) ws.terminate(); server.close(); });
    await once(server, 'listening');
    server.on('connection', (ws, request) => {
        const id = request.url.slice(1);
        displays.set(id, { state: {}, ws });
        ws.on('message', async payload => { await route(id, JSON.parse(payload)); });
    });
    const requester = new WebSocket(`ws://127.0.0.1:${server.address().port}/one`);
    const spectator = new WebSocket(`ws://127.0.0.1:${server.address().port}/two`);
    t.after(() => { requester.terminate(); spectator.terminate(); });
    await Promise.all([once(requester, 'open'), once(spectator, 'open')]);
    const otherMessages = [];
    spectator.on('message', payload => otherMessages.push(JSON.parse(payload)));
    const reply = once(requester, 'message');
    requester.send(JSON.stringify({ type: 'displayPlaylistRequest', libraryId: 'disk', path: '/', displayId: 'two' }));
    const [payload] = await reply;
    const message = JSON.parse(payload);
    assert.equal(message.type, 'playlistStart');
    assert.deepEqual(message.playlist.map(item => item.fileName), ['a.txt', 'z.mp4']);
    assert.equal(message.playlist.every(item => item.url.startsWith('/') && !item.url.startsWith('//')), true);
    assert.equal(message.loop, false);
    assert.deepEqual(message.selectedDisplayIds, ['one']);
    assert.equal(otherMessages.length, 0);
    assert.equal(persisted[0].currentPlaylist.startData.listId, message.listId);
    assert.equal(displays.get('one').state.currentPlaylist.state, 'playing');
    assert.equal(displays.get('two').state.currentPlaylist, undefined);
});

test('后来的目录请求、单媒体替换和显式停止都使旧扫描结果失效', async () => {
    const { invalidateDisplayPlaylistRequest } = require('../src/apps/server/modules/media/display-local-media');
    for (const change of ['new-request', 'media', 'url', 'base64', 'clearMedia', 'stop', 'playlistStart']) {
        const ws = createWs('127.0.0.1');
        const display = { ws, state: {} };
        const pending = [];
        const sent = [];
        const handler = createDisplayPlaylistRequestHandler({
            getLibraries: () => [{ id: 'local1', type: 'local' }],
            getDisplayData: () => display,
            buildPlaylist: () => new Promise(resolve => pending.push(resolve)),
            persist: () => {}, sendToDisplay: (id, message) => sent.push(message)
        });
        const first = handler('one', { libraryId: 'local1' }, ws);
        if (change === 'new-request') {
            const second = handler('one', { libraryId: 'local1' }, ws);
            pending[1]([{ url: '/new.mp4', mediaType: 'video' }]);
            await second;
        }
        if (change === 'media') display.state.currentMedia = { url: '/single.mp4' };
        if (!['new-request', 'media'].includes(change)) {
            // 执行生产 sendToDisplay 的取消逻辑，确保接线实际覆盖 url/base64/清空/停止。
            const source = fs.readFileSync(require.resolve('../src/apps/server/boot/server-app'), 'utf8');
            const start = source.indexOf('function sendToDisplay(');
            const end = source.indexOf('    // 每次下发只规范化媒体副本', start);
            const context = vm.createContext({ invalidateDisplayPlaylistRequest, displayClients: new Map([['one', display]]) });
            vm.runInContext(source.slice(start, end) + '}', context);
            context.sendToDisplay('one', ['stop', 'clearMedia'].includes(change)
                ? { type: 'control', action: change } : { type: change });
        }
        pending[0]([{ url: '/old.mp4', mediaType: 'video' }]);
        await first;
        assert.equal(sent.length, change === 'new-request' ? 1 : 0);
        if (sent.length) assert.equal(sent[0].playlist[0].url, '/new.mp4');
    }
});

test('列表注册真实 TTS 路由，取消旧远端上下文并允许新文本合成', async () => {
    const { createTextMediaTtsService } = require('../src/apps/server/modules/media/text-media-tts-service');
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/sentence.wav',
        sendToDisplay: (id, message) => messages.push({ id, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });
    service.setDisplayRoute('one', { selectedDisplayIds: ['one', 'old-target'], selectedVoiceDisplayIds: ['old-target'], voiceTargetDisplayId: 'old-target' });
    await service.handleSentenceRequest('one', { playbackId: 'old', pageIndex: 0, sentenceIndex: 0, text: '旧句' });
    const ws = createWs('127.0.0.1');
    const display = { ws, state: {} };
    const route = { selectedDisplayIds: ['one'], selectedVoiceDisplayIds: ['one'], voiceTargetDisplayId: 'one' };
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'local1', type: 'local' }],
        getDisplayData: () => display,
        getVoiceRoute: () => route,
        setDisplayRoute: service.setDisplayRoute,
        buildPlaylist: async () => [{ url: '/book.txt', mediaType: 'text', format: 'txt' }],
        persist: () => {}, sendToDisplay: () => {}
    });
    await handler('one', { libraryId: 'local1' }, ws);
    assert.equal(messages.some(({ id, message }) => id === 'old-target' && message.action === 'stop' && message.playbackId === 'old'), true);
    assert.deepEqual(display.state.currentPlaylist.startData.voiceRouteByDisplayId.one, route);
    const before = messages.length;
    await service.handleSentenceRequest('one', { playbackId: 'new', pageIndex: 0, sentenceIndex: 0, text: '新句', route });
    assert.equal(messages.slice(before).some(({ id, message }) => id === 'one' && message.type === 'tts' && message.action === 'playAudio' && message.playbackId === 'new'), true);
    assert.equal(messages.slice(before).some(({ id }) => id === 'old-target'), false);
    service.clearDisplayRoute('one');
});

test('真实本地提供器拒绝同前缀兄弟目录的路径遍历', async t => {
    const os = require('node:os');
    const path = require('node:path');
    const fsp = require('node:fs/promises');
    const { LocalProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-local-boundary-'));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const provider = new LocalProvider({ id: 'safe', path: path.join(root, 'media') });
    await provider.connect();
    await fsp.mkdir(path.join(root, 'media-secret'));
    await fsp.writeFile(path.join(root, 'media-secret', 'secret.txt'), 'secret');
    await assert.rejects(provider.list('/../media-secret'), /路径遍历/);
    assert.equal(provider._resolvePath('/child/../inside'), path.join(root, 'media', 'inside'));
    assert.equal(provider._resolvePath('/'), path.join(root, 'media'));
});

test('真实注册取消消息清除持久化列表并丢弃在途目录扫描', async () => {
    let release;
    const scanning = new Promise(resolve => { release = resolve; });
    const manager = {
        listLibraries: () => [{ id: 'disk', type: 'local' }],
        listTaskMediaSources: () => [],
        list: async () => { await scanning; return [{ name: 'late.mp4', path: '/late.mp4', mediaType: 'video', url: '/late.mp4' }]; }
    };
    const ws = createWs('127.0.0.1');
    const display = { ws, state: { currentPlaylist: { old: true } } };
    const persisted = [];
    const route = createRoutedHarness(manager, new Map([['one', display]]), persisted);
    await route('one', { type: 'displayPlaylistRequest', libraryId: 'disk', requestId: 'slow' });
    await route('one', { type: 'displayPlaylistCancel' });
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(display.state.currentPlaylist, null);
    assert.deepEqual(persisted.map(item => item.currentPlaylist), [null]);
    assert.equal(ws.sent.length, 0);
});

test('单文件按可信来源解析并保存可重连媒体和文本路由，不接受客户端 URL', async () => {
    const manager = {
        listLibraries: () => [{ id: 'disk', type: 'local' }], listTaskMediaSources: () => [],
        list: async () => [{ name: 'readme.md', path: '/readme.md', mediaType: 'text', format: 'markdown', url: '/trusted.md' }]
    };
    const ws = createWs('127.0.0.1');
    const display = { ws, state: { currentMedia: { url: '/old.mp4' }, currentPlaylist: { old: true } } };
    const persisted = [];
    const route = createRoutedHarness(manager, new Map([['one', display]]), persisted);
    await route('one', { type: 'displayPlaylistCancel', libraryId: 'disk', path: '/readme.md', media: { url: 'https://attacker.test/stolen' } });
    const saved = persisted.at(-1);
    assert.equal(saved.currentPlaylist, null);
    assert.equal(saved.currentMediaProgress, null);
    assert.equal(saved.currentMedia.url, '/trusted.md');
    assert.equal(saved.currentMedia.format, 'markdown');
    assert.deepEqual(Array.from(saved.currentMedia.selectedDisplayIds), ['one']);
    assert.equal(display.state.currentMedia, saved.currentMedia);
    assert.equal(ws.sent.at(-1).type, 'displayMediaStart');
    // 新连接恢复使用的字段必须仍为刚选择的媒体，而不是旧媒体或旧列表。
    display.ws = createWs('127.0.0.1');
    assert.equal(JSON.parse(JSON.stringify(display.state)).currentMedia.fileName, 'readme.md');
    assert.equal(display.state.currentPlaylist, null);
});

test('单文件可信解析失败保留旧媒体及列表，只返回一次带标识错误', async () => {
    const ws = createWs('127.0.0.1');
    const previousMedia = { type: 'url', url: '/old.mp4' };
    const previousPlaylist = { listId: 'previous' };
    const display = { ws, state: { currentMedia: previousMedia, currentPlaylist: previousPlaylist } };
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => [{ id: 'disk', type: 'local' }],
        getDisplayData: () => display, buildPlaylist: async () => [],
        persist: () => assert.fail('解析失败不能修改恢复状态'),
        sendToDisplay: () => assert.fail('解析失败不能播放')
    });
    await handler('one', { type: 'displayPlaylistCancel', libraryId: 'disk', path: '/missing.mp4', requestId: 'single-failed' }, ws);
    assert.equal(display.state.currentMedia, previousMedia);
    assert.equal(display.state.currentPlaylist, previousPlaylist);
    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0].requestId, 'single-failed');
    assert.equal(ws.sent[0].type, 'displayPlaylistError');
});
