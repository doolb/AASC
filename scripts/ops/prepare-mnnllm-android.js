#!/usr/bin/env node

/**
 * 校验 Git 内置的 MNN Android 运行包，或按显式命令从源码构建 MNN。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
    MNN_BUILD_OPTIONS,
    MNN_LIBRARY_RELATIVE_PATH,
    MNN_PACKAGE_DIRECTORIES,
    MNN_PACKAGE_SOURCE_FILES,
    resolveMnnBuildConfig
} = require('./mnn-build-config');

const projectRoot = path.resolve(__dirname, '../..');
const sourceBuildRequested = process.argv.includes('--build-source');
const buildConfig = resolveMnnBuildConfig({
    projectRoot,
    environment: process.env,
    mode: sourceBuildRequested ? 'source' : 'prebuilt'
});
const { root: configuredRoot, revision } = buildConfig;
const androidHome = process.env.ANDROID_HOME || '/opt/android-sdk';
const ndkRoot = process.env.ANDROID_NDK_HOME
    || path.join(androidHome, 'ndk', '28.2.13676358');
const buildManifestPath = path.join(projectRoot, 'build', 'mnnllm-android-artifact-manifest.json');
const packageManifestPath = path.join(configuredRoot, 'manifest.json');

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
    fs.mkdirSync(path.dirname(buildManifestPath), { recursive: true });
    fs.writeFileSync(buildManifestPath, JSON.stringify({
        engine: 'mnn-llm',
        status,
        revision: revision || null,
        root: configuredRoot || null,
        generatedAt: new Date().toISOString(),
        ...extra
    }, null, 2) + '\n');
}

function requirePath(relativePath, type = 'file') {
    const targetPath = path.join(configuredRoot, relativePath);
    let valid = false;
    try {
        const stat = fs.statSync(targetPath);
        valid = type === 'directory' ? stat.isDirectory() : stat.isFile();
    } catch (_error) {
        valid = false;
    }
    if (!valid) throw new Error(`MNN 预编译包缺少${type === 'directory' ? '目录' : '文件'}: ${targetPath}`);
    return targetPath;
}

function calculateSha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyPrebuiltPackage() {
    if (!fs.existsSync(packageManifestPath)) {
        throw new Error(`MNN 预编译包清单不存在: ${packageManifestPath}`);
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'));
    } catch (error) {
        throw new Error(`MNN 预编译包清单无法解析: ${error.message}`);
    }
    if (manifest.schemaVersion !== 1 || manifest.engine !== 'mnn-llm') {
        throw new Error(`MNN 预编译包清单格式不受支持: ${packageManifestPath}`);
    }
    if (manifest.revision !== revision) {
        throw new Error(`MNN 预编译包 revision 不匹配: 期望 ${revision}，实际 ${manifest.revision || '缺失'}`);
    }
    if (manifest.abi !== 'arm64-v8a') {
        throw new Error(`MNN 预编译包 ABI 不匹配: 期望 arm64-v8a，实际 ${manifest.abi || '缺失'}`);
    }
    if (!Array.isArray(manifest.buildOptions) || manifest.buildOptions.length === 0) {
        throw new Error('MNN 预编译包清单未记录构建参数');
    }

    const libraryPath = requirePath(MNN_LIBRARY_RELATIVE_PATH);
    requirePath('LICENSE.txt');
    for (const relativePath of MNN_PACKAGE_DIRECTORIES) {
        requirePath(relativePath, 'directory');
    }
    for (const relativePath of MNN_PACKAGE_SOURCE_FILES) {
        requirePath(relativePath);
    }

    const libraryStat = fs.statSync(libraryPath);
    const expectedLibrary = manifest.library || {};
    if (expectedLibrary.path !== MNN_LIBRARY_RELATIVE_PATH) {
        throw new Error(`MNN 预编译包库路径不匹配: ${expectedLibrary.path || '缺失'}`);
    }
    if (expectedLibrary.size !== libraryStat.size) {
        throw new Error(`libMNN.so 大小不匹配: 清单 ${expectedLibrary.size || '缺失'}，实际 ${libraryStat.size}`);
    }
    const actualSha256 = calculateSha256(libraryPath);
    if (expectedLibrary.sha256 !== actualSha256) {
        throw new Error(`libMNN.so SHA-256 不匹配: 清单 ${expectedLibrary.sha256 || '缺失'}，实际 ${actualSha256}`);
    }

    return { manifest, libraryPath, sha256: actualSha256, size: libraryStat.size };
}

function buildMnnFromSource() {
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
    const cmakeOptions = MNN_BUILD_OPTIONS.join(' ');
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
    console.log(`[MNN-LLM] 官方依赖源码构建完成: ${configuredRoot}`);
}

function preparePrebuiltPackage() {
    const verified = verifyPrebuiltPackage();
    writeBuildManifest('ready', {
        source: 'git-bundled-prebuilt',
        artifactManifest: packageManifestPath,
        library: {
            path: verified.libraryPath,
            size: verified.size,
            sha256: verified.sha256
        }
    });
    console.log(`[MNN-LLM] 使用 Git 内置预编译包: ${configuredRoot}`);
    console.log(`[MNN-LLM] libMNN.so ${verified.size} bytes, SHA-256 ${verified.sha256}`);
}

try {
    if (sourceBuildRequested) {
        buildMnnFromSource();
    } else if (fs.existsSync(packageManifestPath)) {
        preparePrebuiltPackage();
    } else if (process.env.AASC_MNN_ROOT) {
        buildMnnFromSource();
    } else {
        throw new Error(`Git 内置 MNN 预编译包不存在: ${packageManifestPath}；不会自动下载 MNN 上游源码`);
    }
} catch (error) {
    try {
        writeBuildManifest('error', { error: error.message });
    } catch (_manifestError) {
        // 原始构建错误优先；写入状态清单失败不覆盖它。
    }
    console.error(`[MNN-LLM] 准备失败: ${error.message}`);
    process.exitCode = 1;
}
