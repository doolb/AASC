#!/usr/bin/env node

/**
 * 准备官方 MNN Android LLM 原生依赖。
 *
 * 默认复用仓库内已经验证过的 MNN checkout 和固定 revision，避免每次编译
 * 都需要手动填写路径。CI 或其他开发机仍可通过 AASC_MNN_ROOT、
 * AASC_MNN_REVISION 和 ANDROID_NDK_HOME 覆盖默认值。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../..');
const defaultMnnRoot = path.join(projectRoot, 'build', 'third_party', 'MNN');
const defaultMnnRevision = 'd407447ed56c4121a11ccbd266dc184ca1ead0c2';
const configuredRootValue = String(process.env.AASC_MNN_ROOT || defaultMnnRoot).trim();
const configuredRoot = configuredRootValue ? path.resolve(configuredRootValue) : '';
const revision = String(process.env.AASC_MNN_REVISION || defaultMnnRevision).trim();
const androidHome = process.env.ANDROID_HOME || '/opt/android-sdk';
const ndkRoot = process.env.ANDROID_NDK_HOME
    || path.join(androidHome, 'ndk', '28.2.13676358');
const manifestPath = path.join(projectRoot, 'build', 'mnnllm-android-artifact-manifest.json');

function runGit(args, cwd) {
    execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function hasGitRevision(cwd, requestedRevision) {
    try {
        execFileSync('git', ['cat-file', '-e', `${requestedRevision}^{commit}`], {
            cwd,
            stdio: 'ignore'
        });
        return true;
    } catch (_error) {
        return false;
    }
}

function writeBuildManifest(status, extra = {}) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({
        engine: 'mnn-llm',
        status,
        revision: revision || null,
        root: configuredRoot || null,
        generatedAt: new Date().toISOString(),
        ...extra
    }, null, 2) + '\n');
}

try {
    console.log(`[MNN-LLM] 源码路径: ${configuredRoot}`);
    console.log(`[MNN-LLM] 固定 revision: ${revision}`);
    console.log(`[MNN-LLM] Android NDK: ${ndkRoot}`);
    if (!fs.existsSync(path.join(configuredRoot, '.git'))) {
        fs.mkdirSync(path.dirname(configuredRoot), { recursive: true });
        runGit(['clone', 'https://github.com/alibaba/MNN.git', configuredRoot], projectRoot);
    }
    if (hasGitRevision(configuredRoot, revision)) {
        console.log(`[MNN-LLM] 本地已包含固定 revision，跳过网络 fetch: ${revision}`);
    } else {
        runGit(['fetch', '--tags', '--force', 'origin', revision], configuredRoot);
    }
    runGit(['checkout', '--detach', revision], configuredRoot);

    const buildScript = path.join(configuredRoot, 'project', 'android', 'build_64.sh');
    if (!fs.existsSync(buildScript)) {
        throw new Error(`官方 MNN Android 构建脚本不存在: ${buildScript}`);
    }
    const buildDirectory = path.join(configuredRoot, 'project', 'android', 'build_64');
    fs.mkdirSync(buildDirectory, { recursive: true });
    const cmakeOptions = [
        '-DMNN_LOW_MEMORY=true',
        '-DMNN_CPU_WEIGHT_DEQUANT_GEMM=true',
        '-DMNN_BUILD_LLM=true',
        '-DMNN_SUPPORT_TRANSFORMER_FUSE=true',
        '-DMNN_ARM82=true',
        '-DMNN_USE_LOGCAT=true',
        '-DMNN_OPENCL=true',
        '-DLLM_SUPPORT_VISION=true',
        '-DMNN_BUILD_OPENCV=true',
        '-DMNN_IMGCODECS=true',
        '-DLLM_SUPPORT_AUDIO=true',
        '-DMNN_BUILD_AUDIO=true',
        '-DMNN_SEP_BUILD=OFF',
        "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384",
        '-DCMAKE_INSTALL_PREFIX=.'
    ].join(' ');
    execFileSync('bash', [buildScript, cmakeOptions], {
        cwd: buildDirectory,
        stdio: 'inherit',
        env: { ...process.env, ANDROID_NDK: ndkRoot }
    });
    execFileSync('make', ['install'], {
        cwd: buildDirectory,
        stdio: 'inherit',
        env: { ...process.env, ANDROID_NDK: ndkRoot }
    });
    writeBuildManifest('ready', {
        source: 'https://github.com/alibaba/MNN',
        buildScript
    });
    console.log(`[MNN-LLM] 官方依赖已准备: ${configuredRoot}`);
} catch (error) {
    writeBuildManifest('error', { error: error.message });
    console.error(`[MNN-LLM] 准备失败: ${error.message}`);
    process.exitCode = 1;
}
