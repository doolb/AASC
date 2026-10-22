'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { stageVoiceDisplayNodePackage } = require('../scripts/ops/voice-display-node-package');
const {
    readAndValidateBundle,
    verifyHttpBundle,
    buildRemotePrepareCommand,
    buildRemoteTemporaryCheckCommand,
    buildRemoteInstallCommand,
    buildRemoteCleanupCommand,
    publishLocalBundle,
    parseCliArguments
} = require('../scripts/ops/publish-voice-display-node');
const { buildRemoteShellArguments } = require('../scripts/ops/publish-offline-update');
const { verifySignedManifest } = require('../scripts/ops/offline-update-package');

function createKeyPair() {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' })
    };
}

function createProjectFixture() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-voice-display-node-'));
    const appRoot = path.join(projectRoot, 'src/apps/voice-display-node');
    const frameworkRoot = path.join(projectRoot, 'src/framework/observability');
    fs.mkdirSync(path.join(appRoot, 'node_modules/ws'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'node_modules/.bin'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'run-task/task-private'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'models'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'logs'), { recursive: true });
    fs.mkdirSync(frameworkRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'main.js'), 'module.exports = true;\n');
    fs.writeFileSync(path.join(appRoot, 'README.md'), 'node app\n');
    fs.writeFileSync(path.join(appRoot, 'config.example.json'), '{"serverUrl":"http://127.0.0.1:3000"}\n');
    fs.writeFileSync(path.join(appRoot, 'config.json'), '{"serverUrl":"private-host"}\n');
    fs.writeFileSync(path.join(appRoot, 'run-task/task-private/task.js'), 'private task data\n');
    fs.writeFileSync(path.join(appRoot, 'models/local.onnx'), 'private model\n');
    fs.writeFileSync(path.join(appRoot, 'logs/client.log'), 'private log\n');
    fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
        name: 'voice-display-node', version: '1.0.0', main: 'main.js', dependencies: { ws: '8.16.0' }
    }));
    fs.writeFileSync(path.join(appRoot, 'package-lock.json'), JSON.stringify({ name: 'voice-display-node', lockfileVersion: 3 }));
    fs.writeFileSync(path.join(appRoot, 'node_modules/ws/package.json'), JSON.stringify({ name: 'ws' }));
    fs.symlinkSync('../ws/package.json', path.join(appRoot, 'node_modules/.bin/ws'));
    fs.writeFileSync(path.join(frameworkRoot, 'system-monitor.js'), 'module.exports = class SystemMonitor {};\n');
    fs.writeFileSync(path.join(frameworkRoot, 'console-redirect.js'), 'module.exports = { installConsoleRedirect() {} };\n');
    fs.mkdirSync(path.join(projectRoot, 'src/core/utils'), { recursive: true });
    fs.writeFileSync(path.join(path.join(projectRoot, 'src/core/utils'), 'sentence-splitter.js'), 'module.exports = { splitIntoSentences() { return []; } };\n');
    return { projectRoot, appRoot };
}

async function removeTree(directory) {
    await fs.promises.rm(directory, { recursive: true, force: true });
}

async function installStagedFiles(artifact) {
    await fs.promises.mkdir(path.dirname(artifact.archiveDestination), { recursive: true });
    await fs.promises.copyFile(artifact.archivePath, artifact.archiveDestination);
    await fs.promises.copyFile(artifact.metadataPath, artifact.metadataDestination);
}

test('standalone ZIP keeps runtime paths, dependencies and signed content identity while omitting local data', async t => {
    const fixture = createProjectFixture();
    const workDirectory = path.join(fixture.projectRoot, 'work');
    const outputDir = path.join(fixture.projectRoot, 'release/offline-update/output');
    await fs.promises.mkdir(workDirectory, { recursive: true });
    const keys = createKeyPair();
    t.after(() => removeTree(fixture.projectRoot));

    const artifact = await stageVoiceDisplayNodePackage({
        ...fixture, workDirectory, outputDir, version: 7, source: { gitCommit: 'abc123', gitDirty: false }, ...keys
    });
    await installStagedFiles(artifact);
    const listing = await require('node:child_process').execFileSync('unzip', ['-Z1', artifact.archivePath], { encoding: 'utf8' });
    const entries = listing.split(/\r?\n/u).filter(Boolean);
    assert.ok(entries.includes('src/apps/voice-display-node/main.js'));
    assert.ok(entries.includes('src/apps/voice-display-node/node_modules/ws/package.json'));
    assert.ok(entries.includes('src/apps/voice-display-node/config.example.json'));
    assert.ok(entries.includes('src/framework/observability/system-monitor.js'));
    assert.ok(entries.includes('src/framework/observability/console-redirect.js'));
    assert.ok(entries.includes('src/core/utils/sentence-splitter.js'));
    assert.ok(!entries.includes('src/apps/voice-display-node/config.json'));
    assert.ok(!entries.some(entry => entry.startsWith('src/apps/voice-display-node/run-task/')));
    assert.ok(!entries.some(entry => entry.startsWith('src/apps/voice-display-node/models/')));
    assert.ok(!entries.some(entry => entry.startsWith('src/apps/voice-display-node/logs/')));
    assert.ok(!entries.some(entry => entry.includes('node_modules/.bin/')));
    assert.equal(verifySignedManifest(artifact.metadata, keys.publicKeyPem), true);
    assert.equal(artifact.metadata.payload.version, 7);
    assert.equal(artifact.metadata.payload.size, fs.statSync(artifact.archivePath).size);

    const bundle = await readAndValidateBundle({ version: 7, artifactRoot: outputDir, ...keys });
    assert.equal(bundle.archiveExpected.sha256, artifact.metadata.payload.sha256);
});

test('standalone package rejects missing required dependencies and symbolic links outside excluded .bin', async t => {
    const fixture = createProjectFixture();
    const workDirectory = path.join(fixture.projectRoot, 'work');
    await fs.promises.mkdir(workDirectory, { recursive: true });
    const keys = createKeyPair();
    t.after(() => removeTree(fixture.projectRoot));

    await fs.promises.rm(path.join(fixture.appRoot, 'node_modules/ws'), { recursive: true });
    await assert.rejects(stageVoiceDisplayNodePackage({
        ...fixture, workDirectory, version: 1, ...keys
    }), /production 依赖缺失/u);
    assert.equal(fs.existsSync(path.join(fixture.projectRoot, 'voice-display-node-v1.zip')), false);

    await fs.promises.mkdir(path.join(fixture.appRoot, 'node_modules/ws'), { recursive: true });
    await fs.promises.writeFile(path.join(fixture.appRoot, 'node_modules/ws/package.json'), '{"name":"ws"}');
    await fs.promises.symlink('main.js', path.join(fixture.appRoot, 'unsafe-link.js'));
    await assert.rejects(stageVoiceDisplayNodePackage({
        ...fixture, workDirectory, version: 2, ...keys
    }), /不允许符号链接/u);
});

test('local publish verifies full HTTP bytes and removes only strict old version files', async t => {
    const fixture = createProjectFixture();
    const workDirectory = path.join(fixture.projectRoot, 'work');
    const outputDir = path.join(fixture.projectRoot, 'release/offline-update/output');
    const localRoot = path.join(fixture.projectRoot, 'published');
    await fs.promises.mkdir(workDirectory, { recursive: true });
    const keys = createKeyPair();
    t.after(() => removeTree(fixture.projectRoot));
    const artifact = await stageVoiceDisplayNodePackage({
        ...fixture, workDirectory, outputDir, version: 12, source: { gitCommit: 'abc123' }, ...keys
    });
    await installStagedFiles(artifact);
    const bundle = await readAndValidateBundle({ version: 12, artifactRoot: outputDir, ...keys });
    const targetDirectory = path.join(localRoot, 'voice-display-node');
    await fs.promises.mkdir(targetDirectory, { recursive: true });
    await fs.promises.writeFile(path.join(localRoot, 'manifest.json'), 'keep-service-manifest\n');
    await fs.promises.writeFile(path.join(targetDirectory, 'voice-display-node-v11.zip'), 'old archive');
    await fs.promises.writeFile(path.join(targetDirectory, 'voice-display-node-v11.json'), 'old metadata');
    await fs.promises.writeFile(path.join(targetDirectory, 'voice-display-node-v9-extra.zip'), 'keep non-version');
    await fs.promises.writeFile(path.join(targetDirectory, 'voice-display-node-v10.zip.tmp-123'), 'keep temporary');
    await fs.promises.mkdir(path.join(targetDirectory, 'voice-display-node-v8.json'));
    await fs.promises.symlink('missing-target', path.join(targetDirectory, 'voice-display-node-v7.zip'));
    const archiveBytes = await fs.promises.readFile(artifact.archivePath);
    const fakeFetch = async url => {
        if (String(url).endsWith('.json')) {
            return { ok: true, json: async () => artifact.metadata };
        }
        return { ok: true, body: Readable.from([archiveBytes]) };
    };

    const publishResult = await publishLocalBundle(bundle, {
        localRoot, localVerifyUrl: 'http://localhost/mnt/aasc-offline/',
        publicKeyPem: keys.publicKeyPem, fetchImpl: fakeFetch
    });
    assert.equal(publishResult.http.size, archiveBytes.length);
    assert.equal(publishResult.http.sha256, artifact.metadata.payload.sha256);
    assert.ok(!fs.existsSync(path.join(targetDirectory, 'voice-display-node-v11.zip')));
    assert.ok(!fs.existsSync(path.join(targetDirectory, 'voice-display-node-v11.json')));
    assert.equal(fs.readFileSync(path.join(localRoot, 'manifest.json'), 'utf8'), 'keep-service-manifest\n');
    assert.equal(fs.lstatSync(path.join(targetDirectory, 'voice-display-node-v7.zip')).isSymbolicLink(), true);
    assert.ok(fs.existsSync(path.join(targetDirectory, 'voice-display-node-v9-extra.zip')));
    assert.ok(fs.existsSync(path.join(targetDirectory, 'voice-display-node-v10.zip.tmp-123')));
    assert.ok(fs.statSync(path.join(targetDirectory, 'voice-display-node-v8.json')).isDirectory());
    assert.deepEqual(publishResult.cleanup.errors, []);
});

test('remote cleanup is scoped to versioned Node ZIP and sidecar files under the separate directory', () => {
    const command = buildRemoteCleanupCommand({ host: 'as@120.79.245.103', directory: '~/a/aasc-offline' }, 42);
    assert.match(command, /voice-display-node-v\*\.zip/u);
    assert.match(command, /voice-display-node-v\*\.json/u);
    assert.match(command, /\*\[!0-9\]\*/u);
    assert.match(command, /voice-display-node-v42\.zip\|voice-display-node-v42\.json/u);
    assert.doesNotMatch(command, /manifest\.json|logs|models|results/u);
    assert.throws(() => buildRemoteCleanupCommand({ host: 'as@120.79.245.103', directory: '~/../outside' }, 42), /远端目录/u);
    assert.deepEqual(buildRemoteShellArguments(command).slice(0, 2), ['/bin/sh', '-c']);
    execFileSync('/bin/sh', ['-n', '-c', command]);
    execFileSync('/bin/sh', ['-n', '-c', buildRemotePrepareCommand({ host: 'as@120.79.245.103', directory: '~/a/aasc-offline' })]);
    execFileSync('/bin/sh', ['-n', '-c', buildRemoteTemporaryCheckCommand({ host: 'as@120.79.245.103', directory: '~/a/aasc-offline' },
        'voice-display-node/voice-display-node-v42.zip', 'fixture')]);
    execFileSync('/bin/sh', ['-n', '-c', buildRemoteInstallCommand({ host: 'as@120.79.245.103', directory: '~/a/aasc-offline' },
        'voice-display-node/voice-display-node-v42.zip', { sha256: 'a'.repeat(64) }, 'fixture')]);
    assert.equal(parseCliArguments(['--version', '42']).remote.directory, '~/a/aasc-offline');
    assert.throws(() => parseCliArguments(['--version', '0']), /正整数/u);
});

test('HTTP verification rejects a different detached signature even when metadata is parseable', async () => {
    const keys = createKeyPair();
    const metadata = { payload: { schemaVersion: 1, component: 'voiceDisplayNode', version: 1 }, signature: { algorithm: 'SHA256withRSA', value: 'invalid' } };
    const bundle = {
        metadataExpected: { relativePath: 'voice-display-node/voice-display-node-v1.json' },
        archiveExpected: { relativePath: 'voice-display-node/voice-display-node-v1.zip', size: 1, sha256: 'a'.repeat(64) },
        metadata
    };
    await assert.rejects(verifyHttpBundle('http://localhost/', bundle, keys.publicKeyPem, async () => ({
        ok: true,
        json: async () => metadata
    })), /签名验证失败/u);
});
