'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { verifySignedManifest } = require('./offline-update-package');
const { loadOfflineUpdatePublicKey } = require('./offline-update-signing');
const { assertRemoteTarget, buildRemoteShellArguments } = require('./publish-offline-update');

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '../..');
const DEFAULT_LOCAL_ROOT = '/mnt/aasc-offline';
const DEFAULT_REMOTE = Object.freeze({ host: 'as@120.79.245.103', directory: '~/a/aasc-offline' });
const DEFAULT_LOCAL_VERIFY_URL = 'http://192.168.1.39/mnt/aasc-offline/';
const DEFAULT_WAN_VERIFY_URL = 'http://120.79.245.103/mnt/aasc-offline/';
const NODE_DIRECTORY = 'voice-display-node';
const VERSIONED_FILE_PATTERN = /^voice-display-node-v([0-9]+)\.(zip|json)$/u;

function getVersionFileNames(version) {
    if (!Number.isSafeInteger(version) || version <= 0) throw new Error('voice-display-node 发布版本必须是正整数');
    return {
        archiveName: `voice-display-node-v${version}.zip`,
        metadataName: `voice-display-node-v${version}.json`
    };
}

function relativeArtifactPath(fileName) {
    return `${NODE_DIRECTORY}/${fileName}`;
}

async function describeFile(filePath) {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`发布输入必须是普通文件: ${filePath}`);
    return { size: stat.size, sha256: await sha256File(filePath) };
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

function isSha256(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

async function readAndValidateBundle(options) {
    const version = Number(options.version);
    const { archiveName, metadataName } = getVersionFileNames(version);
    const voiceRoot = path.join(path.resolve(options.artifactRoot), NODE_DIRECTORY);
    const archivePath = path.join(voiceRoot, archiveName);
    const metadataPath = path.join(voiceRoot, metadataName);
    const [archiveStats, metadataStats] = await Promise.all([
        describeFile(archivePath),
        describeFile(metadataPath)
    ]);
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
    verifySignedManifest(metadata, options.publicKeyPem);
    const payload = metadata.payload;
    if (payload.schemaVersion !== 1 || payload.component !== 'voiceDisplayNode' || payload.version !== version ||
        payload.relativeUrl !== relativeArtifactPath(archiveName) || !Number.isSafeInteger(payload.size) || payload.size <= 0 ||
        !isSha256(payload.sha256)) {
        throw new Error('voice-display-node 签名元数据与发布版本/路径无效');
    }
    if (archiveStats.size !== payload.size || archiveStats.sha256 !== payload.sha256) {
        throw new Error('voice-display-node ZIP 与签名元数据大小或 SHA-256 不一致');
    }
    await (options.commandRunner || execFileAsync)('unzip', ['-tqq', archivePath]);
    return {
        version,
        archivePath,
        metadataPath,
        metadata,
        archiveName,
        metadataName,
        archiveExpected: { relativePath: relativeArtifactPath(archiveName), ...archiveStats },
        metadataExpected: { relativePath: relativeArtifactPath(metadataName), ...metadataStats }
    };
}

async function ensureLocalDirectory(rootDirectory, relativeDirectory) {
    const rootPath = path.resolve(rootDirectory);
    const rootStat = await fs.promises.lstat(rootPath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
        throw new Error(`发布目标根目录必须是普通目录: ${rootPath}`);
    }
    if (!rootStat) await fs.promises.mkdir(rootPath, { recursive: true });
    const targetDirectory = path.join(rootPath, relativeDirectory);
    const targetStat = await fs.promises.lstat(targetDirectory).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) {
        throw new Error(`发布子目录必须是普通目录: ${targetDirectory}`);
    }
    if (!targetStat) await fs.promises.mkdir(targetDirectory);
    return targetDirectory;
}

async function installLocalArtifact(sourcePath, rootDirectory, expected, publishId) {
    const targetPath = path.join(path.resolve(rootDirectory), ...expected.relativePath.split('/'));
    const existing = await fs.promises.lstat(targetPath).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`拒绝覆盖非普通发布文件或链接: ${targetPath}`);
        const stats = await describeFile(targetPath);
        if (stats.size !== expected.size || stats.sha256 !== expected.sha256) {
            throw new Error(`发布目标已有不同内容的同名版本文件，拒绝覆盖: ${targetPath}`);
        }
        return;
    }
    const temporaryPath = `${targetPath}.tmp-${publishId}`;
    try {
        await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
        const temporary = await describeFile(temporaryPath);
        if (temporary.size !== expected.size || temporary.sha256 !== expected.sha256) {
            throw new Error(`本地暂存文件校验失败: ${expected.relativePath}`);
        }
        await fs.promises.link(temporaryPath, targetPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
}

async function streamHash(response) {
    if (!response.ok || !response.body) throw new Error(`HTTP 下载校验失败: ${response.status}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        hash.update(buffer);
    }
    return { size, sha256: hash.digest('hex') };
}

async function verifyHttpBundle(baseUrl, bundle, publicKeyPem, fetchImpl = globalThis.fetch) {
    const metadataResponse = await fetchImpl(new URL(bundle.metadataExpected.relativePath, baseUrl));
    if (!metadataResponse.ok) throw new Error(`HTTP 无法读取 Node 子显示端签名元数据: ${metadataResponse.status} ${baseUrl}`);
    const publishedMetadata = await metadataResponse.json();
    verifySignedManifest(publishedMetadata, publicKeyPem);
    if (JSON.stringify(publishedMetadata) !== JSON.stringify(bundle.metadata)) {
        throw new Error(`HTTP 返回的 Node 子显示端签名元数据与本次构建不一致: ${baseUrl}`);
    }
    const actual = await streamHash(await fetchImpl(new URL(bundle.archiveExpected.relativePath, baseUrl)));
    if (actual.size !== bundle.archiveExpected.size || actual.sha256 !== bundle.archiveExpected.sha256) {
        throw new Error(`HTTP Node 子显示端 ZIP 大小或 SHA-256 不匹配: ${baseUrl}`);
    }
    return { metadata: true, ...actual };
}

async function cleanupLocalArtifacts(rootDirectory, keepVersion) {
    const removed = [];
    const errors = [];
    let directoryPath;
    try {
        directoryPath = await ensureLocalDirectory(rootDirectory, NODE_DIRECTORY);
        const keepNames = new Set(Object.values(getVersionFileNames(keepVersion)));
        for (const entry of await fs.promises.readdir(directoryPath, { withFileTypes: true })) {
            const match = VERSIONED_FILE_PATTERN.exec(entry.name);
            if (!match || keepNames.has(entry.name)) continue;
            const filePath = path.join(directoryPath, entry.name);
            try {
                const stat = await fs.promises.lstat(filePath);
                if (!stat.isFile() || stat.isSymbolicLink()) continue;
                await fs.promises.unlink(filePath);
                removed.push(`${NODE_DIRECTORY}/${entry.name}`);
            } catch (error) {
                errors.push({ relativePath: `${NODE_DIRECTORY}/${entry.name}`, message: error.message });
            }
        }
    } catch (error) {
        errors.push({ relativePath: NODE_DIRECTORY, message: error.message });
    }
    return { removed, errors };
}

function buildRemoteRootAssignment(remoteDirectory) {
    return remoteDirectory.startsWith('~/')
        ? `root="$HOME/${remoteDirectory.slice(2)}"`
        : `root='${remoteDirectory}'`;
}

function buildRemotePrepareCommand(remote) {
    assertRemoteTarget(remote);
    return [
        'set -eu',
        buildRemoteRootAssignment(remote.directory),
        'directory="$root/voice-display-node"',
        '[ -L "$root" ] && { echo root-symlink >&2; exit 31; } || true',
        'mkdir -p -- "$directory"',
        '[ -L "$directory" ] && { echo directory-symlink >&2; exit 32; } || true',
        '[ -d "$directory" ] || { echo not-directory >&2; exit 33; }'
    ].join('\n');
}

function buildRemoteTemporaryCheckCommand(remote, relativePath, publishId) {
    assertRemoteTarget(remote);
    const fileName = path.posix.basename(relativePath);
    if (!VERSIONED_FILE_PATTERN.test(fileName)) throw new Error(`远端 Node 子显示端文件名无效: ${fileName}`);
    const temporaryName = `.${fileName}.tmp-${publishId}`;
    return [
        'set -eu',
        buildRemoteRootAssignment(remote.directory),
        'directory="$root/voice-display-node"',
        '[ -L "$directory" ] && { echo directory-symlink >&2; exit 31; } || true',
        '[ -d "$directory" ] || { echo not-directory >&2; exit 32; }',
        `temporary="$directory/${temporaryName}"`,
        '[ -L "$temporary" ] && { echo temporary-symlink >&2; exit 33; } || true',
        '[ ! -e "$temporary" ] || { echo temporary-exists >&2; exit 34; }'
    ].join('\n');
}

function buildRemoteInstallCommand(remote, relativePath, expected, publishId) {
    assertRemoteTarget(remote);
    const fileName = path.posix.basename(relativePath);
    if (!VERSIONED_FILE_PATTERN.test(fileName)) throw new Error(`远端 Node 子显示端文件名无效: ${fileName}`);
    const temporaryName = `.${fileName}.tmp-${publishId}`;
    return [
        'set -eu',
        buildRemoteRootAssignment(remote.directory),
        'directory="$root/voice-display-node"',
        '[ -L "$directory" ] && { echo directory-symlink >&2; exit 31; } || true',
        '[ -d "$directory" ] || { echo not-directory >&2; exit 32; }',
        `temporary="$directory/${temporaryName}"`,
        `target="$directory/${fileName}"`,
        '[ -L "$target" ] && { echo target-symlink >&2; exit 33; } || true',
        'if [ -e "$target" ]; then',
        '  [ -f "$target" ] || { echo target-not-file >&2; exit 34; }',
        '  actual=$(sha256sum -- "$target")',
        '  actual=${actual%% *}',
        `  [ "$actual" = "${expected.sha256}" ] || { echo version-conflict >&2; exit 35; }`,
        '  rm -f -- "$temporary"',
        'else',
        '  actual=$(sha256sum -- "$temporary")',
        '  actual=${actual%% *}',
        `  [ "$actual" = "${expected.sha256}" ] || { echo upload-hash-mismatch >&2; exit 36; }`,
        '  ln -- "$temporary" "$target"',
        '  rm -- "$temporary"',
        'fi'
    ].join('\n');
}

function buildRemoteCleanupCommand(remote, keepVersion) {
    assertRemoteTarget(remote);
    const keepNames = Object.values(getVersionFileNames(keepVersion));
    return [
        'set -eu',
        buildRemoteRootAssignment(remote.directory),
        'directory="$root/voice-display-node"',
        '[ -L "$root" ] && exit 0',
        '[ -d "$directory" ] || exit 0',
        '[ -L "$directory" ] && exit 0',
        'for file in "$directory"/voice-display-node-v*.zip "$directory"/voice-display-node-v*.json; do',
        '  [ -e "$file" ] || continue',
        '  [ -L "$file" ] && continue',
        '  [ -f "$file" ] || continue',
        '  name=${file##*/}',
        '  case "$name" in voice-display-node-v*.zip) version=${name#voice-display-node-v}; version=${version%.zip} ;; voice-display-node-v*.json) version=${name#voice-display-node-v}; version=${version%.json} ;; *) continue ;; esac',
        '  case "$version" in ""|*[!0-9]*) continue ;; esac',
        `  case "$name" in ${keepNames.join('|')}) continue ;; esac`,
        '  rm -- "$file"',
        'done'
    ].join('\n');
}

async function runRemoteCommand(commandRunner, remote, command) {
    try {
        return await commandRunner('ssh', [remote.host, ...buildRemoteShellArguments(command)], { stdio: 'inherit' });
    } catch (error) {
        const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
        throw new Error(`Node 子显示端远端命令失败: ${detail}`, { cause: error });
    }
}

async function installRemoteArtifact(commandRunner, remote, sourcePath, expected, publishId) {
    const relativePath = expected.relativePath;
    const fileName = path.posix.basename(relativePath);
    const temporaryName = `.${fileName}.tmp-${publishId}`;
    const remoteTemporaryPath = `${remote.directory}/${NODE_DIRECTORY}/${temporaryName}`;
    await runRemoteCommand(commandRunner, remote,
        buildRemoteTemporaryCheckCommand(remote, relativePath, publishId));
    try {
        await commandRunner('scp', [sourcePath, `${remote.host}:${remoteTemporaryPath}`], { stdio: 'inherit' });
    } catch (error) {
        throw new Error(`上传 Node 子显示端文件失败: ${relativePath}: ${error.stderr?.trim() || error.message}`, { cause: error });
    }
    await runRemoteCommand(commandRunner, remote, buildRemoteInstallCommand(remote, relativePath, expected, publishId));
}

async function cleanupRemoteArtifacts(commandRunner, remote, version) {
    await runRemoteCommand(commandRunner, remote, buildRemoteCleanupCommand(remote, version));
}

async function publishLocalBundle(bundle, options) {
    const result = { published: [], cleanup: { removed: [], errors: [] } };
    const publishId = `${Date.now()}-${process.pid}`;
    await ensureLocalDirectory(options.localRoot, NODE_DIRECTORY);
    for (const [sourcePath, expected] of [
        [bundle.archivePath, bundle.archiveExpected],
        [bundle.metadataPath, bundle.metadataExpected]
    ]) {
        await installLocalArtifact(sourcePath, options.localRoot, expected, publishId);
        result.published.push(expected.relativePath);
    }
    result.http = await verifyHttpBundle(options.localVerifyUrl, bundle, options.publicKeyPem, options.fetchImpl);
    result.cleanup = await cleanupLocalArtifacts(options.localRoot, bundle.version);
    return result;
}

async function publishRemoteBundle(bundle, options) {
    const remote = options.remote;
    assertRemoteTarget(remote);
    const commandRunner = options.commandRunner || execFileAsync;
    const publishId = `${Date.now()}-${process.pid}`;
    const result = { published: [], cleanup: { removed: [], errors: [] } };
    await runRemoteCommand(commandRunner, remote, buildRemotePrepareCommand(remote));
    for (const [sourcePath, expected] of [
        [bundle.archivePath, bundle.archiveExpected],
        [bundle.metadataPath, bundle.metadataExpected]
    ]) {
        await installRemoteArtifact(commandRunner, remote, sourcePath, expected, publishId);
        result.published.push(expected.relativePath);
    }
    result.http = await verifyHttpBundle(options.remoteVerifyUrl, bundle, options.publicKeyPem, options.fetchImpl);
    try {
        await cleanupRemoteArtifacts(commandRunner, remote, bundle.version);
    } catch (error) {
        result.cleanup.errors.push({ relativePath: NODE_DIRECTORY, message: error.message });
    }
    return result;
}

async function publishVoiceDisplayNodePackage(options = {}) {
    const key = await loadOfflineUpdatePublicKey({ publicKeyPem: options.publicKeyPem });
    const bundle = await readAndValidateBundle({
        version: options.version,
        artifactRoot: options.artifactRoot || path.join(projectRoot, 'release/offline-update/output'),
        publicKeyPem: key.publicKeyPem,
        commandRunner: options.commandRunner
    });
    const common = {
        ...options,
        publicKeyPem: key.publicKeyPem,
        localRoot: options.localRoot || DEFAULT_LOCAL_ROOT,
        localVerifyUrl: options.localVerifyUrl || DEFAULT_LOCAL_VERIFY_URL,
        remoteVerifyUrl: options.remoteVerifyUrl || DEFAULT_WAN_VERIFY_URL,
        remote: options.remote || DEFAULT_REMOTE
    };
    const result = { version: bundle.version, archivePath: bundle.archivePath, local: null, remote: null, errors: [] };
    try {
        result.local = await publishLocalBundle(bundle, common);
    } catch (error) {
        result.errors.push({ target: 'LAN', message: error.message });
    }
    try {
        result.remote = await publishRemoteBundle(bundle, common);
    } catch (error) {
        result.errors.push({ target: 'WAN', message: error.message });
    }
    return result;
}

function parseCliArguments(argv) {
    const supported = new Set(['version', 'output-dir', 'local-root', 'remote-dir']);
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
        if (!supported.has(key)) throw new Error(`未知参数: --${key}`);
        if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
        if (Object.hasOwn(parsed, key)) throw new Error(`参数 --${key} 不能重复`);
        parsed[key] = key === 'version' ? Number(value) : value;
    }
    getVersionFileNames(parsed.version);
    return {
        version: parsed.version,
        artifactRoot: parsed.outputDir || path.join(projectRoot, 'release/offline-update/output'),
        localRoot: parsed.localRoot,
        remote: { ...DEFAULT_REMOTE, directory: parsed.remoteDir || DEFAULT_REMOTE.directory }
    };
}

async function runCli(argv = process.argv.slice(2)) {
    try {
        const options = parseCliArguments(argv);
        const result = await publishVoiceDisplayNodePackage(options);
        if (result.local) console.log(`LAN Node 子显示端已校验发布: ${result.local.published.join(', ')}`);
        if (result.remote) console.log(`WAN Node 子显示端已校验发布: ${result.remote.published.join(', ')}`);
        for (const target of ['local', 'remote']) {
            const cleanup = result[target]?.cleanup;
            if (cleanup?.errors?.length) console.warn(`${target} 旧 Node ZIP 清理可重试: ${JSON.stringify(cleanup.errors)}`);
        }
        if (result.errors.length) throw new Error(JSON.stringify(result.errors));
    } catch (error) {
        console.error(`Node 子显示端独立 ZIP 发布失败: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) runCli();

module.exports = {
    NODE_DIRECTORY,
    VERSIONED_FILE_PATTERN,
    getVersionFileNames,
    relativeArtifactPath,
    readAndValidateBundle,
    verifyHttpBundle,
    cleanupLocalArtifacts,
    buildRemotePrepareCommand,
    buildRemoteTemporaryCheckCommand,
    buildRemoteInstallCommand,
    buildRemoteCleanupCommand,
    publishVoiceDisplayNodePackage,
    publishLocalBundle,
    publishRemoteBundle,
    parseCliArguments
};
