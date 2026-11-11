'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const service = require.resolve('../src/apps/server/modules/config/config-app-service');

function fixture(t, main, user) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-media-user-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const name of ['config', 'userconfig', 'task']) fs.mkdirSync(path.join(root, 'release', name), { recursive: true });
    const mainPath = path.join(root, 'release/config/config.json');
    const userPath = path.join(root, 'release/userconfig/userconfig.json');
    fs.writeFileSync(mainPath, JSON.stringify(main));
    fs.writeFileSync(userPath, JSON.stringify(user));
    return { root, mainPath, userPath };
}

function run(root, body) {
    return spawnSync(process.execPath, ['-e', `const c = require(${JSON.stringify(service)}); ${body}`], {
        env: { ...process.env, AASC_PROJECT_ROOT: root, AASC_RELEASE_MODE: '1' }, encoding: 'utf8'
    });
}

test('旧媒体配置迁移到用户目录，已有用户字段优先，后续写入可重启读取', t => {
    const f = fixture(t, { network: { webProxies: [{ id: 'old' }], globalWebProxy: '' }, media: { bilibiliVideos: [1], providerProxy: { old: 'old' } }, other: 9 },
        { network: { webProxies: [{ id: 'user' }] }, media: { providerProxy: { user: 'user' } }, keep: 7 });
    const first = run(f.root, "if (!c.set('media.shareFolders', {folder: 1}) || !c.set('network.webProxies', [{id: 'updated'}])) process.exit(8);");
    assert.equal(first.status, 0, first.stderr);
    const main = JSON.parse(fs.readFileSync(f.mainPath));
    const user = JSON.parse(fs.readFileSync(f.userPath));
    assert.equal(main.other, 9);
    assert.equal(Object.hasOwn(main, 'media'), false);
    assert.equal(Object.hasOwn(main, 'network'), false);
    assert.deepEqual(user.media.bilibiliVideos, [1]);
    assert.deepEqual(user.media.providerProxy, { user: 'user' });
    assert.deepEqual(user.media.shareFolders, { folder: 1 });
    assert.deepEqual(user.network.webProxies, [{ id: 'updated' }]);
    assert.equal(user.keep, 7);
    const second = run(f.root, "if (c.get('network.webProxies')[0].id !== 'updated' || c.get('media.shareFolders').folder !== 1) process.exit(9);");
    assert.equal(second.status, 0, second.stderr);
});

test('用户配置损坏时停止迁移并保留主配置', t => {
    const f = fixture(t, { media: { bilibiliVideos: [1] } }, {});
    fs.writeFileSync(f.userPath, '{invalid');
    const result = run(f.root, '');
    assert.notEqual(result.status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.mainPath)).media.bilibiliVideos, [1]);
    assert.equal(fs.readFileSync(f.userPath, 'utf8'), '{invalid');
});

test('用户配置写入失败时停止迁移且旧配置保留，恢复后可重试', t => {
    const f = fixture(t, { network: { webProxies: [{ id: 'old' }] }, media: { bilibiliVideos: [1] } }, {});
    const script = `const fs = require('node:fs'); const original = fs.renameSync; fs.renameSync = function(from, to) { if (String(to).endsWith('/userconfig/userconfig.json')) throw new Error('模拟写入失败'); return original.call(this, from, to); }; require(${JSON.stringify(service)});`;
    const failed = spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, AASC_PROJECT_ROOT: f.root, AASC_RELEASE_MODE: '1' }, encoding: 'utf8'
    });
    assert.notEqual(failed.status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.mainPath)).media.bilibiliVideos, [1]);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.userPath)), {});
    assert.equal(run(f.root, '').status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.userPath)).media.bilibiliVideos, [1]);
});
