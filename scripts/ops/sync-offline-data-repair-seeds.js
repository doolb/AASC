'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadOfflineUpdatePublicKey } = require('./offline-update-signing');
const { verifySignedManifest } = require('./offline-update-package');
const { validatePendingRepair, sha256Buffer } = require('../../src/apps/server/modules/data-repair/data-repair-js-runner');
const { prepareReleaseRepairs } = require('./offline-data-repair-seeds');

async function syncExistingRepairs(options) {
    const { publicKeyPem } = await loadOfflineUpdatePublicKey(options);
    const repairs = [];
    for (const entry of options.entries) {
        const manifest = JSON.parse(await fs.readFile(entry.manifest, 'utf8'));
        verifySignedManifest(manifest, publicKeyPem);
        const metadata = manifest.payload.components.dataRepair;
        validatePendingRepair({ ...metadata, format: 'aasc-offline-data-repair', schemaVersion: 1, script: 'repair.js' });
        const script = path.resolve(entry.script);
        const stat = await fs.lstat(script);
        if (!stat.isFile() || stat.isSymbolicLink() || sha256Buffer(await fs.readFile(script)) !== metadata.scriptSha256) {
            throw new Error('已有修复脚本与签名元数据不一致');
        }
        repairs.push({ script, metadata });
    }
    repairs.sort((a, b) => a.metadata.repairVersion - b.metadata.repairVersion);
    const transaction = await prepareReleaseRepairs({ projectRoot: options.projectRoot, repairs,
        outputDir: options.outputDir || path.join(options.projectRoot, 'release/offline-update/output') });
    try { await transaction.commit(); return transaction.baseline; }
    finally { await transaction.dispose(); }
}

function parseArguments(args) {
    if (!args.length) return ['voiceprint-tts-v1', 'hide-offline-display-status-bar-v2'].map(directory => ({
        manifest: path.join(__dirname, '../../release/offline-update/repair-sources', directory, 'manifest.json'),
        script: path.join(__dirname, '../../release/offline-update/repair-sources', directory, 'repair.js')
    }));
    const entries = [];
    for (let index = 0; index < args.length; index += 4) {
        if (args[index] !== '--manifest' || !args[index + 1] || args[index + 2] !== '--script' || !args[index + 3]) {
            throw new Error('每个已有修复使用 --manifest <签名清单> --script <repair.js>，可以重复');
        }
        entries.push({ manifest: args[index + 1], script: args[index + 3] });
    }
    if (entries.length < 1 || entries.length > 32) throw new Error('已有修复数量必须在1到32之间');
    return entries;
}

if (require.main === module) {
    (async () => {
        const baseline = await syncExistingRepairs({ projectRoot: path.resolve(__dirname, '../..'), entries: parseArguments(process.argv.slice(2)) });
        process.stdout.write(`release数据版本=${baseline.dataVersion}，已包含修复=${baseline.includedRepairs.length}\n`);
    })()
        .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
module.exports = { syncExistingRepairs, parseArguments };
