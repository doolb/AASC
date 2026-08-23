'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

// 防止显示端移除逐句请求或忽略带定位标签的专用 TTS 回包，导致翻页时串音。
test('显示端保留逐句 TTS 请求、定位回包和失败跳过协议', () => {
    const display = readFile('src/apps/web-mediacenter/ui/public/display.html');
    const player = readFile('src/apps/web-mediacenter/ui/public/js/text-media-player.js');

    assert.match(display, /src="\/js\/sentence-splitter\.js"/u);
    assert.match(display, /data\.textPlayback[\s\S]*?TextMediaPlayer\.handleTtsAudio\(data\)/u);
    assert.match(display, /data\.type === 'textSentenceTtsError'[\s\S]*?TextMediaPlayer\.handleTtsError\(data\)/u);
    assert.match(player, /type:\s*'textSentenceTts'/u);
    assert.match(player, /playbackId,[\s\S]*?pageIndex,[\s\S]*?sentenceIndex,[\s\S]*?text:/u);
});

// 防止服务器启动时遗漏文本协议路由，致使显示端请求落入通用回退或无响应。
test('服务器启动注册 textSentenceTts 路由并接入文本媒体服务', () => {
    const server = readFile('src/apps/server/boot/server-app.js');
    const integration = readFile('src/apps/server/modules/media/text-media-ws-integration.js');

    assert.match(server, /createTextMediaTtsService/u);
    assert.match(server, /registerTextMediaDisplayHandlers\([\s\S]*?textMediaTtsService/u);
    assert.match(integration, /wsServer\.registerHandler\('textSentenceTts'/u);
    assert.match(integration, /handleSentenceRequest\(ctx\.displayId, data\)/u);
    assert.match(integration, /data\.action === 'textStyle'/u);
    assert.match(integration, /data\.action === 'textPlayback'/u);
});

// 防止任一控制面板改用播放列表命令或丢失固定主题色与排版字段。
test('控制端文本面板发送完整 textStyle，并以 textPlayback 控制分页', () => {
    const controls = readFile('src/apps/web-mediacenter/ui/public/js/controls.js');
    const floating = readFile('src/apps/web-mediacenter/ui/public/js/floating-control.js');

    assert.match(controls, /showTextModePanel\(\)/u);
    assert.match(controls, /background:\s*'#FFF4B8'/u);
    assert.match(controls, /color:\s*'#333333'/u);
    assert.match(controls, /fontSize:[\s\S]*?lineHeight:[\s\S]*?pageMargin:/u);
    assert.match(controls, /sendControl\('textStyle', textStyle\)/u);
    assert.match(controls, /sendControl\('textPlayback', \{ action \}\)/u);
    assert.match(floating, /showTextModePanel\(\)[\s\S]*?Controls\.showTextModePanel\(\)/u);
    assert.match(floating, /sendControl\('textPlayback', \{ action \}\)/u);
});
