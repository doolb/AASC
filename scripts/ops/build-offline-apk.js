'use strict';

const path = require('node:path');
const { buildApk } = require('./build-apk');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEBUG_APK = path.join(
    PROJECT_ROOT,
    'release',
    'apkbuild',
    'allserver',
    'gradle',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk'
);
const OFFLINE_APK = path.join(
    PROJECT_ROOT,
    'release',
    'apkbuild',
    'allserver',
    'output',
    'aasc-display-offline.apk'
);

async function buildOfflineApk(options = {}) {
    const result = await buildApk({
        ...options,
        profileName: 'allserver'
    });
    return result.apkPath;
}

if (require.main === module) {
    buildOfflineApk().catch((error) => {
        console.error(`生成 AASC 离线 APK 失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildOfflineApk,
    DEBUG_APK,
    OFFLINE_APK
};
