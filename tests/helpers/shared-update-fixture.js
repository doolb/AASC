'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const shared = require('../../src/apps/server/modules/aasc/shared-update-manifest');
const archive = require('../../src/apps/server/modules/aasc/update-archive');
const { deterministicZip } = require('../../scripts/ops/dependency-groups');
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
function write(root, file, body) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), body); }
async function fixture(t, extra = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-groups-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const published = path.join(root, 'published'); const source = path.join(root, 'source');
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { express: '4.21.2' } }, 'node_modules/express': { version: '4.21.2' } } });
    for (const [file, body] of Object.entries({ 'package.json': '{"version":"1.0.0","dependencies":{"express":"4.21.2"}}', 'package-lock.json': lock,
        'src/apps/server/boot/server-app.js': 'new code', 'src/apps/server/boot/server-launcher.js': 'launcher', ...extra })) write(source, file, body);
    write(root, 'src/apps/server/boot/server-app.js', 'old code'); write(root, 'node_modules/express/package.json', '{"version":"4.0.0"}');
    for (const file of ['config/config.json', 'res/tasks/test/results/index.json', 'res/models/keep.bin', 'logs/keep.log']) write(root, file, 'keep');
    const codeArchive = path.join(published, 'code/code-v2.zip');
    fs.mkdirSync(path.dirname(codeArchive), { recursive: true });
    const makeCode = () => { if (fs.existsSync(codeArchive)) fs.unlinkSync(codeArchive); execFileSync('zip', ['-X', '-q', '-r', codeArchive, '.'], { cwd: source }); };
    makeCode();
    const groups = {};
    async function group(name, files = {}, version = 1) {
        const directory = path.join(root, `layer-${name}-${version}`); fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
        for (const [relative, body] of Object.entries(files)) write(directory, `node_modules/${relative}`, body);
        const target = name === 'common' ? null : shared.TARGETS[name];
        const contentSha256 = await archive.contentHash(path.join(directory, 'node_modules'));
        write(directory, 'dependency-group.json', JSON.stringify({ group: name, version, contentSha256, target }));
        const relativeUrl = `dependencies/${name}/dependencies-v${version}.zip`; const file = path.join(published, relativeUrl);
        fs.mkdirSync(path.dirname(file), { recursive: true }); await deterministicZip(directory, file);
        groups[name] = { version, relativeUrl, size: fs.statSync(file).size, sha256: await archive.hashFile(file), contentSha256, target };
    }
    for (const name of shared.GROUPS) await group(name, name === 'common' ? { 'express/package.json': '{"version":"4.21.2"}', 'express/index.js': 'module.exports = {};' } : {});
    const manifest = { payload: { schemaVersion: 1, components: {
        code: { version: 2, relativeUrl: 'code/code-v2.zip', size: 1, sha256: '', requiredDependencyVersion: 1, requiredLockSha256: shared.hash(lock) },
        dependencies: { version: 1, lockSha256: shared.hash(lock), groups }
    } } };
    async function sign() {
        const { code, dependencies } = manifest.payload.components;
        code.size = fs.statSync(codeArchive).size; code.sha256 = await archive.hashFile(codeArchive);
        dependencies.sha256 = shared.hash(shared.canonicalJson(groups)); dependencies.size = Object.values(groups).reduce((sum, entry) => sum + entry.size, 0);
        manifest.signature = { algorithm: 'SHA256withRSA', value: crypto.sign('RSA-SHA256', Buffer.from(shared.canonicalJson(manifest.payload)), privateKeyPem).toString('base64') };
        write(published, 'manifest.json', JSON.stringify(manifest));
    }
    await sign();
    const events = []; const downloads = [];
    const options = { projectRoot: root, serverUrl: 'https://main.test:8081', publicKeyPem,
        requestJson: async () => ({ manifest }), download: async (url, destination) => {
            const parsed = new URL(url); downloads.push(parsed);
            const entry = parsed.pathname === '/server/package' ? manifest.payload.components.code : groups[parsed.searchParams.get('group')];
            await fs.promises.copyFile(path.join(published, entry.relativeUrl), destination);
        }, serviceController: { async stop() { events.push('stop'); }, async start(context) { events.push(['start', context.codeVersion]); } }, healthCheck: async () => true };
    return { root, published, source, lock, manifest, options, events, downloads, codeArchive, sign, group, makeCode, write: (file, body) => write(root, file, body), publicKeyPem };
}
module.exports = { fixture, publicKeyPem, privateKeyPem, write };
