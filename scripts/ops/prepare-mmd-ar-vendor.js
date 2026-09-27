#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_ROOT = path.resolve(__dirname, '../../src/apps/web-mediacenter/ui/public');
const RESOURCES = Object.freeze([
    {
        path: 'js/vendor/aframe-1.5.0/aframe.min.js',
        url: 'https://aframe.io/releases/1.5.0/aframe.min.js',
        size: 1390001,
        sha256: '4fe911ce356f034b05da1a00d3a205ec19c8cf9de0ea17592cc6481b2cb98afb'
    },
    {
        path: 'js/vendor/aframe-1.5.0/LICENSE',
        url: 'https://raw.githubusercontent.com/aframevr/aframe/v1.5.0/LICENSE',
        size: 1081,
        sha256: '62ad4012d4dca628fccc35994e4d5bbd41991225f402642e31145d97f641a9cd'
    },
    {
        path: 'js/vendor/mind-ar-1.2.5/mindar-image-aframe.prod.js',
        url: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js',
        size: 1758446,
        sha256: '42764d6f1b39387f5786b9c4cfbe50883e13ca3f47b42bf1e54e84510b374013'
    },
    {
        path: 'js/vendor/mind-ar-1.2.5/mindar-image.prod.js',
        url: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js',
        size: 266,
        sha256: 'a21eef9a98ed73aee589a219b35e580c50b501c6f50f88d6eed16dcef9b8dec2'
    },
    {
        path: 'js/vendor/mind-ar-1.2.5/controller-mGt1s8dJ.js',
        url: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/controller-mGt1s8dJ.js',
        size: 2199370,
        sha256: '98a90806c01077a46fc5a3daddc6441ac9d61c5b85b3cc09d3f0b2087d228713'
    },
    {
        path: 'js/vendor/mind-ar-1.2.5/ui-fBadYuor.js',
        url: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/ui-fBadYuor.js',
        size: 4552,
        sha256: 'aed9538fec28fecfb0a564da48fbf053ac2549d3314746e67182d381b3a24c31'
    },
    {
        path: 'js/vendor/mind-ar-1.2.5/LICENSE',
        url: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/LICENSE',
        size: 1063,
        sha256: '4f3aa5215ac0346a823170c9f9677da25c3e8bdb8243693118a3711e157d7fff'
    },
    {
        path: 'assets/mindar-official-card.mind',
        url: 'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.2/examples/image-tracking/assets/card-example/card.mind',
        size: 256972,
        sha256: '85b6ca67a4a9b78556be69f81149abc1e5845bb548e871854e1aaea1be96ab75'
    }
]);

function verifyBuffer(buffer, resource) {
    return buffer.length === resource.size
        && crypto.createHash('sha256').update(buffer).digest('hex') === resource.sha256;
}

async function ensureResource(resource) {
    const destination = path.join(PUBLIC_ROOT, resource.path);
    const existing = await fs.readFile(destination).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing) {
        if (!verifyBuffer(existing, resource)) throw new Error(`本地 AR 资源校验失败：${resource.path}`);
        process.stdout.write(`[MMD AR vendor] 已校验 ${resource.path}\n`);
        return;
    }
    const response = await fetch(resource.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`下载 AR 资源失败 HTTP ${response.status}：${resource.url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!verifyBuffer(buffer, resource)) throw new Error(`下载 AR 资源校验失败：${resource.path}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer, { flag: 'wx' });
    process.stdout.write(`[MMD AR vendor] 已安装 ${resource.path}\n`);
}

async function main() {
    for (const resource of RESOURCES) await ensureResource(resource);
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`[MMD AR vendor] ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { RESOURCES, ensureResource, verifyBuffer };
