'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Writable } = require('node:stream');
const { fixture } = require('./helpers/shared-update-fixture');
const { ServerReleaseService } = require('../src/apps/server/modules/aasc/server-release-service');

async function serviceFixture(t) {
    const f = await fixture(t); return { ...f, service: new ServerReleaseService({ releaseRoot: f.published, publicKeyPem: f.publicKeyPem }) };
}
test('读取相同共享签名清单；build入口只验证现有文件', async t => {
    const f = await serviceFixture(t);
    assert.deepEqual(await f.service.getManifest(), f.manifest);
    const result = await f.service.buildPackage(); assert.equal(result.filePath, f.codeArchive); assert.equal(result.sha256, f.manifest.payload.components.code.sha256);
    assert.equal(fs.existsSync(path.join(f.root, 'res/temp/aasc-server-release')), false);
});
test('最新清单原子替换后立即读取新组合，不缓存旧manifest', async t => {
    const f = await serviceFixture(t); await f.service.getManifest();
    await f.group('linux64', { 'platform/new.txt': 'new' }, 2);
    f.manifest.payload.components.dependencies.version = 2; f.manifest.payload.components.code.requiredDependencyVersion = 2; await f.sign();
    assert.equal((await f.service.getManifest()).payload.components.dependencies.version, 2);
});
test('同大小文件篡改也触发SHA-256重验，不复用旧缓存', async t => {
    const f = await serviceFixture(t); await f.service.getManifest();
    const content = fs.readFileSync(f.codeArchive); content[20] ^= 1; fs.writeFileSync(f.codeArchive, content);
    await assert.rejects(f.service.getManifest(), /SHA-256/);
});
test('过期版本或指纹返回409；未知组/路径不能读取', async t => {
    const f = await serviceFixture(t);
    await assert.rejects(f.service.streamPackage({}, { version: 1, sha256: 'a'.repeat(64) }), { statusCode: 409 });
    await assert.rejects(f.service.streamPackage({}, {}, '../config'), /未知/);
});
test('流式下载的字节与Offline相同ZIP完全一致', async t => {
    const f = await serviceFixture(t); const parts = []; const headers = {};
    const response = new Writable({ write(chunk, encoding, done) { parts.push(chunk); done(); } }); response.setHeader = (name, value) => { headers[name] = value; };
    const code = f.manifest.payload.components.code;
    await f.service.streamPackage(response, { version: code.version, sha256: code.sha256 });
    assert.deepEqual(Buffer.concat(parts), fs.readFileSync(f.codeArchive)); assert.equal(headers['Content-Type'], 'application/zip');
});
test('发布根、manifest及依赖父目录链接都拒绝且不跟随', async t => {
    const f = await serviceFixture(t); const link = path.join(f.root, 'published-link'); fs.symlinkSync(f.published, link);
    await assert.rejects(new ServerReleaseService({ releaseRoot: link }).getManifest(), /符号链接/);
    fs.renameSync(path.join(f.published, 'dependencies'), path.join(f.root, 'outside'));
    fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.published, 'dependencies'));
    await assert.rejects(f.service.getManifest(), /符号链接/);
});
