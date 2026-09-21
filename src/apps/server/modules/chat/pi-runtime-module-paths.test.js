'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
    getActiveNodeModulesRoot,
    resolveActivePiModule
} = require('./pi-runtime-module-paths');

test('Pi 模块优先解析 active dependency 根的入口', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-pi-module-path-'));
    try {
        const entry = path.join(root, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js');
        await fsp.mkdir(path.dirname(entry), { recursive: true });
        await fsp.writeFile(entry, 'export {};\n', 'utf8');

        const resolved = resolveActivePiModule(
            '@earendil-works/pi-coding-agent',
            'dist/index.js',
            { nodeModulesRoot: root }
        );
        assert.equal(resolved, require('node:url').pathToFileURL(entry).href);
        assert.equal(getActiveNodeModulesRoot({ nodeModulesRoot: root }), root);
    } finally {
        await fsp.rm(root, { recursive: true, force: true });
    }
});

test('active Pi 入口不存在时保留兼容裸包回退', () => {
    assert.equal(
        resolveActivePiModule('@earendil-works/pi-ai', 'dist/index.js', {
            nodeModulesRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-pi-module-empty-')),
            fallbackSpecifier: '@earendil-works/pi-ai/compat'
        }),
        '@earendil-works/pi-ai/compat'
    );
});
