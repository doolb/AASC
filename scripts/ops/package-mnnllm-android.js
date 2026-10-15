#!/usr/bin/env node

/**
 * 将固定 MNN revision 的编译库和 APK bridge 编译依赖复制到 Git 预编译包。
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
const { root: sourceRoot, revision } = resolveMnnBuildConfig({
    projectRoot,
    environment: process.env,
    mode: 'source'
});
const packageRoot = path.join(projectRoot, '3rd', 'android-mnnllm-prebuilt');
const destinationRoot = path.join(packageRoot, revision);
const licenseRelativePath = 'LICENSE.txt';

function readGitRevision() {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: sourceRoot,
        encoding: 'utf8'
    }).trim();
}

function requireFile(root, relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        throw new Error(`缺少 MNN 文件: ${absolutePath}`);
    }
    return absolutePath;
}

function requireDirectory(root, relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
        throw new Error(`缺少 MNN 目录: ${absolutePath}`);
    }
    return absolutePath;
}

function calculateSha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function copyPackageInputs() {
    for (const relativePath of MNN_PACKAGE_DIRECTORIES) {
        const sourcePath = requireDirectory(sourceRoot, relativePath);
        fs.cpSync(sourcePath, path.join(destinationRoot, relativePath), {
            recursive: true,
            dereference: false,
            verbatimSymlinks: true,
            preserveTimestamps: true
        });
    }
    for (const relativePath of MNN_PACKAGE_SOURCE_FILES) requireFile(destinationRoot, relativePath);

    const libraryPath = requireFile(sourceRoot, MNN_LIBRARY_RELATIVE_PATH);
    const packagedLibraryPath = path.join(destinationRoot, MNN_LIBRARY_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(packagedLibraryPath), { recursive: true });
    fs.copyFileSync(libraryPath, packagedLibraryPath);
    fs.copyFileSync(
        requireFile(sourceRoot, licenseRelativePath),
        path.join(destinationRoot, licenseRelativePath)
    );

    const libraryStat = fs.statSync(packagedLibraryPath);
    const manifest = {
        schemaVersion: 1,
        engine: 'mnn-llm',
        source: 'https://github.com/alibaba/MNN',
        revision,
        abi: 'arm64-v8a',
        ndkVersion: path.basename(process.env.ANDROID_NDK_HOME || '/opt/android-sdk/ndk/28.2.13676358'),
        buildOptions: MNN_BUILD_OPTIONS,
        library: {
            path: MNN_LIBRARY_RELATIVE_PATH,
            size: libraryStat.size,
            sha256: calculateSha256(packagedLibraryPath)
        },
        license: licenseRelativePath,
        generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(destinationRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}

try {
    if (!/^[a-f0-9]{40}$/iu.test(revision)) {
        throw new Error(`MNN revision 必须是完整 40 位 commit SHA: ${revision}`);
    }
    if (fs.existsSync(destinationRoot)) {
        throw new Error(`目标 revision 包已存在，拒绝覆盖: ${destinationRoot}`);
    }
    if (readGitRevision() !== revision) {
        throw new Error(`MNN checkout revision 不匹配: 期望 ${revision}，实际 ${readGitRevision()}`);
    }

    for (const relativePath of MNN_PACKAGE_DIRECTORIES) requireDirectory(sourceRoot, relativePath);
    for (const relativePath of MNN_PACKAGE_SOURCE_FILES) requireFile(sourceRoot, relativePath);
    requireFile(sourceRoot, MNN_LIBRARY_RELATIVE_PATH);
    requireFile(sourceRoot, licenseRelativePath);

    fs.mkdirSync(destinationRoot, { recursive: true });
    const manifest = copyPackageInputs();
    console.log(`[MNN-LLM] Git 预编译包已生成: ${destinationRoot}`);
    console.log(`[MNN-LLM] ABI ${manifest.abi}, libMNN.so ${manifest.library.size} bytes`);
    console.log(`[MNN-LLM] SHA-256 ${manifest.library.sha256}`);
} catch (error) {
    console.error(`[MNN-LLM] 预编译包生成失败: ${error.message}`);
    process.exitCode = 1;
}
