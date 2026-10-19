'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const files = require('./files');

const UPDATE_SOURCES = Object.freeze(['http://192.168.1.39/mnt/aasc-offline/', 'http://10.221.70.87/mnt/aasc-offline/', 'http://c.aasc.us/mnt/aasc-offline/']);
const MODEL_SOURCES = Object.freeze(['http://192.168.1.39/mnt/aimodel/', 'http://10.221.70.87/mnt/aimodel/', 'https://c.aasc.us/mnt/aimodel/']);
/**
 * 仅热更公网目录把域名解析结果写入实际请求 URL。公网入口对域名 Host 返回 403，
 * 因此不能只给 http.get 指定连接 IP 而保留域名 Host；模型来源维持原来的 HTTPS 域名。
 * 每次请求重新解析，避免把公网 IP 固定在 APK 或热更代码中。
 */
async function resolveRequestUrl(url, lookup = dns.lookup) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('下载地址无效');
    if (parsed.protocol !== 'http:' || parsed.hostname !== 'c.aasc.us' || !parsed.pathname.startsWith('/mnt/aasc-offline/')) return parsed;
    const resolved = await lookup(parsed.hostname, { family: 4 });
    if (net.isIP(resolved?.address) !== 4) throw new Error('WAN热更域名未解析到IPv4地址');
    parsed.hostname = resolved.address;
    return parsed;
}
async function response(url, signal, timeout = 12000, lookup = dns.lookup) {
    signal?.throwIfAborted();
    const parsed = await resolveRequestUrl(url, lookup);
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const request = (parsed.protocol === 'https:' ? https : http).get(parsed, { signal }, result => {
            if (result.statusCode !== 200) { result.resume(); reject(new Error(`下载HTTP ${result.statusCode}`)); }
            else resolve(result);
        });
        request.setTimeout(timeout, () => request.destroy(new Error('下载连接超时')));
        request.once('error', reject);
    });
}
async function json(url, signal, limit = 2 * 1024 ** 2) {
    const stream = await response(url, signal, 4000);
    const chunks = []; let bytes = 0;
    for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > limit) { stream.destroy(); throw new Error('下载清单超过限制'); }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function download(root, sources, entry, destination, signal, progress = () => {}) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.relativeUrl !== 'string' || entry.relativeUrl.split('/').some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))) throw new Error('下载文件身份无效');
    files.safe(root, destination);
    if (await files.matches(root, destination, entry)) return destination;
    files.space(root, entry.size);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const temporary = files.safe(root, `${destination}.part`);
    let last;
    for (const source of sources) {
        signal?.throwIfAborted();
        await fs.promises.rm(temporary, { force: true });
        try {
            const input = await response(new URL(entry.relativeUrl, source), signal);
            const declared = input.headers['content-length'];
            if (declared !== undefined && Number(declared) !== entry.size) { input.destroy(); throw new Error('下载声明大小不匹配'); }
            let bytes = 0; const hash = crypto.createHash('sha256');
            const verifier = new Transform({ transform(chunk, _encoding, done) {
                bytes += chunk.length;
                if (bytes > entry.size) { done(new Error('下载内容超过声明大小')); return; }
                hash.update(chunk); progress(bytes, entry.size); done(null, chunk);
            } });
            await pipeline(input, verifier, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
            if (bytes !== entry.size || hash.digest('hex') !== entry.sha256) throw new Error('下载文件大小或SHA-256错误');
            signal?.throwIfAborted();
            const handle = await fs.promises.open(temporary, 'r');
            try { await handle.sync(); } finally { await handle.close(); }
            await fs.promises.rename(temporary, destination);
            return destination;
        } catch (error) { last = error; if (signal?.aborted) throw error; }
        finally { await fs.promises.rm(temporary, { force: true }); }
    }
    throw new Error(`下载源均不可用: ${last?.message}`);
}
module.exports = { UPDATE_SOURCES, MODEL_SOURCES, resolveRequestUrl, response, json, download };
