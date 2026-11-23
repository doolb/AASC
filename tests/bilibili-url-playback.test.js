'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/js/upload.js');

function setup(value) {
    const sent = [];
    const input = { value };
    const window = { WebSocketManager: { sendMedia: item => sent.push(item) } };
    const document = { getElementById: () => input, addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, document, URL, showToast() {}, console });
    return { upload: window.Upload, sent, input };
}

test('B 站 BV 视频与分集转为官方播放器并发送到显示端', () => {
    const { upload, sent, input } = setup('https://www.bilibili.com/video/BV1B7411m7LV?p=3&spm=other');
    upload.uploadByUrl();
    assert.equal(sent.length, 1);
    const player = new URL(sent[0].url);
    assert.equal(player.origin, 'https://player.bilibili.com');
    assert.equal(player.pathname, '/player.html');
    assert.equal(player.searchParams.get('bvid'), 'BV1B7411m7LV');
    assert.equal(player.searchParams.get('p'), '3');
    assert.equal(player.searchParams.get('autoplay'), '1');
    assert.equal(sent[0].mediaType, 'html');
    assert.equal(input.value, '');
});

test('其他 URL 与伪造 B 站域名保持原有处理', () => {
    for (const value of ['https://example.com/video/BV1B7411m7LV', 'https://www.bilibili.com.evil.test/video/BV1B7411m7LV']) {
        const { upload, sent } = setup(value);
        upload.uploadByUrl();
        assert.equal(sent[0].url, value);
    }
    const { upload, sent } = setup('https://example.com/movie.mp4');
    upload.uploadByUrl();
    assert.equal(sent[0].mediaType, 'video');
});

test('代理的图片和视频按原始媒体类型发送，地址保持不变', () => {
    const image = 'https://cosplaytele.com/wp-content/uploads/example.webp';
    const video = 'https://pela.iwara.tv/view?hash=abc&filename=example_360.mp4&path=2026%2F11%2F15';
    for (const [source, expected] of [[image, 'image'], [video, 'video'], ['https://cossora.stream/api-embed/123/index.m3u8?token=x', 'video'], ['https://fast.kiko-play-niptan.one/media/stream/a.m4a', 'audio'], ['https://example.com/video.mp4?filename=download', 'video']]) {
        const value = `http://192.168.1.39:3089/api/proxy?url=${encodeURIComponent(source)}`;
        const { upload, sent } = setup(value);
        upload.uploadByUrl();
        assert.equal(sent[0].url, value);
        assert.equal(sent[0].mediaType, expected);
    }
    for (const value of ['https://example.com/page', 'https://example.com/page?file=x.jpg']) {
        const { upload, sent } = setup(value);
        upload.uploadByUrl();
        assert.equal(sent[0].mediaType, 'html');
    }
    for (const [value, expected] of [['https://example.com/a.jpg?size=large', 'image'], ['https://example.com/a.MP4?token=x', 'video'], ['https://example.com/a.gif', 'gif']]) {
        const { upload, sent } = setup(value);
        upload.uploadByUrl();
        assert.equal(sent[0].mediaType, expected);
    }
});

test('显示端 iframe 显式允许自动播放和全屏', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    assert.match(html, /<iframe id="mediaHtml"[^>]*allow="autoplay; fullscreen"/);
});
