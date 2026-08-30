'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '../../../../..');
const manifestPath = path.join(projectRoot, '3rd/chat2api-core/UPSTREAM.md');

test('上游清单必须记录版本、许可证和排除的 Electron 文件', () => {
    assert.equal(fs.existsSync(manifestPath), true, '上游清单尚未建立');

    const { readUpstreamManifest } = require('./chat2api-upstream-sync');
    const manifest = readUpstreamManifest(projectRoot);
    assert.equal(manifest.license, 'GPL-3.0');
    assert.ok(manifest.version);
    assert.ok(manifest.commit);
    assert.ok(manifest.includedPaths.some((item) => item.includes('providers/builtin')));
    assert.ok(manifest.excludedPaths.some((item) => item.toLowerCase().includes('electron')));
    assert.ok(manifest.excludedPaths.some((item) => item.toLowerCase().includes('renderer')));
});
