'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJsonObject(filePath) {
    try {
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (error) {
        return null;
    }
}

function readPackageVersion(projectRoot) {
    const packageJson = readJsonObject(path.join(projectRoot, 'package.json'));
    const version = typeof packageJson?.version === 'string' ? packageJson.version.trim() : '';
    return version || 'unknown';
}

function formatVersion(value, fallback = '未提供') {
    if (Number.isSafeInteger(value) && value > 0) return `v${value}`;
    if (typeof value === 'string' && value.trim()) return value.trim();
    return fallback;
}

/**
 * 读取当前 Node 服务实际运行的版本来源。
 *
 * Offline 热更新版本以 updates/active-release.json 为准；没有热更新指针时，
 * 回退到完整 APK 携带的 offline-update-client.json。显示端版本由调用方传入，
 * 避免这个通用模块依赖 Web public 目录扫描实现。
 */
function getRuntimeVersionInfo(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const codeRoot = path.resolve(options.codeRoot || projectRoot);
    const nodeModulesRoot = path.resolve(
        options.nodeModulesRoot || process.env.AASC_NODE_MODULES_DIR || path.join(projectRoot, 'node_modules')
    );
    const packageVersion = readPackageVersion(projectRoot);
    const serverVersion = typeof options.serverVersion === 'string'
        ? options.serverVersion.trim()
        : '';
    const activeRelease = readJsonObject(path.join(projectRoot, 'updates', 'active-release.json'));
    const bundledBaseline = readJsonObject(path.join(projectRoot, 'offline-update-client.json'));
    const serviceSource = activeRelease || bundledBaseline || {};
    const dependencySource = activeRelease
        ? activeRelease.legacyDependencies === true ? 'legacy-root' : 'active-release'
        : bundledBaseline ? 'bundled-baseline' : 'package-root';

    return {
        apk: serverVersion || packageVersion,
        code: formatVersion(serviceSource.codeVersion, packageVersion),
        dependencies: formatVersion(serviceSource.dependencyVersion),
        display: options.displayVersion === undefined || options.displayVersion === null
            ? '未提供'
            : String(options.displayVersion),
        codePath: codeRoot,
        dependenciesPath: nodeModulesRoot,
        dependencySource
    };
}

module.exports = {
    formatVersion,
    getRuntimeVersionInfo,
    readJsonObject
};
