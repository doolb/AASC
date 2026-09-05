'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test, afterEach } = require('node:test');
const {
    createBootstrap,
    parseArguments,
    validateArchiveEntry
} = require('../scripts/termux/aasc-server-bootstrap.cjs');

const execFileAsync = promisify(execFile);
const temporaryRoots = [];

function createRoot(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temporaryRoots.push(root);
    return root;
}

function writeRelease(root, marker) {
    fs.mkdirSync(path.join(root, 'src/apps/server/boot'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/apps/server/boot/server-app.js'), `module.exports = ${JSON.stringify(marker)};`);
    fs.writeFileSync(path.join(root, 'src/apps/server/boot/server-launcher.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'aasc-test', version: marker }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'aasc-test', version: marker }));
}

async function makeArchive(root, archivePath) {
    await execFileAsync('tar', [
        '-czf',
        archivePath,
        '-C',
        root,
        'src',
        'package.json',
        'package-lock.json'
    ]);
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Bootstrap 成功更新代码并保留配置、资源、依赖和日志', async () => {
    const projectRoot = createRoot('aasc-bootstrap-root-');
    const releaseRoot = createRoot('aasc-bootstrap-release-');
    const archiveRoot = createRoot('aasc-bootstrap-archive-');
    writeRelease(projectRoot, 'old');
    writeRelease(releaseRoot, 'new');
    fs.mkdirSync(path.join(projectRoot, 'src/apps/android-display/local-build'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src/apps/android-display/local-build/keep.txt'), 'keep local source');
    fs.mkdirSync(path.join(projectRoot, 'config'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'res/uploads'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'node_modules/keep'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'config/config.json'), 'keep config');
    fs.writeFileSync(path.join(projectRoot, 'res/uploads/media.jpg'), 'keep media');
    fs.writeFileSync(path.join(projectRoot, 'node_modules/keep/index.js'), 'keep dependency');
    fs.writeFileSync(path.join(projectRoot, 'logs/server.jsonl'), 'keep log');
    const archivePath = path.join(archiveRoot, 'release.tar.gz');
    await makeArchive(releaseRoot, archivePath);
    const events = [];
    const bootstrap = createBootstrap({
        projectRoot,
        serverUrl: 'https://main.example:8081',
        requestJson: async () => ({
            status: 'success',
            manifest: {
                version: 'new',
                size: fs.statSync(archivePath).size,
                sha256: sha256(archivePath),
                packageUrl: '/server/package?version=new',
                files: ['src', 'package.json', 'package-lock.json']
            }
        }),
        downloadPackage: async (url, targetPath) => fs.promises.copyFile(archivePath, targetPath),
        serviceController: {
            async stop() { events.push('stop'); },
            async start() { events.push('start'); }
        },
        healthCheck: async () => true
    });

    const result = await bootstrap.update();

    assert.deepEqual(result, { success: true, version: 'new', rolledBack: false });
    assert.deepEqual(events, ['stop', 'start']);
    assert.match(fs.readFileSync(path.join(projectRoot, 'src/apps/server/boot/server-app.js'), 'utf8'), /new/);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'src/apps/android-display/local-build/keep.txt'), 'utf8'), 'keep local source');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'config/config.json'), 'utf8'), 'keep config');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'res/uploads/media.jpg'), 'utf8'), 'keep media');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'node_modules/keep/index.js'), 'utf8'), 'keep dependency');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'logs/server.jsonl'), 'utf8'), 'keep log');
});

test('Bootstrap 健康检查失败时恢复旧代码并重启服务', async () => {
    const projectRoot = createRoot('aasc-bootstrap-rollback-root-');
    const releaseRoot = createRoot('aasc-bootstrap-rollback-release-');
    const archiveRoot = createRoot('aasc-bootstrap-rollback-archive-');
    writeRelease(projectRoot, 'old');
    writeRelease(releaseRoot, 'broken');
    const archivePath = path.join(archiveRoot, 'release.tar.gz');
    await makeArchive(releaseRoot, archivePath);
    const events = [];
    const bootstrap = createBootstrap({
        projectRoot,
        requestJson: async () => ({
            manifest: {
                version: 'broken',
                size: fs.statSync(archivePath).size,
                sha256: sha256(archivePath),
                packageUrl: '/server/package',
                files: ['src', 'package.json', 'package-lock.json']
            }
        }),
        downloadPackage: async (url, targetPath) => fs.promises.copyFile(archivePath, targetPath),
        serviceController: {
            async stop() { events.push('stop'); },
            async start() { events.push('start'); }
        },
        healthCheck: async () => false
    });

    const result = await bootstrap.update();

    assert.equal(result.success, false);
    assert.equal(result.version, 'broken');
    assert.equal(result.rolledBack, true);
    assert.deepEqual(events, ['stop', 'start', 'stop', 'start']);
    assert.match(fs.readFileSync(path.join(projectRoot, 'src/apps/server/boot/server-app.js'), 'utf8'), /old/);
});

test('Bootstrap 在包校验失败或路径越界时不会停止服务', async () => {
    const projectRoot = createRoot('aasc-bootstrap-invalid-root-');
    const archiveRoot = createRoot('aasc-bootstrap-invalid-archive-');
    writeRelease(projectRoot, 'old');
    const archivePath = path.join(archiveRoot, 'release.tar.gz');
    await makeArchive(projectRoot, archivePath);
    const events = [];
    const bootstrap = createBootstrap({
        projectRoot,
        requestJson: async () => ({
            manifest: {
                version: 'invalid',
                size: fs.statSync(archivePath).size + 1,
                sha256: sha256(archivePath),
                packageUrl: '/server/package',
                files: ['src', 'package.json', 'package-lock.json']
            }
        }),
        downloadPackage: async (url, targetPath) => fs.promises.copyFile(archivePath, targetPath),
        serviceController: {
            async stop() { events.push('stop'); },
            async start() { events.push('start'); }
        }
    });

    const result = await bootstrap.update();

    assert.equal(result.success, false);
    assert.equal(result.rolledBack, false);
    assert.deepEqual(events, []);
    assert.throws(() => validateArchiveEntry('../escape.txt'), /危险路径/);
    assert.throws(() => validateArchiveEntry('logs/server.jsonl'), /非白名单路径/);
});

test('Bootstrap 参数支持固定主服务器、项目目录和服务名覆盖', () => {
    assert.deepEqual(parseArguments([
        'update',
        '--server-url', 'https://192.168.1.39:8081',
        '--project-root', '/data/data/com.termux/files/home/aasc-server-test',
        '--service-name', 'aasc-server-test'
    ]), {
        command: 'update',
        serverUrl: 'https://192.168.1.39:8081',
        projectRoot: '/data/data/com.termux/files/home/aasc-server-test',
        serviceName: 'aasc-server-test'
    });
});

test('Bootstrap run 模式复用 server-launcher 并只 fork server-app 服务进程', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts/termux/aasc-server-bootstrap.cjs'), 'utf8');

    assert.match(source, /createServerLauncher/);
    assert.match(source, /serverPath/);
    assert.match(source, /processArguments: \['--no-tui'\]/);
    assert.match(source, /createRunitServiceController/);
});
