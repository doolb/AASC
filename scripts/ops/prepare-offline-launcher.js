'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PREFIX, SHARED } = require('../../src/apps/server/boot/offline-launcher/launcher-identity');

/** 内置基线独立于服务Runtime manifest，min空安装也能执行；不把它加入动态库允许列表。 */
async function prepareOfflineLauncher(projectRoot, outputDir) {
    const entries = [...SHARED];
    async function collect(relative) {
        const directory = path.join(projectRoot, relative);
        for (const name of (await fs.readdir(directory)).sort()) {
            const child = `${relative}/${name}`; const stat = await fs.lstat(path.join(projectRoot, child));
            if (stat.isSymbolicLink()) throw new Error('启动器源码不能为符号链接');
            if (stat.isDirectory()) await collect(child);
            else if (stat.isFile() && /\.(js|json|html)$/.test(name) && !/\.test\.js$/.test(name)) entries.push(child);
            else throw new Error('启动器目录包含非生产资源');
        }
    }
    await collect(PREFIX);
    const files = [];
    for (const relative of entries.sort()) {
        const bytes = await fs.readFile(path.join(projectRoot, relative));
        const destination = path.join(outputDir, 'offline-launcher', relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes);
        files.push({ path: relative, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
    const id = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
    const manifest = { schemaVersion: 1, hostApi: 1, stateApi: 1, id, files };
    await fs.writeFile(path.join(outputDir, 'offline-launcher-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}
module.exports = { prepareOfflineLauncher, PREFIX, SHARED };
