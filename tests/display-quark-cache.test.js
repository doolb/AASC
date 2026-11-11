'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('逐目录切换等待缓存，过期缓存完成后不覆盖新媒体', async () => {
    const html = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');
    const start = html.indexOf('        function playCurrentItem(options = {}) {');
    const end = html.indexOf('        // 当前目录播放结束后', start);
    assert.ok(start >= 0 && end > start);
    let resolveFetch, progressCallback;
    const sent = [];
    const switches = [];
    const fakeMedia = { src: '', paused: false, ended: false, addEventListener() {}, removeEventListener() {}, pause() {}, style: {} };
    const ps = { active: true, paused: false, index: 0, interval: 500, playlist: [
        { url: 'https://other-host/api/media-libraries/q/proxy/a.mp4', mediaType: 'video', fileName: 'a', cacheBeforePlay: true, cacheNodeId: 'main-server', cacheLibraryId: 'q', cachePath: '/a.mp4' },
        { url: 'https://server.example/image.jpg', mediaType: 'image', fileName: 'b' }
    ] };
    const context = {
        playlistState: ps, isSleepPaused: () => false,
        displayWs: { readyState: 1, send: message => sent.push(JSON.parse(message)) }, WebSocket: { OPEN: 1 },
        window: { location: { href: 'https://server.example/display', origin: 'https://server.example' }, QuarkCacheProgress: { prepare: (url, onProgress) => { progressCallback = onProgress; assert.match(url, /^https:\/\/server\.example\/api\/media-libraries\/q\/proxy\/a\.mp4\?prepare=1$/); return new Promise(resolve => { resolveFetch = resolve; }); } } }, URL,
        mediaLoopPlayers: [], mediaVideo: fakeMedia, mediaAudio: fakeMedia, mediaImage: fakeMedia, mediaHtml: fakeMedia,
        TextMediaPlayer: { attachPlaylist() {}, stop() {} }, showMedia: data => switches.push(data),
        clearTimeout, setTimeout, sendPlaylistProgress() {}, console
    };
    vm.runInNewContext(html.slice(start, end), context);
    context.playCurrentItem();
    assert.equal(switches.length, 0);
    assert.equal(sent[0].status, 'caching');
    assert.equal(sent[0].cacheLibraryId, 'q');
    assert.equal(sent[0].cachePath, '/a.mp4');
    progressCallback({ phase: 'downloading', received: 5, total: 10 });
    assert.equal(sent.at(-1).status, 'progress');
    assert.equal(sent.at(-1).received, 5);
    ps.index = 1;
    progressCallback({ phase: 'downloading', received: 8, total: 10 });
    assert.equal(sent.at(-1).received, 5, '过期任务不再回传进度');
    resolveFetch({ ok: true, json: async () => ({ status: 'success' }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(switches.length, 0, '缓存期间切换项目后不能恢复旧视频');
    ps.index = 0;
    context.playCurrentItem();
    resolveFetch({ ok: true, json: async () => ({ status: 'success' }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(switches.length, 1);
    assert.equal(switches[0].mediaType, 'video');
});

test('B 站批量视频回退 MP4 后仍自动切换，旧项目错误不会影响当前项', () => {
    const html = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');
    const start = html.indexOf('        function playCurrentItem(options = {}) {');
    const end = html.indexOf('        // 当前目录播放结束后', start);
    const timers = [];
    const video = { addEventListener() {}, removeEventListener() {}, hasAttribute() { return false; }, style: {} };
    const ps = { active: true, paused: false, index: 0, interval: 50, playlist: [
        { url: 'http://server/api/bilibili/dash/BV1B7411m7LV?p=1', bilibiliDash: true, bilibiliMp4: 'http://server/api/bilibili/video/BV1B7411m7LV?p=1', mediaType: 'video' }
    ] };
    let mediaData;
    const context = { playlistState: ps, isSleepPaused: () => false, mediaLoopPlayers: [], mediaVideo: video,
        mediaAudio: video, mediaImage: video, mediaHtml: video, TextMediaPlayer: { attachPlaylist() {}, stop() {} },
        showMedia(data) { mediaData = data; video.onerror = () => {}; },
        clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; }, playlistNext() {}, sendPlaylistProgress() {} };
    vm.runInNewContext(html.slice(start, end), context);
    context.playCurrentItem();
    assert.equal(mediaData.bilibiliDash, true);
    assert.equal(mediaData.bilibiliMp4, ps.playlist[0].bilibiliMp4);
    video.loop = true;
    mediaData.onBilibiliFallback();
    assert.equal(video.loop, false);
    video.onerror();
    assert.equal(timers.length, 1);
    ps.index = 1;
    video.onerror?.();
    assert.equal(timers.length, 1);
});

test('B 站同源相对 MP4 地址在 DASH 失败时可以回退', () => {
    const html = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');
    const start = html.indexOf('                    const playMp4OrOfficial = () => {');
    const end = html.indexOf('                    // 单媒体/重连恢复', start);
    assert.ok(start >= 0 && end > start);
    let played;
    const context = {
        URL, window: { location: { href: 'http://localhost:3000/display.html' } },
        data: { bilibiliDash: true, bilibiliMp4: '/api/bilibili/video/BV1B7411m7LV?p=2', mediaType: 'video' },
        loadSequence: 1, mediaLoadSequence: 1, paused: false, mediaIsPlaying: true, resumeTime: 0,
        showMedia: value => { played = value; }
    };
    vm.runInNewContext(`${html.slice(start, end)}\nplayMp4OrOfficial();`, context);
    assert.equal(played.url, 'http://localhost:3000/api/bilibili/video/BV1B7411m7LV?p=2');
    assert.equal(played.bilibiliDash, false);
});
