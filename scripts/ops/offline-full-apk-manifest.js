'use strict';

const { signManifestPayload, validateSignedManifestEnvelope, verifySignedManifest } = require('./offline-update-package');

const FULL_APK_MANIFEST_FILE = 'full-apk-manifest.json';
const FULL_APK_FORMAT = 'aasc-offline-full-apk';
const MAX_INDEX_BYTES = 64 * 1024;

function validateFullApkManifest(manifest, publicKeyPem, options = {}) {
    validateSignedManifestEnvelope(manifest);
    if (!options.skipSignatureVerification) verifySignedManifest(manifest, publicKeyPem);
    const payload = manifest.payload;
    const apk = payload.apkFull;
    const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
    if (payload.format !== FULL_APK_FORMAT || payload.schemaVersion !== 1 || !apk
        || apk.profile !== 'allserver' || apk.updateOnly !== false || apk.packageName !== 'com.aasc.display.offline'
        || !Number.isSafeInteger(apk.versionCode) || apk.versionCode < 1
        || typeof apk.versionName !== 'string' || !apk.versionName.trim()
        || apk.relativeUrl !== `apk/aasc-display-offline-v${apk.versionCode}.apk`
        || !Number.isSafeInteger(apk.size) || apk.size < 1 || !hash(apk.sha256) || !hash(apk.signerSha256)) {
        throw new Error('完整 APK 独立索引格式、版本、路径或哈希无效');
    }
    return apk;
}

function createFullApkManifest(metadata, privateKeyPem) {
    const payload = { format: FULL_APK_FORMAT, schemaVersion: 1, generatedAt: new Date().toISOString(), apkFull: metadata };
    const manifest = { payload, signature: signManifestPayload(payload, privateKeyPem) };
    validateFullApkManifest(manifest, null, { skipSignatureVerification: true });
    return manifest;
}

/** 404 兼容旧发布源；损坏、超时和未通过签名的索引必须失败，不能当作没有 full APK。 */
async function readFullApkManifest(sourceUrl, publicKeyPem, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
    try {
        const response = await (options.fetchImpl || globalThis.fetch)(new URL(FULL_APK_MANIFEST_FILE, sourceUrl), {
            signal: controller.signal, redirect: 'error', cache: 'no-store'
        });
        if (response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok || !response.body) throw new Error(`读取完整 APK 索引失败，HTTP ${response.status}`);
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            const bytes = Buffer.from(chunk);
            size += bytes.length;
            if (size > MAX_INDEX_BYTES) throw new Error('完整 APK 索引超过大小上限');
            chunks.push(bytes);
        }
        let manifest;
        try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { throw new Error('完整 APK 索引不是有效 JSON'); }
        validateFullApkManifest(manifest, publicKeyPem, options);
        return manifest;
    } finally { clearTimeout(timeout); }
}

module.exports = { FULL_APK_MANIFEST_FILE, createFullApkManifest, validateFullApkManifest, readFullApkManifest };
