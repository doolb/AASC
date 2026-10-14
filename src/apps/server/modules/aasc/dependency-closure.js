'use strict';

const path = require('node:path');
const PI_PACKAGES = Object.freeze(['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent']);

/** 按npm逐层node_modules规则解析锁中的包，保持嵌套SDK版本隔离。 */
function resolveLockedPackage(packages, owner, name) {
    let cursor = owner;
    while (true) {
        const candidate = `${cursor ? `${cursor}/` : ''}node_modules/${name}`;
        if (Object.hasOwn(packages, candidate)) return candidate;
        if (!cursor) return null;
        cursor = path.posix.dirname(cursor);
        if (cursor === '.') cursor = '';
    }
}

function dependencyClosure(lock, names) {
    const packages = lock.packages || {};
    const pending = names.map(name => resolveLockedPackage(packages, '', name)).filter(Boolean);
    const result = new Set();
    while (pending.length) {
        const owner = pending.pop();
        if (result.has(owner)) continue;
        result.add(owner);
        const metadata = packages[owner];
        for (const name of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies })) {
            const resolved = resolveLockedPackage(packages, owner, name);
            if (resolved) pending.push(resolved);
            else if (metadata.dependencies?.[name] && !metadata.optionalDependencies?.[name]) {
                throw new Error(`生产锁缺少必需依赖：${owner}/${name}`);
            }
        }
    }
    return result;
}

/** 只有Pi独占的包从基础集合移除；其它业务需要的共享包仍留在四组内。 */
function piExclusivePackages(packageJson, lock) {
    if (!PI_PACKAGES.every(name => Object.hasOwn(packageJson.optionalDependencies || {}, name))) return new Set();
    const pi = dependencyClosure(lock, PI_PACKAGES);
    const base = dependencyClosure(lock, Object.keys(packageJson.dependencies || {}));
    return new Set([...pi].filter(key => !base.has(key)));
}

function packageOwnerKey(relative, keys) {
    let directory = path.posix.dirname(`node_modules/${relative}`);
    while (directory !== '.') {
        if (keys.has(directory)) return directory;
        directory = path.posix.dirname(directory);
    }
    return null;
}

module.exports = { PI_PACKAGES, resolveLockedPackage, dependencyClosure, piExclusivePackages, packageOwnerKey };
