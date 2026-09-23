'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    parseCliArguments,
    selectSyncComponents,
    syncOfflineUpdate
} = require('../scripts/ops/sync-offline-update');
const { signManifestPayload } = require('../scripts/ops/offline-update-package');

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function createFixture() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-offline-sync-'));
    const localRoot = path.join(root, 'published');
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
    const files = {
        'code/code-v2.zip': Buffer.from('new-code'),
        'dependencies/dependencies-v2.zip': Buffer.from('new-dependencies'),
        'apk/aasc-display-offline-min-v4.apk': Buffer.from('new-min-apk')
    };
    const components = {
        code: {
            version: 2,
            requiredDependencyVersion: 2,
            requiredLockSha256: 'a'.repeat(64),
            relativeUrl: 'code/code-v2.zip',
            size: files['code/code-v2.zip'].length,
            sha256: sha256(files['code/code-v2.zip'])
        },
        dependencies: {
            version: 2,
            lockSha256: 'a'.repeat(64),
            relativeUrl: 'dependencies/dependencies-v2.zip',
            size: files['dependencies/dependencies-v2.zip'].length,
            sha256: sha256(files['dependencies/dependencies-v2.zip'])
        },
        apkMin: {
            versionCode: 4,
            versionName: '0.2.2-offline-min',
            packageName: 'com.aasc.display.offline',
            signerSha256: 'b'.repeat(64),
            modelCompatibilitySha256: 'c'.repeat(64),
            relativeUrl: 'apk/aasc-display-offline-min-v4.apk',
            size: files['apk/aasc-display-offline-min-v4.apk'].length,
            sha256: sha256(files['apk/aasc-display-offline-min-v4.apk'])
        },
        apkFull: {
            versionCode: 4,
            relativeUrl: 'apk/aasc-display-offline-v4.apk',
            size: 999,
            sha256: 'd'.repeat(64)
        }
    };
    const payload = {
        schemaVersion: 1,
        generatedAt: '2026-09-23T00:00:00.000Z',
        components
    };
    const manifest = { payload, signature: signManifestPayload(payload, privateKeyPem) };
    const server = http.createServer((request, response) => {
        if (request.url === '/mnt/aasc-offline/manifest.json') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(manifest));
            return;
        }
        const relativePath = request.url?.replace('/mnt/aasc-offline/', '');
        const content = files[relativePath];
        if (content) {
            response.writeHead(200, { 'content-length': content.length });
            response.end(content);
            return;
        }
        response.writeHead(404);
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return {
        root,
        localRoot,
        publicKeyPem,
        manifest,
        server,
        sourceUrl: `http://127.0.0.1:${address.port}/mnt/aasc-offline/`
    };
}

async function closeFixture(fixture) {
    await new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve()));
    await fs.promises.rm(fixture.root, { recursive: true, force: true });
}

test('sync CLI parses source and local target overrides', () => {
    assert.deepEqual(parseCliArguments([
        '--source-url', 'http://example.test/a/',
        '--local-root=/tmp/aasc-offline',
        '--public-key', '/tmp/public.pem'
    ]), {
        sourceUrl: 'http://example.test/a/',
        localRoot: '/tmp/aasc-offline',
        publicKey: '/tmp/public.pem'
    });
    assert.throws(() => parseCliArguments(['--source-url=a', '--source-url=b']), /重复/);
});

test('sync downloads only manifest service components and preserves full APK files', async (t) => {
    const fixture = await createFixture();
    t.after(() => closeFixture(fixture));
    await fs.promises.mkdir(path.join(fixture.localRoot, 'code'), { recursive: true });
    await fs.promises.mkdir(path.join(fixture.localRoot, 'dependencies'), { recursive: true });
    await fs.promises.mkdir(path.join(fixture.localRoot, 'apk'), { recursive: true });
    await fs.promises.writeFile(path.join(fixture.localRoot, 'code/code-v1.zip'), 'old-code');
    await fs.promises.writeFile(path.join(fixture.localRoot, 'dependencies/dependencies-v1.zip'), 'old-dependencies');
    await fs.promises.writeFile(path.join(fixture.localRoot, 'apk/aasc-display-offline-min-v3.apk'), 'old-min');
    await fs.promises.writeFile(path.join(fixture.localRoot, 'apk/aasc-display-offline-v1.apk'), 'keep-full');

    const result = await syncOfflineUpdate({
        sourceUrl: fixture.sourceUrl,
        localRoot: fixture.localRoot,
        publicKeyPem: fixture.publicKeyPem
    });

    assert.deepEqual(result.installed.sort(), ['apkMin', 'code', 'dependencies']);
    assert.deepEqual(result.skipped, []);
    assert.equal(fs.existsSync(path.join(fixture.localRoot, 'code/code-v1.zip')), false);
    assert.equal(fs.existsSync(path.join(fixture.localRoot, 'dependencies/dependencies-v1.zip')), false);
    assert.equal(fs.existsSync(path.join(fixture.localRoot, 'apk/aasc-display-offline-min-v3.apk')), false);
    assert.equal(fs.readFileSync(path.join(fixture.localRoot, 'apk/aasc-display-offline-v1.apk'), 'utf8'), 'keep-full');
    assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(fixture.localRoot, 'manifest.json'), 'utf8')),
        fixture.manifest);
    assert.deepEqual(selectSyncComponents(fixture.manifest).map(({ name }) => name), [
        'code', 'dependencies', 'apkMin'
    ]);
});

test('sync refuses same-version hash conflicts before replacing the manifest', async (t) => {
    const fixture = await createFixture();
    t.after(() => closeFixture(fixture));
    await fs.promises.mkdir(path.join(fixture.localRoot, 'code'), { recursive: true });
    await fs.promises.writeFile(path.join(fixture.localRoot, 'code/code-v2.zip'), 'wrong-content');
    await fs.promises.writeFile(path.join(fixture.localRoot, 'manifest.json'), '{"old":true}\n');

    await assert.rejects(syncOfflineUpdate({
        sourceUrl: fixture.sourceUrl,
        localRoot: fixture.localRoot,
        publicKeyPem: fixture.publicKeyPem
    }), /同版本资源已有不同内容/);
    assert.equal(await fs.promises.readFile(path.join(fixture.localRoot, 'manifest.json'), 'utf8'), '{"old":true}\n');
});
