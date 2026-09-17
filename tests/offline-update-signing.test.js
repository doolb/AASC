'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    loadOfflineUpdateKeyPair,
    resolveOfflineUpdateKeyPaths
} = require('../scripts/ops/offline-update-signing');

async function createKeyFiles(t, algorithm = 'rsa') {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-update-key-test-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const keyPair = crypto.generateKeyPairSync(algorithm, algorithm === 'rsa'
        ? { modulusLength: 2048 }
        : { namedCurve: 'prime256v1' });
    const privateKeyPath = path.join(directory, 'private.pem');
    const publicKeyPath = path.join(directory, 'public.pem');
    await fs.promises.writeFile(privateKeyPath,
        keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await fs.promises.writeFile(publicKeyPath,
        keyPair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    return { directory, privateKeyPath, publicKeyPath, keyPair };
}

test('offline update key paths default to ~/.config/aasc-user and allow explicit path overrides', () => {
    const resolved = resolveOfflineUpdateKeyPaths({
        homeDir: '/tmp/aasc-home',
        privateKeyPath: '/tmp/signer-private.pem',
        publicKeyPath: '/tmp/signer-public.pem'
    });
    assert.equal(resolved.privateKeyPath, '/tmp/signer-private.pem');
    assert.equal(resolved.publicKeyPath, '/tmp/signer-public.pem');

    const defaults = resolveOfflineUpdateKeyPaths({ homeDir: '/tmp/aasc-home' });
    assert.equal(defaults.privateKeyPath,
        '/tmp/aasc-home/.config/aasc-user/offline-update-private.pem');
    assert.equal(defaults.publicKeyPath,
        '/tmp/aasc-home/.config/aasc-user/offline-update-public.pem');
});

test('loader accepts a matching RSA PEM pair and returns only usable signing material', async (t) => {
    const files = await createKeyFiles(t);
    const loaded = await loadOfflineUpdateKeyPair(files);
    const signer = crypto.createSign('RSA-SHA256');
    signer.update('offline update fixture', 'utf8');
    signer.end();
    const signature = signer.sign(loaded.privateKeyPem);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update('offline update fixture', 'utf8');
    verifier.end();

    assert.equal(verifier.verify(loaded.publicKeyPem, signature), true);
    assert.equal(loaded.privateKeyPath, files.privateKeyPath);
    assert.equal(loaded.publicKeyPath, files.publicKeyPath);
});

test('loader rejects public keys that do not match the private key', async (t) => {
    const files = await createKeyFiles(t);
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    await fs.promises.writeFile(files.publicKeyPath,
        other.publicKey.export({ type: 'spki', format: 'pem' }));

    await assert.rejects(loadOfflineUpdateKeyPair(files), /不匹配/);
});

test('loader rejects a private key file readable by group or other users', async (t) => {
    const files = await createKeyFiles(t);
    await fs.promises.chmod(files.privateKeyPath, 0o644);

    await assert.rejects(loadOfflineUpdateKeyPair(files), /权限过宽/);
});

test('loader rejects symbolic-link key files', async (t) => {
    const files = await createKeyFiles(t);
    const linkPath = path.join(files.directory, 'private-link.pem');
    await fs.promises.symlink(files.privateKeyPath, linkPath);

    await assert.rejects(loadOfflineUpdateKeyPair({
        privateKeyPath: linkPath,
        publicKeyPath: files.publicKeyPath
    }), /符号链接/);
});

test('loader rejects non-RSA key pairs', async (t) => {
    const files = await createKeyFiles(t, 'ec');

    await assert.rejects(loadOfflineUpdateKeyPair(files), /RSA/);
});
