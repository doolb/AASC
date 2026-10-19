'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');

const PREFIX = 'src/apps/server/boot/offline-launcher';
const SHARED = [
    'src/apps/server/modules/aasc/shared-update-manifest.js',
    'src/apps/server/modules/aasc/task-code-contract.js',
    'src/apps/server/modules/aasc/dependency-tree.js',
    'src/apps/server/modules/model-distribution/offline-model-catalog.json'
];

/** 启动器依赖的全部文件按路径和实际字节形成稳定身份；服务业务文件不参与。 */
async function launcherIdentity(root) {
    const own = (await files.walk(path.join(root, PREFIX))).map(entry => ({ ...entry, path: `${PREFIX}/${entry.path}` }));
    const shared = await Promise.all(SHARED.map(async relative => {
        const file = files.safe(root, path.join(root, relative));
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) throw new Error('启动器共享文件不是普通文件');
        return { path: relative, size: stat.size, sha256: await files.hash(file) };
    }));
    const entries = [...own, ...shared].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

module.exports = { launcherIdentity, PREFIX, SHARED };
