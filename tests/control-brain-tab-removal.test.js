'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'src/apps/web-mediacenter/ui/public');

function readPublicFile(relativePath) {
    return fs.readFileSync(path.join(publicDir, relativePath), 'utf8');
}

test('控制端不再暴露日志大脑页签', () => {
    const html = readPublicFile('upload.html');
    const mainJs = readPublicFile('js/main.js');
    const css = readPublicFile('css/upload.css');
    const viewerPath = path.join(publicDir, 'js/log-brain-viewer.js');

    assert.doesNotMatch(html, /data-target=["']brain["']/);
    assert.doesNotMatch(html, /id=["']panel-brain["']/);
    assert.doesNotMatch(html, /log-brain-viewer\.js/);
    assert.doesNotMatch(mainJs, /LogBrainViewer/);
    assert.match(mainJs, /if \(!document\.getElementById\(`panel-\$\{lastPanel\}`\)\)/);
    assert.match(mainJs, /lastPanel = 'media';/);
    assert.doesNotMatch(css, /\.brain-[\w-]+/);
    assert.equal(fs.existsSync(viewerPath), false);
});

test('服务器端日志大脑能力仍然保留', () => {
    const serverApp = fs.readFileSync(
        path.join(root, 'src/apps/server/boot/server-app.js'),
        'utf8'
    );
    const api = fs.readFileSync(
        path.join(root, 'src/apps/server/api/log-brain-api.js'),
        'utf8'
    );

    assert.match(serverApp, /registerLogBrainApi/);
    assert.match(api, /\/api\/logs\/brain-summary/);
    assert.match(api, /\/api\/logs\/brain-judge/);
    assert.match(api, /\/api\/logs\/brain-diagnose/);
});
