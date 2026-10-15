'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const APP_RELATIVE_PATH = 'src/apps/voice-display-node';
const OBSERVABILITY_FILES = Object.freeze([
    'src/framework/observability/system-monitor.js',
    'src/framework/observability/console-redirect.js'
]);
const SIGNATURE_ALGORITHM = 'SHA256withRSA';

function assertVersion(version) {
    if (!Number.isSafeInteger(version) || version <= 0) {
        throw new Error('voice-display-node 包版本必须是正整数');
    }
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}

function signPayload(payload, privateKeyPem) {
    if (typeof privateKeyPem !== 'string' || privateKeyPem.length === 0) {
        throw new Error('voice-display-node 包缺少 Offline RSA 私钥');
    }
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalJson(payload), 'utf8');
    signer.end();
    return {
        algorithm: SIGNATURE_ALGORITHM,
        value: signer.sign(privateKeyPem, 'base64')
    };
}

function verifyPayloadSignature(metadata, publicKeyPem) {
    if (!metadata || !metadata.payload || metadata.signature?.algorithm !== SIGNATURE_ALGORITHM ||
        typeof metadata.signature.value !== 'string' || typeof publicKeyPem !== 'string') {
        throw new Error('voice-display-node 签名元数据格式无效');
    }
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalJson(metadata.payload), 'utf8');
    verifier.end();
    if (!verifier.verify(publicKeyPem, metadata.signature.value, 'base64')) {
        throw new Error('voice-display-node 签名元数据验签失败');
    }
    return true;
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

function isExcludedProgramPath(relativePath) {
    const normalized = relativePath.split(path.sep).join('/');
    const rootDataDirectories = ['run-task', 'logs', 'models', 'results', 'temp', 'tmp', '.cache'];
    const isRootData = rootDataDirectories.some(directory => normalized === directory || normalized.startsWith(`${directory}/`));
    return normalized === 'config.json' || isRootData || normalized === 'node_modules/.bin' ||
        normalized.startsWith('node_modules/.bin/');
}

async function copyProgramTree(sourceRoot, targetRoot, relativePath = '') {
    const sourceDirectory = path.join(sourceRoot, relativePath);
    const entries = await fs.promises.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
        const childRelativePath = path.join(relativePath, entry.name);
        if (isExcludedProgramPath(childRelativePath)) continue;
        const sourcePath = path.join(sourceRoot, childRelativePath);
        const stat = await fs.promises.lstat(sourcePath);
        if (stat.isSymbolicLink()) throw new Error(`Node 子显示端 ZIP 不允许符号链接: ${childRelativePath}`);
        const targetPath = path.join(targetRoot, childRelativePath);
        if (stat.isDirectory()) {
            await fs.promises.mkdir(targetPath, { recursive: true });
            await copyProgramTree(sourceRoot, targetRoot, childRelativePath);
        } else if (stat.isFile()) {
            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.promises.copyFile(sourcePath, targetPath);
        } else {
            throw new Error(`Node 子显示端 ZIP 包含不支持的文件类型: ${childRelativePath}`);
        }
    }
}

async function requireRegularFile(filePath, label) {
    const stat = await fs.promises.lstat(filePath).catch(error => {
        if (error.code === 'ENOENT') throw new Error(`${label}缺失: ${filePath}`);
        throw error;
    });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label}必须是普通文件: ${filePath}`);
    return stat;
}

function packageNameSegments(value) {
    const name = String(value || '');
    if (!/^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
        throw new Error(`Node 子显示端依赖名称无效: ${name}`);
    }
    return name.split('/');
}

async function validateProgramRoot(programRoot) {
    const stat = await fs.promises.lstat(programRoot).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Node 子显示端源码目录不存在或不是普通目录: ${programRoot}`);
    }
    await requireRegularFile(path.join(programRoot, 'main.js'), 'Node 子显示端入口');
    await requireRegularFile(path.join(programRoot, 'package.json'), 'Node 子显示端 package.json');
    await requireRegularFile(path.join(programRoot, 'package-lock.json'), 'Node 子显示端 package-lock.json');
    const packageJson = JSON.parse(await fs.promises.readFile(path.join(programRoot, 'package.json'), 'utf8'));
    const entrypoint = String(packageJson.main || 'main.js');
    if (path.isAbsolute(entrypoint) || entrypoint.split(/[\\/]/u).includes('..')) {
        throw new Error('Node 子显示端 package.json main 不安全');
    }
    await requireRegularFile(path.join(programRoot, entrypoint), 'Node 子显示端 package.json main');
    const nodeModulesRoot = path.join(programRoot, 'node_modules');
    const nodeModulesStat = await fs.promises.lstat(nodeModulesRoot).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!nodeModulesStat?.isDirectory() || nodeModulesStat.isSymbolicLink()) {
        throw new Error('Node 子显示端必须包含普通 node_modules 目录');
    }
    const declaredPackages = Object.keys(packageJson.dependencies || {});
    for (const packageName of declaredPackages) {
        const packagePath = path.join(nodeModulesRoot, ...packageNameSegments(packageName));
        const packageStat = await fs.promises.lstat(packagePath).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (!packageStat?.isDirectory() || packageStat.isSymbolicLink()) {
            throw new Error(`Node 子显示端 production 依赖缺失或不是普通目录: ${packageName}`);
        }
    }
    return packageJson;
}

async function validateObservabilityFiles(projectRoot) {
    for (const relativePath of OBSERVABILITY_FILES) {
        const fullPath = path.join(projectRoot, ...relativePath.split('/'));
        await requireRegularFile(fullPath, `Node 子显示端共享模块 ${relativePath}`);
    }
}

async function createZip(stagingDirectory, archivePath, commandRunner = execFileAsync) {
    await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });
    await commandRunner('zip', ['-X', '-q', '-r', archivePath, '.'], { cwd: stagingDirectory });
    const stat = await fs.promises.lstat(archivePath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1) {
        throw new Error(`生成 voice-display-node ZIP 失败: ${archivePath}`);
    }
    await commandRunner('unzip', ['-tqq', archivePath]);
}

async function stageVoiceDisplayNodePackage(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const workDirectory = path.resolve(options.workDirectory || '');
    if (!options.workDirectory) throw new Error('Node 子显示端打包需要临时工作目录');
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    const version = Number(options.version);
    assertVersion(version);

    const appRoot = path.join(projectRoot, ...APP_RELATIVE_PATH.split('/'));
    const packageJson = await validateProgramRoot(appRoot);
    await validateObservabilityFiles(projectRoot);
    const destinationDirectory = path.join(outputDir, 'voice-display-node');
    const archiveName = `voice-display-node-v${version}.zip`;
    const metadataName = `voice-display-node-v${version}.json`;
    const archiveDestination = path.join(destinationDirectory, archiveName);
    const metadataDestination = path.join(destinationDirectory, metadataName);
    for (const destination of [archiveDestination, metadataDestination]) {
        const stat = await fs.promises.lstat(destination).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (stat) throw new Error(`Node 子显示端版本文件已存在，拒绝覆盖: ${destination}`);
    }

    const snapshotRoot = path.join(workDirectory, 'voice-display-node-snapshot');
    const archivePath = path.join(workDirectory, archiveName);
    const metadataPath = path.join(workDirectory, metadataName);
    const targetAppRoot = path.join(snapshotRoot, ...APP_RELATIVE_PATH.split('/'));
    await fs.promises.mkdir(targetAppRoot, { recursive: true });
    await copyProgramTree(appRoot, targetAppRoot);
    for (const relativePath of OBSERVABILITY_FILES) {
        const sourcePath = path.join(projectRoot, ...relativePath.split('/'));
        const targetPath = path.join(snapshotRoot, ...relativePath.split('/'));
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.copyFile(sourcePath, targetPath);
    }

    const zipRunner = options.zipRunner || execFileAsync;
    await createZip(snapshotRoot, archivePath, zipRunner);
    const archiveStat = await fs.promises.stat(archivePath);
    const relativeUrl = `voice-display-node/${archiveName}`;
    const payload = {
        schemaVersion: 1,
        component: 'voiceDisplayNode',
        version,
        source: options.source || null,
        packageName: packageJson.name || 'voice-display-node',
        packageVersion: String(packageJson.version || ''),
        relativeUrl,
        size: archiveStat.size,
        sha256: await sha256File(archivePath)
    };
    const metadata = {
        payload,
        signature: signPayload(payload, options.privateKeyPem)
    };
    verifyPayloadSignature(metadata, options.publicKeyPem);
    await fs.promises.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });

    return {
        version,
        archivePath,
        archiveDestination,
        metadataPath,
        metadataDestination,
        metadata
    };
}

module.exports = {
    APP_RELATIVE_PATH,
    OBSERVABILITY_FILES,
    canonicalJson,
    signPayload,
    verifyPayloadSignature,
    sha256File,
    isExcludedProgramPath,
    validateProgramRoot,
    stageVoiceDisplayNodePackage
};
