'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ANDROID_ABI = 'arm64-v8a';
const NODE_LIBRARY_NAME = 'libaasc_node.so';
const NODE_LIBRARY_PATH = `native/${ANDROID_ABI}/${NODE_LIBRARY_NAME}`;
const REQUIRED_PACKAGE_ENTRIES = [
    'src/apps/server/boot/server-launcher.js',
    'package.json',
    'package-lock.json'
];
const CERTIFICATE_ENTRIES = ['cert.pem', 'key.pem'];

function resolveRequiredDirectory(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} 未配置`);
    }
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`${label} 不存在: ${resolved}`);
    }
    return resolved;
}

function assertSafeRelativePath(relativePath) {
    const normalized = path.normalize(relativePath);
    if (path.isAbsolute(relativePath) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
        throw new Error(`发现不安全的资产路径: ${relativePath}`);
    }
}

function isNpmToolShim(relativePath) {
    return relativePath.split(path.sep).includes('.bin');
}

function isNpmInternalMetadata(relativePath) {
    const segments = relativePath.split(path.sep);
    return segments.at(-1) === '.package-lock.json' && segments.at(-2) === 'node_modules';
}

function isAndroidAssetExcluded(relativePath, isDirectory = false) {
    const segments = relativePath.split(path.sep);
    // 只有目录名会影响 Android AssetManager 的遍历；Node 依赖中存在大量以下划线
    // 开头的合法 JavaScript 文件（例如 readable-stream/lib/_stream_readable.js），
    // 不能按文件名过滤，否则运行时会出现 MODULE_NOT_FOUND。
    const directorySegments = isDirectory ? segments : segments.slice(0, -1);
    const hasUnsupportedDirectory = directorySegments.some(
        segment => segment.startsWith('.') || segment.startsWith('_')
    );
    const isHiddenFile = !isDirectory && segments.at(-1)?.startsWith('.');
    return hasUnsupportedDirectory || isHiddenFile;
}

async function listFiles(sourceRoot, relativePath = '') {
    const currentPath = path.join(sourceRoot, relativePath);
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const childRelativePath = path.join(relativePath, entry.name);
        assertSafeRelativePath(childRelativePath);
        // aapt2/AssetManager 会过滤隐藏路径以及 npm/Pixi 的下划线生成目录；
        // 这些文件不会进入 APK，必须同步从 manifest 排除，避免安装时校验落空。
        if (isAndroidAssetExcluded(childRelativePath, entry.isDirectory())) continue;
        // npm v7+ 会在每个 node_modules 根目录生成隐藏的内部锁文件；它不参与
        // Node.js 运行，且 Android AssetManager/Gradle 不保证打包隐藏文件。
        if (isNpmInternalMetadata(childRelativePath)) continue;
        if (entry.isSymbolicLink()) {
            // npm 会在每级 node_modules/.bin 创建指向包内脚本的软链接；APK
            // 节点不执行 npm CLI，因此安全地跳过这些工具入口，避免把软链接
            // 原样写进 assets。其他软链接仍全部拒绝，防止代码包越界读取。
            if (isNpmToolShim(childRelativePath)) continue;
            throw new Error(`服务器运行包不允许符号链接: ${childRelativePath}`);
        }
        if (entry.isDirectory()) {
            files.push(...await listFiles(sourceRoot, childRelativePath));
            continue;
        }
        if (!entry.isFile()) {
            throw new Error(`服务器运行包包含不支持的文件类型: ${childRelativePath}`);
        }
        files.push(childRelativePath);
    }

    return files;
}

async function copyFileWithManifest(sourceRoot, relativePath, outputRoot, outputRelativePath = relativePath) {
    assertSafeRelativePath(relativePath);
    assertSafeRelativePath(outputRelativePath);
    const sourcePath = path.join(sourceRoot, relativePath);
    const outputPath = path.join(outputRoot, outputRelativePath);
    const outputParent = path.dirname(outputPath);
    await fs.promises.mkdir(outputParent, { recursive: true });
    await fs.promises.copyFile(sourcePath, outputPath);
    if (outputRelativePath.endsWith('/node') || outputRelativePath === 'runtime/arm64-v8a/node') {
        await fs.promises.chmod(outputPath, 0o755);
    }
    const content = await fs.promises.readFile(outputPath);
    return {
        path: outputRelativePath.split(path.sep).join('/'),
        size: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
}

async function copyDirectoryWithManifest(sourceRoot, outputRoot, outputPrefix = '', options = {}) {
    const sourceFiles = await listFiles(sourceRoot);
    const excludedPaths = new Set(options.excludedPaths || []);
    const files = [];
    for (const relativePath of sourceFiles) {
        if (excludedPaths.has(relativePath)) continue;
        const outputRelativePath = outputPrefix
            ? path.join(outputPrefix, relativePath)
            : relativePath;
        files.push(await copyFileWithManifest(sourceRoot, relativePath, outputRoot, outputRelativePath));
    }
    return files;
}

async function copyNodeLibrary(runtimeDir, nativeOutputDir) {
    // 原生 Node 库不放入 Android assets，但必须参与内容版本计算，避免 Node 库变更后
    // 设备仍错误复用旧的 nativeLibraryDir 文件。
    const metadata = await copyFileWithManifest(
        runtimeDir,
        'node',
        nativeOutputDir,
        path.join(ANDROID_ABI, NODE_LIBRARY_NAME)
    );
    const outputPath = path.join(nativeOutputDir, ANDROID_ABI, NODE_LIBRARY_NAME);
    await fs.promises.chmod(outputPath, 0o755);
    return metadata;
}

function deriveContentVersion(files, nodeFile) {
    // 构建输入的文件列表可能受文件系统遍历顺序影响，先按路径排序后再计算指纹，
    // 保证相同输入重复构建时版本稳定，只有实际内容变化才触发 APK 首次启动安装。
    const fingerprintInput = JSON.stringify({
        files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
        node: {
            size: nodeFile.size,
            sha256: nodeFile.sha256
        }
    });
    const digest = crypto.createHash('sha256').update(fingerprintInput, 'utf8').digest('hex');
    return `content-${digest.slice(0, 24)}`;
}

function assertRequiredPackageEntries(packageDir) {
    for (const requiredEntry of REQUIRED_PACKAGE_ENTRIES) {
        const entryPath = path.join(packageDir, requiredEntry);
        if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
            throw new Error(`服务器运行包缺少必需文件: ${requiredEntry}`);
        }
    }
}

async function copyCertificates(certDir, outputDir) {
    if (!certDir) return [];
    const resolvedCertDir = resolveRequiredDirectory(certDir, 'AASC_ANDROID_NODE_CERT_DIR');
    const files = [];
    for (const certificateName of CERTIFICATE_ENTRIES) {
        const sourcePath = path.join(resolvedCertDir, certificateName);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Android 子服务器证书缺少文件: ${certificateName}`);
        }
        files.push(await copyFileWithManifest(
            resolvedCertDir,
            certificateName,
            outputDir,
            path.join('res', 'certs', certificateName)
        ));
    }
    return files;
}

async function prepareAndroidNodeRuntime(options = {}) {
    const runtimeDir = resolveRequiredDirectory(
        options.runtimeDir || process.env.AASC_ANDROID_NODE_RUNTIME_DIR,
        'AASC_ANDROID_NODE_RUNTIME_DIR'
    );
    const packageDir = resolveRequiredDirectory(
        options.packageDir || process.env.AASC_ANDROID_NODE_PACKAGE_DIR,
        'AASC_ANDROID_NODE_PACKAGE_DIR'
    );
    const outputDir = path.resolve(
        options.outputDir || path.join(process.cwd(), 'src/apps/android-display/app/build/generated/node-runtime/assets')
    );
    const nativeOutputDir = path.resolve(
        options.nativeOutputDir || path.join(outputDir, '..', 'jniLibs')
    );
    const nodePath = path.join(runtimeDir, 'node');

    if (!fs.existsSync(nodePath) || !fs.statSync(nodePath).isFile()) {
        throw new Error(`Android Node Runtime 的 node 不存在: ${nodePath}`);
    }
    assertRequiredPackageEntries(packageDir);

    const temporaryOutputDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
    const temporaryNativeOutputDir = `${nativeOutputDir}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
    await fs.promises.rm(temporaryNativeOutputDir, { recursive: true, force: true });
    await fs.promises.mkdir(temporaryOutputDir, { recursive: true });
    await fs.promises.mkdir(temporaryNativeOutputDir, { recursive: true });

    try {
        const files = [];
        const runtimeFiles = await copyDirectoryWithManifest(
            runtimeDir,
            temporaryOutputDir,
            path.join('runtime', ANDROID_ABI),
            { excludedPaths: ['node'] }
        );
        files.push(...runtimeFiles);
        const nodeFile = await copyNodeLibrary(runtimeDir, temporaryNativeOutputDir);
        files.push(...await copyDirectoryWithManifest(packageDir, temporaryOutputDir, 'server'));
        files.push(...await copyCertificates(
            options.certDir || process.env.AASC_ANDROID_NODE_CERT_DIR,
            temporaryOutputDir
        ));

        const configuredVersion = String(
            options.version || process.env.AASC_ANDROID_NODE_RUNTIME_VERSION || ''
        ).trim();
        const version = configuredVersion || deriveContentVersion(files, nodeFile);
        const manifest = {
            version,
            abi: ANDROID_ABI,
            entrypoint: 'server/src/apps/server/boot/server-launcher.js',
            nodePath: NODE_LIBRARY_PATH,
            files
        };
        await fs.promises.writeFile(
            path.join(temporaryOutputDir, 'runtime-manifest.json'),
            JSON.stringify(manifest, null, 2) + '\n',
            'utf8'
        );
        // 启动时只读取这个小文件即可判断是否需要更新，避免每次启动都解析数 MB 的完整 manifest。
        await fs.promises.writeFile(
            path.join(temporaryOutputDir, 'runtime-version.txt'),
            `${version}\n`,
            'utf8'
        );

        await fs.promises.rm(outputDir, { recursive: true, force: true });
        await fs.promises.rm(nativeOutputDir, { recursive: true, force: true });
        await fs.promises.rename(temporaryOutputDir, outputDir);
        await fs.promises.rename(temporaryNativeOutputDir, nativeOutputDir);
        return { outputDir, nativeOutputDir, manifest };
    } catch (error) {
        await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
        await fs.promises.rm(temporaryNativeOutputDir, { recursive: true, force: true });
        throw error;
    }
}

async function main() {
    const result = await prepareAndroidNodeRuntime({
        runtimeDir: process.env.AASC_ANDROID_NODE_RUNTIME_DIR,
        packageDir: process.env.AASC_ANDROID_NODE_PACKAGE_DIR,
        certDir: process.env.AASC_ANDROID_NODE_CERT_DIR,
        version: process.env.AASC_ANDROID_NODE_RUNTIME_VERSION
    });
    process.stdout.write([
        'Android Node Runtime assets 已生成',
        `目录: ${result.outputDir}`,
        `版本: ${result.manifest.version}`,
        `ABI: ${result.manifest.abi}`,
        `文件数: ${result.manifest.files.length}`
    ].join('\n') + '\n');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`生成 Android Node Runtime assets 失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    ANDROID_ABI,
    CERTIFICATE_ENTRIES,
    NODE_LIBRARY_NAME,
    NODE_LIBRARY_PATH,
    REQUIRED_PACKAGE_ENTRIES,
    assertSafeRelativePath,
    isAndroidAssetExcluded,
    isNpmInternalMetadata,
    isNpmToolShim,
    deriveContentVersion,
    prepareAndroidNodeRuntime
};
