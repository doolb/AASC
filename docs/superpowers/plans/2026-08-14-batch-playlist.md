# 批量播放模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现批量播放模式——控制端媒体库文件夹/临时多文件入口，服务端生成播放列表一次性下发，显示端本地自循环播放（图片间隔、视频播完+间隔、支持列表循环），回传进度并接受控制端干预，可被单文件播放打断。

**Architecture:** 控制端发送 `playlistRequest`（媒体库文件夹参数或临时 base64 数组）→ 服务端 PlaylistManager 扫描/排序/洗牌生成完整列表 → `playlistStart` 一次性下发显示端 → 显示端本地循环播放并上报 `playlistProgress` → 控制端 `playlistControl` 干预。非临时列表持久化到 config 支持重连续播；单媒体消息到达即打断批量。

**Tech Stack:** Node.js（服务端）、原生 JS 前端（upload.html/display.html）、node:test（单元测试）

## Global Constraints

- 代码规范（CLAUDE.md）：使用 `const/let` 不用 `var`；异步用 `async/await`；错误处理用 `try-catch`；注释用中文
- 遵循 AASC 规则，消息分发在现有 if/else if 链中新增分支，不重写分发逻辑
- 媒体类型集合：`['image', 'video', 'gif']`
- 临时模式 base64 批量总大小上限 350MB（预留膨胀空间，WS maxPayload 500MB）
- 测试运行：`node --test tests/playlist-app-service.test.js`（Node v25，内置 test runner）
- 前端与 WS 集成无自动化测试框架，任务内附手动自测步骤

---

### Task 1: PlaylistManager 服务端模块（列表生成/排序/洗牌）

**Files:**
- Create: `src/apps/web-mediacenter/modules/media/playlist-app-service.js`
- Test: `tests/playlist-app-service.test.js`

**Interfaces:**
- Consumes: `mediaLibraryManager.list(libraryId, path)` → 返回 items 数组，每项 `{name, path, type: 'folder'|'file', mediaType, size, modifiedTime, url}`
- Produces:
  - `class PlaylistManager`，构造函数 `new PlaylistManager(mediaLibraryManager)`
  - `async buildFromLibrary(libraryId, path, {recursive, mode, sortBy, direction})` → `[{url, fileName, mediaType}]`
  - `buildFromTemp(files, {mode, sortBy, direction})` → `[{data, fileName, mediaType, mimeType}]`
  - 排序参数：`mode: 'sequence'|'random'`、`sortBy: 'name'|'time'`、`direction: 'asc'|'desc'`

- [ ] **Step 1: 写失败测试**

```js
// tests/playlist-app-service.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service.js');

// 假媒体库管理器：内存目录树
const tree = {
    '/': [
        { name: 'b.mp4', path: '/b.mp4', type: 'file', mediaType: 'video', modifiedTime: new Date('2026-01-02'), url: '/media/1/b.mp4' },
        { name: 'readme.txt', path: '/readme.txt', type: 'file', mediaType: 'text', modifiedTime: new Date('2026-01-02'), url: '/media/1/readme.txt' },
        { name: '相册', path: '/相册', type: 'folder', mediaType: 'folder' }
    ],
    '/相册': [
        { name: 'a.jpg', path: '/相册/a.jpg', type: 'file', mediaType: 'image', modifiedTime: new Date('2026-01-01'), url: '/media/1/a.jpg' },
        { name: 'c.gif', path: '/相册/c.gif', type: 'file', mediaType: 'gif', modifiedTime: new Date('2026-01-03'), url: '/media/1/c.gif' },
        { name: '子', path: '/相册/子', type: 'folder', mediaType: 'folder' }
    ],
    '/相册/子': [
        { name: 'd.jpg', path: '/相册/子/d.jpg', type: 'file', mediaType: 'image', modifiedTime: new Date('2026-01-04'), url: '/media/1/d.jpg' }
    ]
};

const fakeManager = {
    async list(libraryId, path) {
        return tree[path] || [];
    }
};

test('buildFromLibrary 单层只收集当前层媒体并过滤非媒体', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: false, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['b.mp4']);
    assert.strictEqual(list[0].url, '/media/1/b.mp4');
});

test('buildFromLibrary 递归收集全部层级媒体', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: true, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.jpg', 'b.mp4', 'c.gif', 'd.jpg']);
});

test('buildFromLibrary 按时间正序', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/相册', { recursive: true, mode: 'sequence', sortBy: 'time', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.jpg', 'c.gif', 'd.jpg']);
});

test('buildFromLibrary 按时间反序', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/相册', { recursive: true, mode: 'sequence', sortBy: 'time', direction: 'desc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['d.jpg', 'c.gif', 'a.jpg']);
});

test('buildFromLibrary 随机模式洗牌包含全部项且不重复', async () => {
    const pm = new PlaylistManager(fakeManager);
    const list = await pm.buildFromLibrary('lib1', '/相册', { recursive: true, mode: 'random' });
    const names = list.map(i => i.fileName).sort();
    assert.deepStrictEqual(names, ['a.jpg', 'c.gif', 'd.jpg']);
});

test('buildFromTemp 按文件名排序并保留 data', () => {
    const pm = new PlaylistManager(fakeManager);
    const files = [
        { name: 'b.png', data: 'BBB', mediaType: 'image', mimeType: 'image/png' },
        { name: 'a.png', data: 'AAA', mediaType: 'image', mimeType: 'image/png' }
    ];
    const list = pm.buildFromTemp(files, { mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['a.png', 'b.png']);
    assert.strictEqual(list[0].data, 'AAA');
    assert.strictEqual(list[0].mimeType, 'image/png');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/playlist-app-service.test.js`
Expected: FAIL，报 `Cannot find module '.../playlist-app-service.js'`

- [ ] **Step 3: 实现 PlaylistManager**

```js
// src/apps/web-mediacenter/modules/media/playlist-app-service.js
'use strict';

const MEDIA_TYPES = ['image', 'video', 'gif'];

class PlaylistManager {
    constructor(mediaLibraryManager) {
        this.manager = mediaLibraryManager;
    }

    // 按模式排序或洗牌
    _sortPlaylist(items, mode, sortBy, direction) {
        if (mode === 'random') {
            return this._shuffle(items);
        }
        const dir = direction === 'desc' ? -1 : 1;
        return [...items].sort((a, b) => {
            let cmp;
            if (sortBy === 'time') {
                cmp = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
            } else {
                cmp = String(a.name).localeCompare(String(b.name));
            }
            return cmp * dir;
        });
    }

    // Fisher-Yates 洗牌
    _shuffle(arr) {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    // 从媒体库文件夹构建播放列表（递归或单层）
    async buildFromLibrary(libraryId, path, options = {}) {
        const { recursive = false, mode = 'sequence', sortBy = 'name', direction = 'asc' } = options;
        const all = [];
        const queue = [path || '/'];
        while (queue.length > 0) {
            const dir = queue.shift();
            const items = await this.manager.list(libraryId, dir);
            for (const item of items) {
                if (item.type === 'folder') {
                    if (recursive) queue.push(item.path);
                } else if (MEDIA_TYPES.includes(item.mediaType)) {
                    all.push(item);
                }
            }
        }
        const sorted = this._sortPlaylist(all, mode, sortBy, direction);
        return sorted.map(item => ({
            url: item.url,
            fileName: item.name,
            mediaType: item.mediaType
        }));
    }

    // 从控制端上传的 base64 文件构建播放列表
    buildFromTemp(files, options = {}) {
        const { mode = 'sequence', sortBy = 'name', direction = 'asc' } = options;
        const sorted = this._sortPlaylist(files || [], mode, sortBy, direction);
        return sorted.map(f => ({
            data: f.data,
            fileName: f.name,
            mediaType: f.mediaType || 'image',
            mimeType: f.mimeType
        }));
    }
}

module.exports = { PlaylistManager };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/playlist-app-service.test.js`
Expected: PASS（6 个测试全部通过）

- [ ] **Step 5: 提交**

```bash
git add tests/playlist-app-service.test.js src/apps/web-mediacenter/modules/media/playlist-app-service.js
git commit -m "feat: PlaylistManager 服务端播放列表生成模块（扫描/排序/洗牌）"
```

---

### Task 2: 服务端 WS 消息处理（playlistRequest/Control/Progress + 持久化 + 重连恢复 + 打断）

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
  - 顶部 require 区域（~第 222 行 `let displayClients` 附近）——需要确认 mediaLibraryManager 变量名
  - 第 2421 行重连恢复区域
  - 第 2607 行 videoProgress 分支后插入 playlistProgress 分支
  - 第 3019 行 mediaBatch 分支后插入 playlistRequest/playlistControl 分支
  - 第 3022 行 mediaBatch 的 forEach 内、第 3049 行 media 分支内插入打断清理

**Interfaces:**
- Consumes: Task 1 的 `PlaylistManager`；现有 `mediaLibraryManager`、`displayClients`、`sendToDisplay(id, msg)`、`broadcastToControls(data)`、`config.updateDisplayState(ip, patch)`、`logError(tag, msg)`
- Produces:
  - `playlistRequest` 响应：成功 `{type:'playlistStarted', listId, total, displayIds}`，失败 `{type:'playlistError', message}`
  - 持久化结构：`displayData.state.currentPlaylist = { startData: {listId, playlist, interval, loop, announceName}, index, state }`

- [ ] **Step 1: 确认 mediaLibraryManager 在 server-app.js 的引用方式**

Run: `grep -n "mediaLibraryManager" src/apps/server/boot/server-app.js | head -5`
Expected: 显示 require/变量声明位置（如 `const mediaLibraryManager = require(...)`）

- [ ] **Step 2: 引入 PlaylistManager 并创建实例**

在 server-app.js 中 `mediaLibraryManager` 声明之后添加（相对路径与第 34 行 `../../web-mediacenter/modules/time/time-listener-app-service` 写法一致）：

```js
const { PlaylistManager } = require('../../web-mediacenter/modules/media/playlist-app-service');
const playlistManager = new PlaylistManager(mediaLibraryManager);
```

- [ ] **Step 3: 重连恢复逻辑——currentPlaylist 优先于 currentMedia**

将第 2421 行区域：

```js
        if (savedState && savedState.currentMedia) {
            ws.send(JSON.stringify({ 
                type: 'restoreState',
                state: savedState
            }));
        }
```

替换为：

```js
        if (savedState?.currentPlaylist) {
            ws.send(JSON.stringify({
                type: 'playlistStart',
                ...savedState.currentPlaylist.startData,
                resumeIndex: savedState.currentPlaylist.index
            }));
        } else if (savedState && savedState.currentMedia) {
            ws.send(JSON.stringify({ 
                type: 'restoreState',
                state: savedState
            }));
        }
```

- [ ] **Step 4: 新增 playlistProgress 分支**

在第 2607 行 `} else if (data.type === 'videoProgress') { ... }` 分支之后添加：

```js
    } else if (data.type === 'playlistProgress') {
        if (displayData && displayData.state.currentPlaylist) {
            displayData.state.currentPlaylist.index = data.index;
            displayData.state.currentPlaylist.state = data.state;
            if (data.state === 'finished' || data.state === 'stopped') {
                displayData.state.currentPlaylist = null;
                config.updateDisplayState(displayData.ip, { currentPlaylist: null });
            } else {
                config.updateDisplayState(displayData.ip, { currentPlaylist: displayData.state.currentPlaylist });
            }
        }
        broadcastToControls({
            displayId: displayId,
            type: 'playlistProgress',
            listId: data.listId,
            index: data.index,
            total: data.total,
            state: data.state,
            fileName: data.fileName
        });
    }
```

（先 grep 确认该区域缩进与变量名 `displayData`/`displayId` 一致）

- [ ] **Step 5: 新增 playlistRequest/playlistControl 分支**

在第 3019 行 `} else if (data.type === 'mediaBatch') { ... }` 分支（到第 3033 行 `return;`）之后、第 3036 行 `if (!displayData) return;` 之前插入：

```js
                } else if (data.type === 'playlistRequest') {
                    (async () => {
                        try {
                            const displayIds = data.displayIds || [];
                            if (displayIds.length === 0) {
                                ws.send(JSON.stringify({ type: 'playlistError', message: '没有可用的显示端' }));
                                return;
                            }
                            let playlist;
                            if (data.temp) {
                                playlist = playlistManager.buildFromTemp(data.files || [], {
                                    mode: data.mode, sortBy: data.sortBy, direction: data.direction
                                });
                            } else {
                                playlist = await playlistManager.buildFromLibrary(data.libraryId, data.path, {
                                    recursive: data.recursive, mode: data.mode, sortBy: data.sortBy, direction: data.direction
                                });
                            }
                            if (!playlist || playlist.length === 0) {
                                ws.send(JSON.stringify({ type: 'playlistError', message: '没有可播放的媒体文件' }));
                                return;
                            }
                            const listId = 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                            const startData = {
                                listId, playlist,
                                interval: data.interval || 0,
                                loop: !!data.loop,
                                announceName: !!data.announceName
                            };
                            const sentIds = [];
                            displayIds.forEach(id => {
                                const dd = displayClients.get(id);
                                if (!dd) return;
                                if (!data.temp) {
                                    dd.state.currentPlaylist = { startData, index: 0, state: 'playing' };
                                    config.updateDisplayState(dd.ip, { currentPlaylist: dd.state.currentPlaylist });
                                }
                                sendToDisplay(id, { type: 'playlistStart', ...startData, temp: !!data.temp });
                                sentIds.push(id);
                            });
                            ws.send(JSON.stringify({ type: 'playlistStarted', listId, total: playlist.length, displayIds: sentIds }));
                        } catch (err) {
                            logError('批量播放', `生成列表失败: ${err.message}`);
                            ws.send(JSON.stringify({ type: 'playlistError', message: '生成播放列表失败: ' + err.message }));
                        }
                    })();
                    return;
                } else if (data.type === 'playlistControl') {
                    (data.displayIds || []).forEach(id => {
                        const dd = displayClients.get(id);
                        if (!dd) return;
                        sendToDisplay(id, { type: 'playlistControl', action: data.action, index: data.index });
                        if (data.action === 'stop' && dd.state.currentPlaylist) {
                            dd.state.currentPlaylist = null;
                            config.updateDisplayState(dd.ip, { currentPlaylist: null });
                        }
                    });
                    return;
                }
```

- [ ] **Step 6: 单媒体发送打断批量——mediaBatch 与 media 分支清理**

在 mediaBatch 分支（3019）的 `displayIds.forEach(id => { const dd = displayClients.get(id); if (dd) {` 之后、`if (!data.media.temp) {` 之前插入：

```js
                            if (dd.state.currentPlaylist) {
                                dd.state.currentPlaylist = null;
                                config.updateDisplayState(dd.ip, { currentPlaylist: null });
                            }
```

在 media 分支（3049）的 `} else if (data.type === 'media') {` 之后、`if (!data.media.temp) {` 之前插入：

```js
                    if (displayData.state.currentPlaylist) {
                        displayData.state.currentPlaylist = null;
                        config.updateDisplayState(displayData.ip, { currentPlaylist: null });
                    }
```

- [ ] **Step 7: 语法检查**

Run: `node --check src/apps/server/boot/server-app.js`
Expected: 无输出（语法正确）

- [ ] **Step 8: 手动自测（服务端逻辑）**

1. 启动服务：`npm start`（或项目实际启动命令）
2. 用控制端连接，在 WS 控制台发送：
   ```js
   // 测试 playlistRequest（假设 displayId 为实际值，libraryId 为配置中的媒体库 id）
   ws.send(JSON.stringify({type:'playlistRequest', libraryId:'local_uploads', path:'/', recursive:false, interval:3, mode:'sequence', sortBy:'name', direction:'asc', loop:true, announceName:false, displayIds:['<显示端id>']}))
   ```
   Expected: 收到 `playlistStarted`；显示端收到 `playlistStart` 并开始播放
3. 发送空文件夹路径 → 收到 `playlistError`
4. 发送 `{type:'playlistControl', displayIds:[id], action:'stop'}` → 显示端停止，控制端收到 `playlistProgress` state=stopped
5. 批量播放中发送单媒体 → 显示端转单媒体播放
6. 显示端刷新重连 → 收到 `playlistStart` 带 resumeIndex（若播放列表未结束）

- [ ] **Step 9: 提交**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat: 服务端批量播放消息处理（playlistRequest/Control/Progress、持久化、重连恢复、打断）"
```

---

### Task 3: 显示端批量播放循环

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
  - `function showMedia` 之前（~1036 行）插入批量播放状态与函数
  - WS onmessage 链中 `} else if (data.type === 'task:renderUpdate') { ... }` 分支之后、`} else {`（1297 行）之前插入 playlistStart/playlistControl 分支
  - `} else {` 分支（1297-1301 行）内 showMedia 前加 stopPlaylist()

**Interfaces:**
- Consumes: `mediaVideo`、`mediaImage`、`showMedia(data)`、`autoTtsEnabled`、`displayWs`、`sendCommandAck(type, ok, extra)`、`extractFileName`、`playTTS`（均已有）
- Produces: 内部函数 `handlePlaylistStart(data)`、`handlePlaylistControl(data)`、`stopPlaylist()`、`playlistNext()`、`playlistPrev()`、`playlistJump(index)`、`playlistPause()`、`playlistResume()`、`playlistProgress` 上报

- [ ] **Step 1: 插入批量播放状态与函数**

在 `function showMedia(data) {` 之前插入：

```html
        <!-- 批量播放模式：本地自循环播放列表 -->
        let playlistState = null;
        let savedAutoTts = null;

        function stopPlaylist() {
            if (!playlistState) return;
            playlistState.active = false;
            if (playlistState.timer) {
                clearTimeout(playlistState.timer);
                playlistState.timer = null;
            }
            if (playlistState.videoEndedHandler) {
                mediaVideo.removeEventListener('ended', playlistState.videoEndedHandler);
                playlistState.videoEndedHandler = null;
            }
            if (savedAutoTts !== null) {
                autoTtsEnabled = savedAutoTts;
                savedAutoTts = null;
            }
            playlistState = null;
        }

        function sendPlaylistProgress(state) {
            if (!playlistState || !displayWs || displayWs.readyState !== WebSocket.OPEN) return;
            const ps = playlistState;
            displayWs.send(JSON.stringify({
                type: 'playlistProgress',
                listId: ps.listId,
                index: ps.index,
                total: ps.playlist.length,
                state: state,
                fileName: ps.playlist[ps.index] ? ps.playlist[ps.index].fileName : ''
            }));
        }

        function handlePlaylistStart(data) {
            stopPlaylist();
            savedAutoTts = autoTtsEnabled;
            autoTtsEnabled = !!data.announceName;
            const playlist = data.playlist || [];
            if (playlist.length === 0) {
                stopPlaylist();
                return;
            }
            const resumeIndex = Math.max(Math.min(data.resumeIndex || 0, playlist.length - 1), 0);
            playlistState = {
                listId: data.listId,
                playlist: playlist,
                interval: (data.interval || 0) * 1000,
                loop: !!data.loop,
                index: resumeIndex,
                timer: null,
                videoEndedHandler: null,
                active: true
            };
            playCurrentItem();
        }

        function playCurrentItem() {
            if (!playlistState || !playlistState.active) return;
            const ps = playlistState;
            const item = ps.playlist[ps.index];
            if (!item) {
                finishPlaylist();
                return;
            }
            const mediaData = item.url
                ? { type: 'url', url: item.url, fileName: item.fileName, mediaType: item.mediaType }
                : { type: 'base64', data: item.data, fileName: item.fileName, mediaType: item.mediaType, mimeType: item.mimeType };
            showMedia(mediaData);
            if (item.mediaType === 'video') {
                // 视频用自己的时长播放，播完后再等间隔
                mediaVideo.loop = false;
                ps.videoEndedHandler = function() {
                    mediaVideo.removeEventListener('ended', ps.videoEndedHandler);
                    ps.videoEndedHandler = null;
                    ps.timer = setTimeout(playlistNext, ps.interval);
                };
                mediaVideo.addEventListener('ended', ps.videoEndedHandler);
                mediaVideo.onerror = function() {
                    // 视频加载失败：等间隔后播下一个，不卡死循环
                    mediaVideo.onerror = null;
                    if (ps.videoEndedHandler) {
                        mediaVideo.removeEventListener('ended', ps.videoEndedHandler);
                        ps.videoEndedHandler = null;
                    }
                    ps.timer = setTimeout(playlistNext, ps.interval);
                };
            } else {
                // 图片按间隔时间切换
                mediaImage.onerror = function() {
                    // 图片加载失败：等间隔后播下一个，不卡死循环
                    mediaImage.onerror = null;
                    ps.timer = setTimeout(playlistNext, ps.interval);
                };
                ps.timer = setTimeout(playlistNext, ps.interval);
            }
            sendPlaylistProgress('playing');
        }

        function playlistNext() {
            if (!playlistState || !playlistState.active) return;
            const ps = playlistState;
            if (ps.index + 1 >= ps.playlist.length) {
                if (ps.loop) {
                    ps.index = 0;
                    playCurrentItem();
                } else {
                    finishPlaylist();
                }
            } else {
                ps.index++;
                playCurrentItem();
            }
        }

        function playlistPrev() {
            if (!playlistState || !playlistState.active) return;
            const ps = playlistState;
            ps.index = ps.index - 1 < 0 ? (ps.loop ? ps.playlist.length - 1 : 0) : ps.index - 1;
            playCurrentItem();
        }

        function playlistJump(index) {
            if (!playlistState || !playlistState.active) return;
            const ps = playlistState;
            if (index < 0 || index >= ps.playlist.length) return;
            ps.index = index;
            playCurrentItem();
        }

        function playlistPause() {
            if (!playlistState || !playlistState.active) return;
            const ps = playlistState;
            if (ps.timer) {
                clearTimeout(ps.timer);
                ps.timer = null;
            }
            if (ps.videoEndedHandler) {
                mediaVideo.removeEventListener('ended', ps.videoEndedHandler);
                ps.videoEndedHandler = null;
                mediaVideo.pause();
            }
            sendPlaylistProgress('paused');
        }

        function playlistResume() {
            if (!playlistState || !playlistState.active) return;
            const ps = playlistState;
            const item = ps.playlist[ps.index];
            if (item && item.mediaType === 'video') {
                mediaVideo.play().catch(e => console.log('播放被阻止'));
                ps.videoEndedHandler = function() {
                    mediaVideo.removeEventListener('ended', ps.videoEndedHandler);
                    ps.videoEndedHandler = null;
                    ps.timer = setTimeout(playlistNext, ps.interval);
                };
                mediaVideo.addEventListener('ended', ps.videoEndedHandler);
            } else {
                ps.timer = setTimeout(playlistNext, ps.interval);
            }
            sendPlaylistProgress('playing');
        }

        function finishPlaylist() {
            if (!playlistState) return;
            const info = {
                listId: playlistState.listId,
                index: playlistState.index,
                total: playlistState.playlist.length,
                state: 'finished'
            };
            playlistState.active = false;
            if (playlistState.timer) {
                clearTimeout(playlistState.timer);
                playlistState.timer = null;
            }
            if (playlistState.videoEndedHandler) {
                mediaVideo.removeEventListener('ended', playlistState.videoEndedHandler);
                playlistState.videoEndedHandler = null;
            }
            if (savedAutoTts !== null) {
                autoTtsEnabled = savedAutoTts;
                savedAutoTts = null;
            }
            playlistState = null;
            if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                displayWs.send(JSON.stringify({ type: 'playlistProgress', ...info }));
            }
        }

        function handlePlaylistControl(data) {
            if (!playlistState) return;
            switch (data.action) {
                case 'pause':
                    playlistPause();
                    break;
                case 'resume':
                    playlistResume();
                    break;
                case 'next':
                    playlistNext();
                    break;
                case 'prev':
                    playlistPrev();
                    break;
                case 'jump':
                    playlistJump(data.index);
                    break;
                case 'stop':
                    const info = {
                        listId: playlistState.listId,
                        index: playlistState.index,
                        total: playlistState.playlist.length,
                        state: 'stopped'
                    };
                    stopPlaylist();
                    if (displayWs && displayWs.readyState === WebSocket.OPEN) {
                        displayWs.send(JSON.stringify({ type: 'playlistProgress', ...info }));
                    }
                    break;
            }
        }
```

- [ ] **Step 2: WS onmessage 添加 playlistStart/playlistControl 分支**

在 onmessage 的 `} else if (data.type === 'task:renderUpdate') { ... }` 分支之后、`} else {` 分支之前插入：

```js
                    } else if (data.type === 'playlistStart') {
                        handlePlaylistStart(data);
                        sendCommandAck('playlistStart', true, data.listId);
                    } else if (data.type === 'playlistControl') {
                        handlePlaylistControl(data);
                        sendCommandAck('playlistControl', true, data.action);
                    } else {
```

- [ ] **Step 3: 单媒体消息打断批量**

将 `} else {` 分支（1297-1301 行）：

```js
                    } else {
                        console.log('[显示端] 处理媒体消息，发送 media 确认');
                        showMedia(data);
                        sendCommandAck('media', true, data.type);
                    }
```

改为：

```js
                    } else {
                        console.log('[显示端] 处理媒体消息，发送 media 确认');
                        stopPlaylist();
                        showMedia(data);
                        sendCommandAck('media', true, data.type);
                    }
```

- [ ] **Step 4: 手动自测**

1. 打开显示端页面，控制端发送 `playlistStart`（可在控制端浏览器控制台用 `ws.send` 或等服务端实现后走 UI）：
   ```js
   // 控制端 WS 测试（playlistStart 实际由服务端下发，此步骤验证显示端逻辑）
   // 在控制端页面 console: window.WebSocketManager.send({type:'playlistRequest', ...}) 或按 Task 2 步骤 8 触发
   ```
2. Expected: 图片按间隔切换、视频播完+间隔切换；循环模式下最后一项播完回到第一项；非循环模式播完停在最后一项
3. 发送 `playlistControl` pause/resume/next/prev/stop → 行为符合预期
4. 批量播放中发送单个媒体（控制端播放单文件）→ 批量停止，单文件正常播放
5. 批量播放时勾选播报文件名 → 每项 TTS 播报文件名；结束后恢复原 autoTtsEnabled

- [ ] **Step 5: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/display.html
git commit -m "feat: 显示端批量播放本地循环（间隔/ended+间隔、循环回绕、进度上报、干预、打断）"
```

---

### Task 4: 控制端媒体库入口 + 共用模式设置框 + 进度面板

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`（handleMessage 加 playlistProgress/playlistError 分支；新增 sendPlaylistRequest/sendPlaylistControl）
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`（文件夹批量播放按钮、showPlaylistSettingsDialog、showBatchPlayDialog、进度面板）
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`（设置框与进度面板样式）

**Interfaces:**
- Consumes: `window.WebSocketManager`、`window.DisplayList.getSelectedDisplayIds()`、`window.showToast(msg, type)`
- Produces:
  - `WebSocketManager.sendPlaylistRequest(payload)` → 自动附加 displayIds，返回 boolean 是否已发送
  - `WebSocketManager.sendPlaylistControl(displayIds, action, index?)`
  - `MediaLibrary.showPlaylistSettingsDialog({title, hideRecursive, onConfirm})` —— 供 Task 5 临时模式复用
  - `MediaLibrary.showBatchPlayDialog(folderPath)`、`MediaLibrary.renderPlaylistPanel(info)`、`MediaLibrary.controlPlaylist(action)`

- [ ] **Step 1: websocket.js 新增发送方法**

在 `sendMedia`/`sendMediaWithRatio` 之后（`getMediaRatio` 之前）插入：

```js
    sendPlaylistRequest(payload) {
        if (!window.DisplayList) {
            showToast('显示端列表未初始化', 'error');
            return false;
        }
        const displayIds = window.DisplayList.getSelectedDisplayIds();
        if (displayIds.length === 0) {
            showToast('请先选择显示端', 'error');
            return false;
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'playlistRequest', ...payload, displayIds }));
            return true;
        }
        showToast('WebSocket 未连接', 'error');
        return false;
    },

    sendPlaylistControl(displayIds, action, index) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'playlistControl', displayIds, action, index }));
        }
    },
```

- [ ] **Step 2: websocket.js handleMessage 新增分支**

在 `handleMessage` 的 `} else if (data.type === 'displayState') { ... }` 链中合适位置（如 `deviceEventExecuted` 分支附近）插入：

```js
        } else if (data.type === 'playlistProgress') {
            if (window.MediaLibrary) {
                window.MediaLibrary.renderPlaylistPanel(data);
            }
        } else if (data.type === 'playlistError') {
            showToast(data.message || '批量播放失败', 'error');
        } else if (data.type === 'playlistStarted') {
            showToast(`播放列表已发送（共 ${data.total} 项）`, 'success');
        }
```

- [ ] **Step 3: media-library.js 文件夹项加批量播放按钮**

将 `renderFileList` 中文件夹项（390-399 行）的 HTML：

```js
                return `
                    <div class="media-library-item folder" onclick="MediaLibrary.navigateToFolder('${item.path}')">
                        <div class="folder-icon">📁</div>
                        <div class="item-name">${item.name}</div>
                        <div class="item-actions">
                            <button class="btn-delete" onclick="event.stopPropagation(); MediaLibrary.deleteItem('${item.path}', true)">删除</button>
                        </div>
                    </div>
                `;
```

替换为：

```js
                return `
                    <div class="media-library-item folder" onclick="MediaLibrary.navigateToFolder('${item.path}')">
                        <div class="folder-icon">📁</div>
                        <div class="item-name">${item.name}</div>
                        <div class="item-actions">
                            <button class="btn-batch" onclick="event.stopPropagation(); MediaLibrary.showBatchPlayDialog('${item.path}')">批量播放</button>
                            <button class="btn-delete" onclick="event.stopPropagation(); MediaLibrary.deleteItem('${item.path}', true)">删除</button>
                        </div>
                    </div>
                `;
```

- [ ] **Step 4: media-library.js 新增共用模式设置框**

在 `playMedia` 方法之后插入：

```js
    // 批量播放模式设置框（媒体库与临时模式共用）
    showPlaylistSettingsDialog(options = {}) {
        const { title = '批量播放设置', hideRecursive = false, onConfirm } = options;
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="playlist-settings-dialog">
                <div class="dialog-title">${title}</div>
                <div class="dialog-body">
                    ${hideRecursive ? '' : `
                    <div class="settings-row">
                        <span class="settings-label">扫描范围</span>
                        <label><input type="radio" name="plRecursive" value="false" checked> 当前文件夹</label>
                        <label><input type="radio" name="plRecursive" value="true"> 递归子文件夹</label>
                    </div>`}
                    <div class="settings-row">
                        <span class="settings-label">间隔时间</span>
                        <input type="number" id="plInterval" value="5" min="1" class="settings-input"> 秒
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播放模式</span>
                        <label><input type="radio" name="plMode" value="sequence" checked> 顺序</label>
                        <label><input type="radio" name="plMode" value="random"> 随机</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">排序方式</span>
                        <label><input type="radio" name="plSortBy" value="name" checked> 按文件名</label>
                        <label><input type="radio" name="plSortBy" value="time"> 按时间</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播放方向</span>
                        <label><input type="radio" name="plDirection" value="asc" checked> 正序</label>
                        <label><input type="radio" name="plDirection" value="desc"> 反序</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">循环播放</span>
                        <input type="checkbox" id="plLoop" checked>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播报文件名</span>
                        <input type="checkbox" id="plAnnounceName">
                    </div>
                </div>
                <div class="dialog-footer">
                    <button class="btn-cancel" id="plCancelBtn">取消</button>
                    <button class="btn-confirm" id="plConfirmBtn">开始播放</button>
                </div>
            </div>`;
        document.body.appendChild(mask);

        // 随机模式下排序/方向置灰
        const onModeChange = () => {
            const random = mask.querySelector('input[name="plMode"]:checked').value === 'random';
            const rows = mask.querySelectorAll('.settings-row');
            rows.forEach(row => {
                const label = row.querySelector('.settings-label');
                if (label && (label.textContent === '排序方式' || label.textContent === '播放方向')) {
                    const inputs = row.querySelectorAll('input');
                    inputs.forEach(inp => { inp.disabled = random; });
                    row.style.opacity = random ? '0.4' : '1';
                }
            });
        };
        mask.querySelectorAll('input[name="plMode"]').forEach(r => r.addEventListener('change', onModeChange));

        mask.querySelector('#plCancelBtn').addEventListener('click', () => mask.remove());
        mask.querySelector('#plConfirmBtn').addEventListener('click', () => {
            const settings = {
                recursive: mask.querySelector('input[name="plRecursive"]:checked')?.value === 'true',
                interval: parseInt(mask.querySelector('#plInterval').value) || 5,
                mode: mask.querySelector('input[name="plMode"]:checked').value,
                sortBy: mask.querySelector('input[name="plSortBy"]:checked').value,
                direction: mask.querySelector('input[name="plDirection"]:checked').value,
                loop: mask.querySelector('#plLoop').checked,
                announceName: mask.querySelector('#plAnnounceName').checked
            };
            mask.remove();
            if (typeof onConfirm === 'function') {
                onConfirm(settings);
            }
        });
    },

    // 媒体库文件夹批量播放入口
    showBatchPlayDialog(folderPath) {
        if (!this.currentLibrary) {
            showToast('请先选择媒体库', 'error');
            return;
        }
        this.showPlaylistSettingsDialog({
            onConfirm: (settings) => {
                const ok = window.WebSocketManager.sendPlaylistRequest({
                    libraryId: this.currentLibrary.id,
                    path: folderPath,
                    ...settings
                });
                if (ok) {
                    showToast('批量播放请求已发送', 'success');
                }
            }
        });
    },
```

- [ ] **Step 5: media-library.js 新增进度面板**

在 `showBatchPlayDialog` 之后插入：

```js
    // 批量播放进度面板（动态创建）
    ensurePlaylistPanel() {
        let panel = document.getElementById('playlistProgressPanel');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'playlistProgressPanel';
        panel.className = 'playlist-progress-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <span id="plProgressText" class="pl-progress-text"></span>
            <span class="pl-controls">
                <button id="plToggleBtn" onclick="MediaLibrary.controlPlaylist('toggle')">暂停</button>
                <button onclick="MediaLibrary.controlPlaylist('prev')">上一个</button>
                <button onclick="MediaLibrary.controlPlaylist('next')">下一个</button>
                <button onclick="MediaLibrary.controlPlaylist('stop')">停止</button>
            </span>`;
        const content = document.getElementById('mediaLibraryContent');
        const parent = content ? content.parentElement : document.body;
        parent.insertBefore(panel, content || null);
        return panel;
    },

    renderPlaylistPanel(info) {
        const panel = this.ensurePlaylistPanel();
        if (!info || info.state === 'stopped' || info.state === 'finished') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'flex';
        const stateText = { playing: '▶ 播放中', paused: '⏸ 已暂停' }[info.state] || info.state;
        document.getElementById('plProgressText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''} · ${stateText}`;
        const toggleBtn = document.getElementById('plToggleBtn');
        toggleBtn.textContent = info.state === 'paused' ? '继续' : '暂停';
        toggleBtn.dataset.action = info.state === 'paused' ? 'resume' : 'pause';
    },

    controlPlaylist(action) {
        const displayIds = window.DisplayList ? window.DisplayList.getSelectedDisplayIds() : [];
        if (displayIds.length === 0) {
            showToast('请先选择显示端', 'error');
            return;
        }
        if (action === 'toggle') {
            const toggleBtn = document.getElementById('plToggleBtn');
            action = toggleBtn && toggleBtn.dataset.action === 'resume' ? 'resume' : 'pause';
        }
        window.WebSocketManager.sendPlaylistControl(displayIds, action);
    },
```

- [ ] **Step 6: upload.css 新增样式**

在 `upload.css` 末尾追加：

```css
/* 批量播放设置框 */
.modal-mask {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}
.playlist-settings-dialog {
    background: #1e1e2e;
    border: 1px solid #444;
    border-radius: 10px;
    padding: 18px 22px;
    min-width: 360px;
    color: #eee;
}
.dialog-title {
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 14px;
    border-bottom: 1px solid #444;
    padding-bottom: 8px;
}
.settings-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    font-size: 14px;
}
.settings-label {
    width: 70px;
    color: #aaa;
    flex-shrink: 0;
}
.settings-input {
    width: 70px;
    background: #2a2a3c;
    border: 1px solid #555;
    color: #eee;
    padding: 4px 6px;
    border-radius: 4px;
}
.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 14px;
}
.btn-confirm {
    background: #4a9eff;
    border: none;
    color: #fff;
    padding: 6px 16px;
    border-radius: 5px;
    cursor: pointer;
}
.btn-cancel {
    background: #444;
    border: none;
    color: #ddd;
    padding: 6px 16px;
    border-radius: 5px;
    cursor: pointer;
}
.btn-batch {
    background: #9b59b6;
    border: none;
    color: #fff;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

/* 批量播放进度面板 */
.playlist-progress-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: #1a1a2e;
    border: 1px solid #4a9eff;
    border-radius: 8px;
    padding: 8px 14px;
    margin-bottom: 10px;
    font-size: 14px;
}
.pl-progress-text {
    color: #ddd;
    flex: 1;
}
.pl-controls button {
    background: #333;
    border: 1px solid #555;
    color: #eee;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}
.pl-controls button:hover {
    background: #4a9eff;
    border-color: #4a9eff;
}
```

- [ ] **Step 7: 手动自测**

1. 控制端媒体库打开一个含子文件夹的文件夹 → 文件夹项显示「批量播放」按钮
2. 点击 → 弹出设置框，默认排序「按文件名」、循环勾选、播报文件名不勾选
3. 选随机 → 排序方式/播放方向置灰
4. 确认 → 显示端开始批量播放，进度面板显示「第 1/N 项 · 文件名 · ▶ 播放中」
5. 点击暂停/继续/上一个/下一个/停止 → 显示端响应，面板状态更新
6. 批量播放中播放单个文件 → 面板消失（打断）

- [ ] **Step 8: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/js/media-library.js src/apps/web-mediacenter/ui/public/css/upload.css
git commit -m "feat: 控制端批量播放入口（文件夹按钮、模式设置框、进度面板与干预）"
```

---

### Task 5: 临时模式批量上传（裁剪区多选）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/upload.js`
  - `init()` 中 cropPreviewContainer 的 drop 处理（206-223 行）
  - `sendTempFile` 之后新增批量上传方法

**Interfaces:**
- Consumes: Task 4 的 `MediaLibrary.showPlaylistSettingsDialog({title, hideRecursive, onConfirm})`、`WebSocketManager.sendPlaylistRequest(payload)`、已有 `fileToBase64(file)`、`getMediaDimensions(file, base64)`、`detectMediaType(name)`
- Produces: `handleDroppedFiles(dataTransfer)`、`collectFile(entry, out)`、`collectDir(entry, out)`、`prepareTempFiles(files)`、`showBatchTempUpload(files)`

- [ ] **Step 1: 新增批量临时文件处理函数**

在 `sendTempFile` 方法（155 行结束）之后插入：

```js
    // 处理拖入/粘贴的多文件（含文件夹递归收集）
    async handleDroppedFiles(dataTransfer) {
        const files = [];
        const entries = Array.from(dataTransfer.items || [])
            .map(i => (i.webkitGetAsEntry && i.webkitGetAsEntry()) || null);
        const hasDir = entries.some(e => e && e.isDirectory);
        if (hasDir) {
            // 含文件夹：递归收集
            for (const entry of entries) {
                if (!entry) continue;
                if (entry.isDirectory) {
                    await this.collectDir(entry, files);
                } else if (entry.isFile) {
                    await this.collectFile(entry, files);
                }
            }
        } else {
            for (const f of dataTransfer.files) files.push(f);
        }
        if (files.length === 0) return;
        if (files.length === 1) {
            this.sendTempFile(files[0]);
        } else {
            this.showBatchTempUpload(files);
        }
    },

    collectFile(entry, out) {
        return new Promise(resolve => {
            entry.file(f => { out.push(f); resolve(); }, () => resolve());
        });
    },

    async collectDir(entry, out) {
        const reader = entry.createReader();
        const readAll = () => new Promise(resolve => {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) { resolve(); return; }
                for (const e of entries) {
                    if (e.isDirectory) {
                        await this.collectDir(e, out);
                    } else if (e.isFile) {
                        await this.collectFile(e, out);
                    }
                }
                await readAll();
                resolve();
            }, () => resolve());
        });
        await readAll();
    },

    // 批量临时文件转为 base64 数组
    async prepareTempFiles(files) {
        const totalBytes = files.reduce((s, f) => s + f.size, 0);
        // base64 膨胀约 33%，预留 500MB maxPayload 余量
        if (totalBytes > 350 * 1024 * 1024) {
            showToast('批量临时文件总大小不能超过 350MB', 'error');
            return null;
        }
        for (const f of files) {
            if (f.size > 300 * 1024 * 1024) {
                showToast(`${f.name} 超过 300MB，已跳过`, 'error');
            }
        }
        showToast('正在读取文件...', 'loading');
        const items = [];
        for (const f of files) {
            try {
                const base64 = await this.fileToBase64(f);
                const dims = await this.getMediaDimensions(f, base64);
                items.push({
                    name: f.name,
                    data: base64,
                    mediaType: this.detectMediaType(f.name),
                    mimeType: f.type || undefined,
                    modifiedTime: f.lastModified,
                    width: dims?.width,
                    height: dims?.height
                });
            } catch (err) {
                showToast(`读取 ${f.name} 失败: ${err.message}`, 'error');
            }
        }
        return items;
    },

    // 弹出共用设置框，确认后批量发送
    showBatchTempUpload(files) {
        if (!window.MediaLibrary) {
            showToast('媒体库模块未初始化', 'error');
            return;
        }
        window.MediaLibrary.showPlaylistSettingsDialog({
            title: '临时模式批量播放设置',
            hideRecursive: true,
            onConfirm: async (settings) => {
                const items = await this.prepareTempFiles(files);
                if (!items || items.length === 0) return;
                if (window.WebSocketManager) {
                    window.WebSocketManager.sendPlaylistRequest({
                        temp: true,
                        files: items,
                        ...settings
                    });
                    showToast('批量播放请求已发送', 'success');
                }
            }
        });
    },
```

- [ ] **Step 2: cropPreviewContainer drop 改多文件处理**

将 `init()` 中 drop 监听（216-222 行）：

```js
            previewContainer.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                previewContainer.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file) this.sendTempFile(file);
            });
```

替换为：

```js
            previewContainer.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                previewContainer.classList.remove('drag-over');
                this.handleDroppedFiles(e.dataTransfer);
            });
```

（粘贴事件保持单文件 `sendTempFile` 不变）

- [ ] **Step 3: 手动自测**

1. 控制端显示控制面板裁剪区拖入多个文件 → 弹出「临时模式批量播放设置」框（无扫描范围选项）
2. 确认 → 显示端开始批量播放（base64 数据缓存播放）
3. 拖入文件夹（含子文件夹）→ 递归收集全部媒体文件后弹框播放
4. 单文件拖入 → 仍走原有 sendTempFile 单文件播放（不弹框）
5. 总大小超 350MB → 提示错误不发送

- [ ] **Step 4: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/js/upload.js
git commit -m "feat: 临时模式批量上传（裁剪区多文件/文件夹，设置框后批量播放）"
```

---

### Task 6: 项目文档更新

**Files:**
- Modify: `docs/todo.md`（新增批量播放任务 → 完成后移除）
- Modify: `docs/design/media-library.md` 或新建 `docs/design/batch-playlist.md`（批量播放设计记录）
- Modify: `docs/spec/media-library.md` 或新建 `docs/spec/batch-playlist.md`（伪代码实现文档，与代码同步）
- Modify: `changelog.md`（新功能记录）
- Modify: `docs/superpowers/specs/2026-08-14-batch-playlist-design.md`（如实现中发现设计偏差则同步修正）

- [ ] **Step 1: 更新 todo.md**

在 todo.md 对应媒体库/显示模块下添加任务项（如「批量播放模式：文件夹级播放列表、循环、临时模式批量」），按项目既有格式。

- [ ] **Step 2: 新建/更新 design 与 spec 文档**

按 CLAUDE.md 规范：
- `docs/design/batch-playlist.md`：功能需求描述（从 superpowers 设计文档提炼，记录已确认的决策：服务端生成列表、混合播控、循环默认开、排序默认按文件名、播报文件名默认关、打断规则、临时批量入口）
- `docs/spec/batch-playlist.md`：伪代码描述（PlaylistManager、服务端消息处理、显示端循环、控制端设置框/进度面板、临时批量），与实际代码同步

- [ ] **Step 3: 更新 changelog.md**

在 changelog.md 记录：批量播放模式新功能（含改动文件清单）。

- [ ] **Step 4: 全量回归自测**

按设计文档「测试计划」11 条全部执行一遍（递归/单层、排序正反、随机洗牌、循环、播报文件名、干预、打断、空文件夹、临时多选、重连恢复、既有功能回归）。

- [ ] **Step 5: 提交**

```bash
git add docs/todo.md docs/design/batch-playlist.md docs/spec/batch-playlist.md changelog.md
git commit -m "docs: 批量播放模式实现文档（design/spec/todo/changelog）"
```
