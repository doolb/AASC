const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { updateBackgroundMedia } = require('../src/apps/server/modules/media/background-media');

test('背景状态验证输入并保留独立设置', () => {
    const initial = updateBackgroundMedia(null, { url: '/media/music.mp3', mediaType: 'audio', playing: true });
    assert.deepEqual(initial, { url: '/media/music.mp3', mediaType: 'audio', playing: true, loop: true, volume: 50 });
    const changed = updateBackgroundMedia(initial, { volume: 150, loop: false });
    assert.equal(changed.volume, 100);
    assert.equal(changed.playing, true);
    assert.equal(updateBackgroundMedia(changed, { url: '', playing: true }).playing, false);
    for (const url of ['javascript:alert(1)', '//example.com/a', '/\\example.com/a', 'https://']) {
        assert.equal(updateBackgroundMedia(initial, { url, mediaType: 'video' }), null);
    }
    assert.equal(updateBackgroundMedia(initial, { playing: 'true' }), null);
});

test('背景节点切换、休眠及恢复不会重新加载或操作主媒体', () => {
    function media() {
        return { style: {}, loads: 0, plays: 0, pauses: 0, load() { this.loads++; }, play() { this.plays++; return Promise.resolve(); }, pause() { this.pauses++; }, removeAttribute() { this.src = ''; } };
    }
    const video = media();
    const audio = media();
    const context = { window: {}, document: { getElementById(id) { return id === 'backgroundMediaVideo' ? video : audio; } }, console };
    vm.runInNewContext(fs.readFileSync('src/apps/web-mediacenter/ui/public/js/display-background-media.js', 'utf8'), context);
    const player = context.window.DisplayBackgroundMedia;
    const state = { url: '/music.mp3', mediaType: 'audio', playing: true, loop: true, volume: 50 };
    player.apply(state);
    player.apply({ ...state, volume: 25 });
    assert.equal(audio.loads, 1);
    assert.equal(audio.volume, 0.25);
    player.setSleeping(true);
    assert.equal(audio.pauses, 1);
    player.setSleeping(false);
    assert.equal(audio.plays, 3);
    player.apply({ ...state, url: '/video.mp4', mediaType: 'video', playing: false });
    assert.equal(video.style.display, 'block');
    assert.equal(video.plays, 0);
    player.setSleeping(true);
    player.setSleeping(false);
    assert.equal(video.plays, 0);
    player.apply({ ...state, url: '', playing: false });
    assert.equal(video.style.display, 'none');
});
