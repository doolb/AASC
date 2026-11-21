'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('src/apps/web-mediacenter/ui/public/display.html', 'utf8');
const playlist = html.slice(html.indexOf('        function playCurrentItem(options = {}) {'), html.indexOf('        // 当前目录播放结束后'));
const fallback = html.slice(html.indexOf('        function setMediaSourceWithFallback('), html.indexOf('        function setMediaSourceWithFallback(') + 5000).split('\n        function ')[0];

for (const type of ['image', 'video', 'audio']) {
    test(`播放列表 ${type} 先尝试备用地址，全部失败后保持原有切换逻辑`, () => {
        const timers = new Map(); let nextTimer = 0;
        const element = () => ({ src: '', style: {}, addEventListener() {}, removeEventListener() {}, removeAttribute() {}, hasAttribute() { return false; }, load() {} });
        const image = element(), video = element(), audio = element();
        const ps = { active: true, paused: false, index: 0, interval: 50, playlist: [{ url: 'http://media/test', fallbackUrl: '/api/media-proxy?url=test', mediaType: type }] };
        const context = { playlistState: ps, mediaLoadSequence: 1, videoBlackBorders: { enabled: false }, location: { href: 'https://aasc/display', origin: 'https://aasc' }, URL,
            isSleepPaused: () => false, mediaLoopPlayers: [], mediaImage: image, mediaVideo: video, mediaAudio: audio, mediaHtml: element(),
            TextMediaPlayer: { attachPlaylist() {}, stop() {} }, sendPlaylistProgress() {}, playlistNext() {},
            setTimeout(fn) { let id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }
        };
        context.showMedia = data => context.setMediaSourceWithFallback({ image, video, audio }[type], data.url, data.fallbackUrl, type !== 'image');
        vm.runInNewContext(fallback + '\n' + playlist, context);
        context.playCurrentItem();
        const target = { image, video, audio }[type];
        assert.equal(target.src, 'http://media/test');
        target.onerror();
        assert.equal(target.src, '/api/media-proxy?url=test');
        assert.equal(timers.size, type === 'image' ? 1 : 0);
        target.onerror();
        assert.equal(timers.size, 1, '备用地址也失败后只调度一次下一项');
    });
}
