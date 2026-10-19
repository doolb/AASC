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
 * 读取已健康提交的活动启动器版本，不把待切换候选或发布目标当成当前运行版本。
 * 旧清单没有独立版本字段时，活动 code 版本就是旧启动器的版本身份。
 */
function readActiveLauncherVersion(projectRoot) {
    const active = readJsonObject(path.join(projectRoot, 'updates', 'launcher-state.json'))?.active;
    if (!active || typeof active !== 'object' || Array.isArray(active)) return null;
    const code = active.manifest?.payload?.components?.code;
    if (code?.version !== active.version) return null;
    const version = code.launcherVersion === undefined ? active.version : code.launcherVersion;
    return Number.isSafeInteger(version) && version > 0 ? `v${version}` : null;
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
    const subserverRelease = readJsonObject(path.join(projectRoot, 'updates/subserver/active-release.json'));
    const nodeMinRelease = readJsonObject(path.join(projectRoot, 'updates/allserver-min/active-release.json'));
    const bundledBaseline = readJsonObject(path.join(projectRoot, 'offline-update-client.json'));
    const serviceSource = activeRelease || subserverRelease || nodeMinRelease || bundledBaseline || {};
    const dependencySource = activeRelease
        ? activeRelease.legacyDependencies === true ? 'legacy-root' : 'active-release'
        : subserverRelease ? 'target-node' : nodeMinRelease ? 'offline-node' : bundledBaseline ? 'bundled-baseline' : 'package-root';
    const lastUpdate = readJsonObject(path.join(projectRoot, 'updates/subserver/update-result.json'));
    const launcherVersion = readActiveLauncherVersion(projectRoot);

    return {
        ...(require('../task-engine/task-code-catalog').getTaskCodeCatalog()
            ? { taskCode: require('../task-engine/task-code-catalog').getTaskCodeCatalog().status() } : {}),
        apk: serverVersion || packageVersion,
        ...(launcherVersion ? { launcher: launcherVersion } : {}),
        code: formatVersion(serviceSource.codeVersion, packageVersion),
        dependencies: formatVersion(serviceSource.dependencyVersion),
        display: options.displayVersion === undefined || options.displayVersion === null
            ? '未提供'
            : String(options.displayVersion),
        codePath: codeRoot,
        dependenciesPath: nodeModulesRoot,
        dependencySource,
        ...(lastUpdate ? { update: lastUpdate } : {})
    };
}

module.exports = {
    formatVersion,
    getRuntimeVersionInfo,
    readJsonObject
};
