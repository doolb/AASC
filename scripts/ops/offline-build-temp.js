'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// 尊重显式临时目录；默认使用项目磁盘，避免系统 tmpfs 的用户配额限制。
async function offlineBuildTempRoot(projectRoot, environment = process.env, platform = process.platform) {
    const configured = platform === 'win32'
        ? environment.TMPDIR || environment.TEMP || environment.TMP
        : environment.TMPDIR || environment.TMP || environment.TEMP;
    const directory = path.resolve(configured || path.join(projectRoot, 'tmp', 'offline-build'));
    try {
        await fs.mkdir(directory, { recursive: true });
    } catch (error) {
        throw new Error(`Offline 构建临时目录不可用 ${directory}: ${error.message}`, { cause: error });
    }
    return directory;
}

module.exports = { offlineBuildTempRoot };
