'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function hasReleaseFlag(argv = []) {
    return Array.isArray(argv) && argv.some((argument) => argument === '--release');
}

function resolveReleaseRuntimeContext(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '..', '..'));
    const homeDir = path.resolve(options.homeDir || os.homedir());
    const argv = Array.isArray(options.argv) ? options.argv : process.argv;
    const environment = options.environment || process.env;
    const releaseMode = hasReleaseFlag(argv) || environment.AASC_RELEASE_MODE === '1';

    if (releaseMode) {
        return {
            releaseMode: true,
            configFile: path.join(projectRoot, 'release', 'config', 'config.json'),
            userConfigDir: path.join(projectRoot, 'release', 'userconfig'),
            taskDir: path.join(projectRoot, 'release', 'task')
        };
    }

    return {
        releaseMode: false,
        configFile: path.join(projectRoot, 'config', 'config.json'),
        userConfigDir: path.join(homeDir, '.config', 'aasc-user'),
        taskDir: path.join(projectRoot, 'res', 'tasks')
    };
}

function validateReleaseRuntimeContext(context) {
    if (!context || context.releaseMode !== true) return context;

    const requiredEntries = [
        { path: context.configFile, type: 'file', label: '配置文件' },
        { path: context.userConfigDir, type: 'directory', label: '用户配置目录' },
        { path: context.taskDir, type: 'directory', label: '任务目录' }
    ];
    for (const entry of requiredEntries) {
        let stat = null;
        try {
            stat = fs.statSync(entry.path);
        } catch (error) {
            throw new Error(`release ${entry.label}不存在: ${entry.path}`);
        }
        const valid = entry.type === 'file' ? stat.isFile() : stat.isDirectory();
        if (!valid) {
            throw new Error(`release ${entry.label}类型不正确: ${entry.path}`);
        }
    }
    return context;
}

module.exports = {
    hasReleaseFlag,
    resolveReleaseRuntimeContext,
    validateReleaseRuntimeContext
};
