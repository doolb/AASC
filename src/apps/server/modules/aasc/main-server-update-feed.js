'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const shared = require('./shared-update-manifest');
const archive = require('./update-archive');

function normalizeServerUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('主服务器地址无效');
    return url.origin;
}
function artifactUrl(serverUrl, entry, group) {
    const url = new URL(group ? '/server/dependencies' : '/server/package', serverUrl);
    if (group) url.searchParams.set('group', group);
    url.searchParams.set('version', entry.version); url.searchParams.set('sha256', entry.sha256);
    return url.href;
}
function validateManifest(response, serverUrl, options = {}) {
    const manifest = response?.manifest || response;
    shared.verifyManifest(manifest, options.publicKeyPem || shared.PUBLIC_KEY, { requireGroups: true });
    const { code, dependencies } = manifest.payload.components;
    const group = shared.selectTarget(options);
    shared.assertRuntime(dependencies.groups[group].target, options);
    return { ...code, lockSha256: code.requiredLockSha256, codeVersion: `v${code.version}`, dependencies, group,
        downloadUrl: artifactUrl(serverUrl, code), manifest };
}
function request(url, consume, timeoutMs = 8000, allowSelfSigned = false) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.get(parsed, { rejectUnauthorized: !allowSelfSigned }, async response => {
            if (response.statusCode !== 200) {
                response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return;
            }
            response.once('error', reject);
            try { resolve(await consume(response)); } catch (error) { response.destroy(); reject(error); }
        });
        // 总时限防止慢速响应永久占用事务；不自动跟随重定向到其他更新来源。
        const deadline = setTimeout(() => req.destroy(new Error('主服务器更新请求超时')), timeoutMs);
        req.once('close', () => clearTimeout(deadline));
        req.once('error', reject);
    });
}

async function requestJson(url, allowSelfSigned = false) {
    return request(url, async response => {
        const chunks = []; let size = 0;
        for await (const chunk of response) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error('主服务器JSON响应过大');
            chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }, 8000, allowSelfSigned);
}

function withForce(url, force) {
    if (!force) return url;
    const parsed = new URL(url); parsed.searchParams.set('force', `${Date.now()}-${crypto.randomUUID()}`); return parsed.href;
}

async function fetchManifest(options = {}) {
    const serverUrl = normalizeServerUrl(options.serverUrl);
    const manifest = await (options.requestJson || requestJson)(withForce(new URL('/server', serverUrl).href, options.force), true);
    return { ...validateManifest(manifest, serverUrl, options), serverUrl };
}

async function hashFile(filePath) {
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
    return digest.digest('hex');
}

async function downloadCode(candidate, destination, options = {}) {
    const url = withForce(candidate.downloadUrl, options.force);
    if (options.download) await options.download(url, destination);
    else await request(url, async response => {
        let received = 0;
        const limit = new Transform({ transform(chunk, encoding, next) {
            received += chunk.length;
            if (received <= candidate.size && options.onProgress) options.onProgress(received, candidate.size);
            next(received > candidate.size ? new Error('代码包超过清单大小') : null, chunk);
        } });
        await pipeline(response, limit, fs.createWriteStream(destination, { flags: 'wx' }));
    }, 300000, true);
    const stat = await fs.promises.lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== candidate.size || await hashFile(destination) !== candidate.sha256) {
        throw new Error('主服务器代码包大小/SHA-256校验失败');
    }
}


async function downloadDependency(candidate, group, destination, options) {
    const entry = candidate.dependencies.groups[group];
    await downloadCode({ ...entry, downloadUrl: artifactUrl(candidate.serverUrl, entry, group) }, destination, options);
}
module.exports = { normalizeServerUrl, validateManifest, fetchManifest, requestJson, downloadCode, downloadDependency,
    hashFile: archive.hashFile, extractCodeZip: (file, directory) => archive.extractZip(file, directory, 'code') };
