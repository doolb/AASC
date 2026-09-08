'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ANDROID_ABI = 'arm64-v8a';
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

async function listFiles(sourceRoot, relativePath = '') {
    const currentPath = path.join(sourceRoot, relativePath);
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const childRelativePath = path.join(relativePath, entry.name);
        assertSafeRelativePath(childRelativePath);
        if (entry.isSymbolicLink()) {
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

async function copyDirectoryWithManifest(sourceRoot, outputRoot, outputPrefix = '') {
    const sourceFiles = await listFiles(sourceRoot);
    const files = [];
    for (const relativePath of sourceFiles) {
        const outputRelativePath = outputPrefix
            ? path.join(outputPrefix, relativePath)
            : relativePath;
        files.push(await copyFileWithManifest(sourceRoot, relativePath, outputRoot, outputRelativePath));
    }
    return files;
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
    const nodePath = path.join(runtimeDir, 'node');

    if (!fs.existsSync(nodePath) || !fs.statSync(nodePath).isFile()) {
        throw new Error(`Android Node Runtime 的 node 不存在: ${nodePath}`);
    }
    assertRequiredPackageEntries(packageDir);

    const temporaryOutputDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
    await fs.promises.mkdir(temporaryOutputDir, { recursive: true });

    try {
        const files = [];
        files.push(...await copyDirectoryWithManifest(runtimeDir, temporaryOutputDir, path.join('runtime', ANDROID_ABI)));
        files.push(...await copyDirectoryWithManifest(packageDir, temporaryOutputDir, 'server'));
        files.push(...await copyCertificates(
            options.certDir || process.env.AASC_ANDROID_NODE_CERT_DIR,
            temporaryOutputDir
        ));

        const version = String(
            options.version || process.env.AASC_ANDROID_NODE_RUNTIME_VERSION || 'dev'
        ).trim() || 'dev';
        const manifest = {
            version,
            abi: ANDROID_ABI,
            entrypoint: 'server/src/apps/server/boot/server-launcher.js',
            nodePath: `runtime/${ANDROID_ABI}/node`,
            files
        };
        await fs.promises.writeFile(
            path.join(temporaryOutputDir, 'runtime-manifest.json'),
            JSON.stringify(manifest, null, 2) + '\n',
            'utf8'
        );

        await fs.promises.rm(outputDir, { recursive: true, force: true });
        await fs.promises.rename(temporaryOutputDir, outputDir);
        return { outputDir, manifest };
    } catch (error) {
        await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
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
    REQUIRED_PACKAGE_ENTRIES,
    assertSafeRelativePath,
    prepareAndroidNodeRuntime
};
