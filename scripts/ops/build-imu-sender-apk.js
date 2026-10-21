'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repository = path.resolve(__dirname, '../..');
const project = path.join(repository, '3rd/imu-six-axis-test/android-sender');
const gradle = path.join(repository, 'src/apps/android-display/gradlew');
const builtApk = path.join(project, 'app/build/outputs/apk/debug/app-debug.apk');
const outputApk = path.join(project, 'output/aasc-imu-sender.apk');

async function main() {
    process.stdout.write('[imu-sender] 构建独立Android六轴采集APK\n');
    execFileSync(gradle, ['-p', project, ':app:assembleDebug', '--no-daemon'], {
        cwd: repository,
        stdio: 'inherit'
    });
    await fs.mkdir(path.dirname(outputApk), { recursive: true });
    await fs.copyFile(builtApk, outputApk);
    const info = await fs.stat(outputApk);
    process.stdout.write(`[imu-sender] APK已生成：${path.relative(repository, outputApk)} (${info.size} bytes)\n`);
}

main().catch(error => {
    process.stderr.write(`[imu-sender] 构建失败：${error.message}\n`);
    process.exitCode = 1;
});
