'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, afterEach } = require('node:test');
const { ServerReleaseService } = require('../src/apps/server/modules/aasc/server-release-service');

const execFileAsync = promisify(execFile);
const temporaryRoots = [];

function createFixture() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-release-'));
    temporaryRoots.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, 'src/apps/server/boot'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'res/tasks'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, '3rd/example'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'node_modules/example'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src/apps/server/boot/server-app.js'), 'module.exports = "release";');
    fs.writeFileSync(path.join(projectRoot, 'src/runtime.js'), 'module.exports = true;');
    fs.writeFileSync(path.join(projectRoot, 'res/tasks/example.js'), 'user task data');
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"aasc-test","version":"9.9.9"}');
    fs.writeFileSync(path.join(projectRoot, 'package-lock.json'), '{"name":"aasc-test","lockfileVersion":3}');
    fs.writeFileSync(path.join(projectRoot, 'logs/server.jsonl'), 'private log');
    fs.writeFileSync(path.join(projectRoot, '3rd/example/private.js'), 'private third party');
    fs.writeFileSync(path.join(projectRoot, 'node_modules/example/private.js'), 'private dependency');
    return projectRoot;
}

afterEach(() => {
    for (const projectRoot of temporaryRoots.splice(0)) {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('发布清单包含版本、大小、SHA-256和白名单文件，并可读取压缩包', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot, version: 'test-1' });

    const manifest = await service.getManifest();
    assert.equal(manifest.version, 'test-1');
    assert.equal(manifest.packageUrl, '/server/package?version=test-1');
    assert.ok(manifest.size > 0);
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.files, ['src', 'package.json', 'package-lock.json']);

    const packageInfo = await service.createPackage();
    assert.equal(packageInfo.size, manifest.size);
    assert.equal(packageInfo.sha256, manifest.sha256);
    const { stdout } = await execFileAsync('tar', ['-tzf', packageInfo.filePath]);
    assert.match(stdout, /src\/apps\/server\/boot\/server-app\.js/);
    assert.match(stdout, /package-lock\.json/);
    assert.doesNotMatch(stdout, /res\/tasks|logs|3rd|node_modules|config|cert/);
});

test('相同版本重复读取清单复用已生成压缩包', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot, version: 'test-cache' });

    const first = await service.createPackage();
    const second = await service.createPackage();
    assert.equal(second.filePath, first.filePath);
    assert.equal(second.sha256, first.sha256);
});

test('并发读取同一版本时只复用一个打包任务', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot, version: 'test-concurrent' });

    const results = await Promise.all([
        service.createPackage(),
        service.createPackage(),
        service.createPackage()
    ]);
    assert.equal(new Set(results.map(result => result.filePath)).size, 1);
    assert.equal(new Set(results.map(result => result.sha256)).size, 1);
});
