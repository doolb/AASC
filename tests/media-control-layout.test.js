const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const uploadSource = fs.readFileSync(
    path.join(__dirname, '../src/apps/web-mediacenter/ui/public/upload.html'),
    'utf8'
);

test('主媒体播放区域应将音量滑条放在播放进度滑条下面', () => {
    const mediaSection = uploadSource.match(
        /<div class="control-item">\s*<label>媒体播放<\/label>[\s\S]*?<div class="control-item">\s*<label>文本模式/u
    )?.[0];

    assert.ok(mediaSection, '应找到媒体播放到文本模式之间的主控制区');
    assert.match(
        mediaSection,
        /id="progressSlider"[\s\S]*?<div class="media-volume-control">[\s\S]*?id="volumeSlider"/u
    );
});

test('快捷控制面板应继续保留独立音量滑条', () => {
    assert.match(uploadSource, /id="floatingVolumeSlider"/u);
});
