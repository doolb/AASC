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

test('未显式生成发布包时，读取清单不会自动打包', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot });

    await assert.rejects(
        service.getManifest(),
        /请先执行 npm run build:server-package/
    );
    assert.equal(
        fs.existsSync(path.join(projectRoot, 'res/temp/aasc-server-release/manifest.json')),
        false
    );
});

test('显式构建发布包后，清单和压缩包可读取', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot, version: 'test-1' });

    const packageInfo = await service.buildPackage();
    const manifest = await service.getManifest();

    assert.equal(manifest.version, 'test-1');
    assert.equal(manifest.packageUrl, '/server/package?version=test-1');
    assert.equal(manifest.size, packageInfo.size);
    assert.equal(manifest.sha256, packageInfo.sha256);
    assert.deepEqual(manifest.files, ['src', 'package.json', 'package-lock.json']);
    assert.equal(
        fs.existsSync(path.join(projectRoot, 'res/temp/aasc-server-release/manifest.json')),
        true
    );

    const { stdout } = await execFileAsync('tar', ['-tzf', packageInfo.filePath]);
    assert.match(stdout, /src\/apps\/server\/boot\/server-app\.js/);
    assert.match(stdout, /package-lock\.json/);
    assert.doesNotMatch(stdout, /res\/tasks|logs|3rd|node_modules|config|cert/);
});

test('清单读取会校验现有压缩包与 SHA-256 一致', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot, version: 'test-integrity' });

    const packageInfo = await service.buildPackage();
    fs.appendFileSync(packageInfo.filePath, 'tampered');

    await assert.rejects(
        service.getManifest(),
        /清单与代码包不一致/
    );
});

test('并发显式构建同一版本时只复用一个打包任务', async () => {
    const projectRoot = createFixture();
    const service = new ServerReleaseService({ projectRoot, version: 'test-concurrent' });

    const results = await Promise.all([
        service.buildPackage(),
        service.buildPackage(),
        service.buildPackage()
    ]);

    assert.equal(new Set(results.map(result => result.filePath)).size, 1);
    assert.equal(new Set(results.map(result => result.sha256)).size, 1);
});
