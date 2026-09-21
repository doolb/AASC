'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function getActiveNodeModulesRoot(options = {}) {
    const configuredRoot = options.nodeModulesRoot || process.env.AASC_NODE_MODULES_DIR;
    return path.resolve(configuredRoot || path.join(process.cwd(), 'node_modules'));
}

function resolveActivePiModule(packageName, relativeEntry, options = {}) {
    const activeRoot = getActiveNodeModulesRoot(options);
    const modulePath = path.join(activeRoot, packageName, relativeEntry);
    try {
        if (fs.statSync(modulePath).isFile()) return pathToFileURL(modulePath).href;
    } catch {
        // 开发环境或旧安装可能没有 active 目录，交给 Node 的正常 exports 规则回退解析。
    }
    return options.fallbackSpecifier || packageName;
}

module.exports = {
    getActiveNodeModulesRoot,
    resolveActivePiModule
};
