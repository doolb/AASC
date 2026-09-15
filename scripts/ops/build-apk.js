'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
    APK_PROFILES,
    loadApkProfile
} = require('./apk-build-profile');
const {
    prepareAndroidNodeRuntime
} = require('./prepare-android-node-runtime');
const {
    prepareAndroidServerPackage
} = require('./prepare-android-server-package');
const {
    resolveReleaseRuntimeContext,
    validateReleaseRuntimeContext
} = require('../../src/core/release-runtime-context');

const execFileAsync = promisify(execFile);
const ANDROID_APP_DIR_NAME = path.join('src', 'apps', 'android-display');

function createApkBuildPlan(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const profileName = String(options.profileName || '').trim();
    if (!APK_PROFILES[profileName]) throw new Error(`未知 APK profile: ${profileName || '(空)'}`);
    const buildRoot = path.join(projectRoot, 'release', 'apkbuild', profileName);
    const runtimeDir = path.join(buildRoot, 'runtime');
    return {
        projectRoot,
        profileName,
        buildRoot,
        packageDir: path.join(buildRoot, 'package'),
        packageTempPrefix: path.join(buildRoot, 'package.tmp-'),
        runtimeDir,
        runtimeAssetsDir: path.join(runtimeDir, 'assets'),
        runtimeJniLibsDir: path.join(runtimeDir, 'jniLibs'),
        gradleDir: path.join(buildRoot, 'gradle'),
        outputDir: path.join(buildRoot, 'output'),
        androidAppDir: path.join(projectRoot, ANDROID_APP_DIR_NAME)
    };
}

function defaultCommandRunner(file, args, options) {
    return execFileAsync(file, args, options);
}

async function runCommand(commandRunner, file, args, options = {}) {
    try {
        await commandRunner(file, args, options);
    } catch (error) {
        const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
        throw new Error(`执行命令失败: ${file} ${args.join(' ')}: ${detail}`);
    }
}

async function stopGradleDaemons(gradlePath, androidHome, commandRunner) {
    try {
        await runCommand(commandRunner, gradlePath, ['--stop'], {
            cwd: path.dirname(gradlePath),
            env: { ...process.env, ANDROID_HOME: androidHome },
            stdio: 'ignore'
        });
    } catch (error) {
        console.warn(`Gradle Daemon 清理失败: ${error.message}`);
    }
    if (process.platform === 'win32') return;
    try {
        await runCommand(commandRunner, 'pkill', ['-TERM', '-f', 'kotlin-compiler-in-aascdisplay-'], {
            stdio: 'ignore'
        });
    } catch (error) {
        if (!error.message.includes('退出码 1') && !error.message.includes('exit code 1')) {
            console.warn(`Kotlin Compiler Daemon 清理失败: ${error.message}`);
        }
    }
}

async function copyApkAtomically(sourcePath, outputDir, profileName) {
    const apkName = profileName === 'allserver'
        ? 'aasc-display-offline.apk'
        : profileName === 'noserver' ? 'aasc-display-noserver.apk' : 'aasc-display.apk';
    const outputPath = path.join(outputDir, apkName);
    const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.mkdir(outputDir, { recursive: true });
    await fs.promises.copyFile(sourcePath, temporaryPath);
    await fs.promises.rename(temporaryPath, outputPath);
    return outputPath;
}

async function buildApk(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const profileName = String(options.profileName || '').trim();
    const plan = createApkBuildPlan({ projectRoot, profileName });
    const profile = await loadApkProfile({ projectRoot, profile: profileName });
    const commandRunner = options.commandRunner || defaultCommandRunner;
    const runtimeContext = resolveReleaseRuntimeContext({
        projectRoot,
        homeDir: projectRoot,
        argv: ['node', 'build-apk.js', '--release'],
        environment: {}
    });
    if (profile.embeddedNode) validateReleaseRuntimeContext(runtimeContext);

    await fs.promises.mkdir(plan.buildRoot, { recursive: true });
    const androidHome = process.env.ANDROID_HOME || '/opt/android-sdk';
    const commandEnvironment = {
        ...process.env,
        ANDROID_HOME: androidHome
    };
    await runCommand(commandRunner, process.env.npm_execpath || 'npm', ['run', 'prepare:mnnllm-android'], {
        cwd: projectRoot,
        env: commandEnvironment,
        stdio: 'inherit'
    });

    let prepared = null;
    if (profile.embeddedNode) {
        const packageDir = process.env.AASC_ANDROID_NODE_PACKAGE_DIR
            ? path.resolve(process.env.AASC_ANDROID_NODE_PACKAGE_DIR)
            : await prepareAndroidServerPackage({
                projectRoot,
                outputDir: plan.packageDir,
                commandRunner
            });
        prepared = await prepareAndroidNodeRuntime({
            runtimeDir: process.env.AASC_ANDROID_NODE_RUNTIME_DIR,
            packageDir,
            certDir: process.env.AASC_ANDROID_NODE_CERT_DIR || path.join(projectRoot, 'res', 'certs'),
            modelRoot: path.join(projectRoot, 'res', 'models'),
            modelIds: profile.models,
            includeOfflineModels: profile.models.length > 0,
            taskRoot: runtimeContext.taskDir,
            includeOfflineTasks: true,
            configFile: runtimeContext.configFile,
            userConfigDir: runtimeContext.userConfigDir,
            profileMetadata: {
                profile: profile.profile,
                offline: profile.offline,
                embeddedNode: profile.embeddedNode,
                features: profile.features,
                models: profile.models
            },
            outputDir: plan.runtimeAssetsDir,
            nativeOutputDir: plan.runtimeJniLibsDir
        });
    }

    const gradlePath = path.join(plan.androidAppDir, 'gradlew');
    const gradleArgs = [
        ':app:assembleDebug',
        `-PaascProfile=${profileName}`,
        `-PaascOffline=${profile.offline}`,
        `-PaascEmbeddedNode=${profile.embeddedNode}`,
        `-PaascBuildDirectory=${plan.gradleDir}`,
        `-PaascNodeRuntimeAssetsDir=${plan.runtimeAssetsDir}`,
        `-PaascNodeRuntimeJniLibsDir=${plan.runtimeJniLibsDir}`,
        '--no-daemon'
    ];
    try {
        await runCommand(commandRunner, gradlePath, gradleArgs, {
            cwd: plan.androidAppDir,
            env: commandEnvironment,
            stdio: 'inherit'
        });
    } finally {
        await stopGradleDaemons(gradlePath, androidHome, commandRunner);
    }

    const debugApk = path.join(plan.gradleDir, 'outputs', 'apk', 'debug', 'app-debug.apk');
    if (!fs.existsSync(debugApk)) throw new Error(`Gradle 构建完成但未找到 APK: ${debugApk}`);
    const apkPath = await copyApkAtomically(debugApk, plan.outputDir, profileName);
    const apkContent = await fs.promises.readFile(apkPath);
    const manifest = {
        profile: profileName,
        offline: profile.offline,
        embeddedNode: profile.embeddedNode,
        apk: path.basename(apkPath),
        sha256: crypto.createHash('sha256').update(apkContent).digest('hex'),
        runtime: prepared?.manifest || null
    };
    await fs.promises.writeFile(
        path.join(plan.outputDir, 'build-manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        'utf8'
    );
    return { apkPath, profile, manifest };
}

async function main() {
    const profileName = process.argv[2] || 'withserver';
    const result = await buildApk({ profileName });
    process.stdout.write([
        `AASC APK profile ${result.profile.profile} 已生成`,
        `文件: ${result.apkPath}`,
        `SHA-256: ${result.manifest.sha256}`
    ].join('\n') + '\n');
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`生成 APK 失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildApk,
    createApkBuildPlan,
    copyApkAtomically
};
