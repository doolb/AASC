'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { prepareAndroidNodeRuntime } = require('./prepare-android-node-runtime');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ANDROID_APP_DIR = path.join(PROJECT_ROOT, 'src', 'apps', 'android-display');
const GENERATED_ROOT = path.join(ANDROID_APP_DIR, 'app', 'build', 'generated', 'node-runtime');
const DEBUG_APK = path.join(ANDROID_APP_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const OFFLINE_APK = path.join(
    ANDROID_APP_DIR,
    'app',
    'build',
    'outputs',
    'apk',
    'offline',
    'aasc-display-offline.apk'
);

function stopGradleDaemons(gradlePath, androidHome) {
    try {
        execFileSync(gradlePath, ['--stop'], {
            cwd: ANDROID_APP_DIR,
            env: { ...process.env, ANDROID_HOME: androidHome },
            stdio: 'ignore'
        });
    } catch (error) {
        console.warn(`Gradle Daemon 清理失败: ${error.message}`);
    }
}

function stopKotlinCompilerDaemons() {
    if (process.platform === 'win32') return;
    try {
        // 只匹配本项目 Kotlin 编译器的 marker，不影响其他项目或用户的 Java 进程。
        execFileSync('pkill', ['-TERM', '-f', 'kotlin-compiler-in-aascdisplay-'], {
            stdio: 'ignore'
        });
    } catch (error) {
        // pkill 返回 1 表示没有匹配进程，这是正常的清理结果。
        if (error.status !== 1) {
            console.warn(`Kotlin Compiler Daemon 清理失败: ${error.message}`);
        }
    }
}

async function buildOfflineApk() {
    const certDir = process.env.AASC_ANDROID_NODE_CERT_DIR || path.join(PROJECT_ROOT, 'res', 'certs');
    const prepared = await prepareAndroidNodeRuntime({
        runtimeDir: process.env.AASC_ANDROID_NODE_RUNTIME_DIR,
        packageDir: process.env.AASC_ANDROID_NODE_PACKAGE_DIR,
        certDir,
        modelRoot: path.join(PROJECT_ROOT, 'res', 'models'),
        includeOfflineModels: true,
        taskRoot: path.join(PROJECT_ROOT, 'res', 'tasks'),
        includeOfflineTasks: true,
        outputDir: path.join(GENERATED_ROOT, 'assets'),
        nativeOutputDir: path.join(GENERATED_ROOT, 'jniLibs')
    });

    const gradlePath = path.join(ANDROID_APP_DIR, 'gradlew');
    const androidHome = process.env.ANDROID_HOME || '/opt/android-sdk';
    try {
        execFileSync(gradlePath, [':app:assembleDebug', '-PaascOffline=true', '--no-daemon'], {
            cwd: ANDROID_APP_DIR,
            env: { ...process.env, ANDROID_HOME: androidHome },
            stdio: 'inherit'
        });
    } finally {
        // 打包命令结束后主动回收 Gradle Daemon，避免离线大包继续占用大量内存。
        stopGradleDaemons(gradlePath, androidHome);
        stopKotlinCompilerDaemons();
    }

    if (!fs.existsSync(DEBUG_APK)) {
        throw new Error(`Gradle 构建完成但未找到 APK: ${DEBUG_APK}`);
    }
    fs.mkdirSync(path.dirname(OFFLINE_APK), { recursive: true });
    fs.copyFileSync(DEBUG_APK, OFFLINE_APK);

    const modelFiles = prepared.manifest.files.filter(file => file.path.startsWith('server/res/models/'));
    const modelBytes = modelFiles.reduce((total, file) => total + file.size, 0);
    const taskFiles = prepared.manifest.files.filter(file => file.path.startsWith('server/res/tasks/'));
    process.stdout.write([
        'AASC 正式显示端离线 APK 已生成',
        `文件: ${OFFLINE_APK}`,
        `包内模型文件数: ${modelFiles.length}`,
        `包内模型大小: ${modelBytes} bytes`,
        `包内用户任务文件数: ${taskFiles.length}`,
        `Runtime 版本: ${prepared.manifest.version}`
    ].join('\n') + '\n');
    return OFFLINE_APK;
}

if (require.main === module) {
    buildOfflineApk().catch(error => {
        console.error(`生成 AASC 离线 APK 失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildOfflineApk,
    DEBUG_APK,
    OFFLINE_APK
};
