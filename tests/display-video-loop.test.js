'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');

function sliceFunction(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start);
    assert.ok(start >= 0, `${name} should exist`);
    assert.ok(end > start, `${nextName} should exist after ${name}`);
    return source.slice(start, end);
}

test('single video playback restores mediaVideo loop', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    const showMediaSource = sliceFunction(source, 'showMedia', 'reportPlayState');

    const loopTrueCount = (showMediaSource.match(/mediaVideo\.loop = true;/g) || []).length;
    assert.strictEqual(loopTrueCount, 2, 'URL and base64 video branches should both enable loop');
});

test('playlist video keeps loop disabled to advance after ended', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    const playCurrentItemSource = sliceFunction(source, 'playCurrentItem', 'playlistNext');

    assert.match(
        playCurrentItemSource,
        /item\.mediaType === 'video'[\s\S]*mediaVideo\.loop = false;/
    );
});
