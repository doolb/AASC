'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
    verifySignedManifest,
    validateManifestComponents
} = require('./offline-update-package');
const { loadOfflineUpdateKeyPair } = require('./offline-update-signing');

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '../..');
const DEFAULT_LOCAL_ROOT = '/mnt/aasc-offline';
const DEFAULT_LOCAL_VERIFY_URL = 'http://192.168.1.39/mnt/aasc-offline/';
// c.aasc.us 当前作为 DNS 入口使用；发布校验阶段直接访问已解析的公网 IP，避免代理返回 403。
const DEFAULT_WAN_VERIFY_URL = 'http://120.79.245.103/mnt/aasc-offline/';
const CLEANUP_RULES = Object.freeze([
    { componentName: 'code', directory: 'code', prefix: 'code-v', suffix: '.zip' },
    { componentName: 'dependencies', directory: 'dependencies', prefix: 'dependencies-v', suffix: '.zip' },
    { componentName: 'apkMin', directory: 'apk', prefix: 'aasc-display-offline-min-v', suffix: '.apk' },
    { componentName: 'apkFull', directory: 'apk', prefix: 'aasc-display-offline-v', suffix: '.apk' }
]);

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

function validateMode(mode) {
    if (!['code-only', 'all', 'apk-min', 'apk-full'].includes(mode)) {
        throw new Error('发布模式必须是 code-only、all、apk-min 或 apk-full');
    }
}

function validateRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' ||
        relativePath.startsWith('/') || relativePath.includes('\\') ||
        relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`发布清单包含不安全的相对路径: ${relativePath}`);
    }
}

function getPublishComponents(manifest, mode) {
    const components = manifest.payload.components;
    if (mode === 'apk-min') {
        if (!components.apkMin) throw new Error('apk-min 发布要求签名清单包含 apkMin 组件');
        return [components.apkMin];
    }
    const selected = [components.code];
    if (mode === 'all') selected.push(components.dependencies);
    return selected;
}

function getCleanupRule(relativePath) {
    return CLEANUP_RULES.find((rule) => {
        const directoryPrefix = `${rule.directory}/`;
        if (!relativePath.startsWith(directoryPrefix)) return false;
        return parseVersionedFileName(relativePath.slice(directoryPrefix.length), rule) !== null;
    }) || null;
}

function parseVersionedFileName(fileName, rule) {
    if (!fileName.startsWith(rule.prefix) || !fileName.endsWith(rule.suffix)) return null;
    const version = fileName.slice(rule.prefix.length, -rule.suffix.length);
    if (!/^\d+$/.test(version)) return null;
    return { fileName, version };
}

function createCleanupSpecifications(manifest, options = {}) {
    const components = manifest?.payload?.components || {};
    const specifications = [];
    const componentNames = options.includeApkMin === false
        ? ['code', 'dependencies']
        : ['code', 'dependencies', 'apkMin'];
    for (const componentName of componentNames) {
        const component = components[componentName];
        if (!component || typeof component.relativeUrl !== 'string') continue;
        const rule = CLEANUP_RULES.find((candidate) => candidate.componentName === componentName);
        if (!rule || !getCleanupRule(component.relativeUrl)) continue;
        specifications.push({ ...rule, keepRelativePath: component.relativeUrl });
    }
    if (options.includeFullApk) {
        const currentFullApkRelativeUrl = options.currentFullApkRelativeUrl;
        if (typeof currentFullApkRelativeUrl !== 'string') {
            throw new Error('完整 APK 清理必须指定当前 full APK 相对路径');
        }
        const rule = CLEANUP_RULES.find((candidate) => candidate.componentName === 'apkFull');
        if (!getCleanupRule(currentFullApkRelativeUrl) || getCleanupRule(currentFullApkRelativeUrl) !== rule) {
            throw new Error(`完整 APK 相对路径不符合版本命名规则: ${currentFullApkRelativeUrl}`);
        }
        specifications.push({ ...rule, keepRelativePath: currentFullApkRelativeUrl });
    }
    return specifications;
}

async function readDirectoryEntries(directoryPath) {
    try {
        return await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function cleanupLocalPublishedArtifacts(rootDirectory, manifest, options = {}) {
    const rootPath = path.resolve(rootDirectory);
    const result = { removedRelativePaths: [], errors: [] };
    if (rootPath === path.parse(rootPath).root) {
        result.errors.push({ relativePath: '.', message: `拒绝清理文件系统根目录: ${rootPath}` });
        return result;
    }
    const rootStat = await fs.promises.lstat(rootPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        result.errors.push({ relativePath: '.', message: error.message });
        return null;
    });
    if (!rootStat) return result;
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        result.errors.push({ relativePath: '.', message: `清理目标根目录不是普通目录: ${rootPath}` });
        return result;
    }
    let specifications;
    try {
        specifications = createCleanupSpecifications(manifest, options);
    } catch (error) {
        result.errors.push({ relativePath: '.', message: error.message });
        return result;
    }
    for (const specification of specifications) {
        const directoryPath = path.join(rootPath, specification.directory);
        const directoryStat = await fs.promises.lstat(directoryPath).catch((error) => {
            if (error.code === 'ENOENT') return null;
            result.errors.push({ relativePath: specification.directory, message: error.message });
            return null;
        });
        if (!directoryStat) continue;
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
            result.errors.push({
                relativePath: specification.directory,
                message: `清理目录不是普通目录: ${directoryPath}`
            });
            continue;
        }
        let entries;
        try {
            entries = await readDirectoryEntries(directoryPath);
        } catch (error) {
            result.errors.push({ relativePath: specification.directory, message: error.message });
            continue;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink() || !entry.isFile()) continue;
            const parsed = parseVersionedFileName(entry.name, specification);
            if (!parsed) continue;
            const relativePath = `${specification.directory}/${entry.name}`;
            if (relativePath === specification.keepRelativePath) continue;
            const filePath = path.join(directoryPath, entry.name);
            const fileStat = await fs.promises.lstat(filePath).catch((error) => {
                result.errors.push({ relativePath, message: error.message });
                return null;
            });
            if (!fileStat || fileStat.isSymbolicLink() || !fileStat.isFile()) continue;
            try {
                await fs.promises.unlink(filePath);
                result.removedRelativePaths.push(relativePath);
            } catch (error) {
                result.errors.push({ relativePath, message: error.message });
            }
        }
    }
    return result;
}

function resolveArtifactPath(artifactRoot, relativePath) {
    validateRelativePath(relativePath);
    const resolved = path.resolve(artifactRoot, ...relativePath.split('/'));
    const root = path.resolve(artifactRoot);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`发布清单路径越界: ${relativePath}`);
    }
    return resolved;
}

async function validateLocalArtifact(artifactRoot, relativePath, expected) {
    const root = path.resolve(artifactRoot);
    const rootStat = await fs.promises.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error(`本地更新包根目录必须是普通目录: ${root}`);
    }
    let currentPath = root;
    for (const segment of relativePath.split('/')) {
        currentPath = path.join(currentPath, segment);
        const stat = await fs.promises.lstat(currentPath);
        if (stat.isSymbolicLink()) throw new Error(`本地更新包不允许符号链接: ${relativePath}`);
        if (currentPath !== path.resolve(root, ...relativePath.split('/')) && !stat.isDirectory()) {
            throw new Error(`本地更新包路径中间项必须是目录: ${relativePath}`);
        }
    }
    const artifactPath = currentPath;
    const artifactStat = await fs.promises.stat(artifactPath);
    if (!artifactStat.isFile() || artifactStat.size !== expected.size || await sha256File(artifactPath) !== expected.sha256) {
        throw new Error(`本地 ${relativePath} 与签名清单中的大小/SHA-256 不符`);
    }
    return artifactPath;
}

async function inspectLocalTarget(rootDirectory, relativePath, expected) {
    const rootPath = path.resolve(rootDirectory);
    const rootStat = await fs.promises.lstat(rootPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
        throw new Error(`发布目标根目录必须是普通目录: ${rootPath}`);
    }

    const segments = relativePath.split('/');
    let currentPath = rootPath;
    for (const segment of segments.slice(0, -1)) {
        currentPath = path.join(currentPath, segment);
        const stat = await fs.promises.lstat(currentPath).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
            throw new Error(`发布目录中存在非目录或符号链接: ${currentPath}`);
        }
    }
    const targetPath = path.join(rootPath, ...segments);
    const targetStat = await fs.promises.lstat(targetPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!targetStat) return { exists: false, targetPath };
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        throw new Error(`拒绝覆盖非普通发布文件或符号链接: ${targetPath}`);
    }
    const existingStat = await fs.promises.stat(targetPath);
    if (existingStat.size !== expected.size || await sha256File(targetPath) !== expected.sha256) {
        throw new Error(`发布目标已有不同内容的同名版本文件，拒绝覆盖: ${targetPath}`);
    }
    return { exists: true, targetPath };
}

async function installLocalArtifact(sourcePath, rootDirectory, relativePath, expected, publishId) {
    const { exists, targetPath } = await inspectLocalTarget(rootDirectory, relativePath, expected);
    if (exists) return;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.tmp-${publishId}`;
    try {
        await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
        const stagedStat = await fs.promises.stat(temporaryPath);
        if (stagedStat.size !== expected.size || await sha256File(temporaryPath) !== expected.sha256) {
            throw new Error(`暂存发布文件校验失败: ${relativePath}`);
        }
        // hard link 提供“不覆盖已存在文件”的原子落点；临时文件和目标目录位于同一文件系统。
        await fs.promises.link(temporaryPath, targetPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
}

async function writeLocalManifestLast(manifestBytes, rootDirectory, publishId) {
    const target = path.join(path.resolve(rootDirectory), 'manifest.json');
    const rootStat = await fs.promises.lstat(path.resolve(rootDirectory)).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
        throw new Error(`发布目标根目录必须是普通目录: ${rootDirectory}`);
    }
    await fs.promises.mkdir(rootDirectory, { recursive: true });
    const existingStat = await fs.promises.lstat(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existingStat && (!existingStat.isFile() || existingStat.isSymbolicLink())) {
        throw new Error(`拒绝覆盖非普通签名清单或符号链接: ${target}`);
    }
    const temporaryPath = path.join(rootDirectory, `manifest.json.tmp-${publishId}`);
    const fileHandle = await fs.promises.open(temporaryPath, 'wx', 0o644);
    try {
        await fileHandle.writeFile(manifestBytes);
        await fileHandle.sync();
    } finally {
        await fileHandle.close();
    }
    await fs.promises.rename(temporaryPath, target);
}

function assertRemoteTarget(remote) {
    if (!remote || typeof remote !== 'object') throw new Error('远端 SCP 目标未配置');
    if (typeof remote.host !== 'string' || !/^[A-Za-z0-9_.@:-]+$/.test(remote.host)) {
        throw new Error('远端 SSH host 格式无效');
    }
    if (typeof remote.directory !== 'string' ||
        !/^(~\/|\/)[A-Za-z0-9_.\/-]+$/.test(remote.directory) ||
        remote.directory.split('/').includes('..')) {
        throw new Error('远端目录必须是以 ~/ 或 / 开头且不包含空格、shell 元字符或 .. 的路径');
    }
}

function remoteRootAssignment(remoteDirectory) {
    return remoteDirectory.startsWith('~/')
        ? `root="$HOME/${remoteDirectory.slice(2)}"`
        : `root='${remoteDirectory}'`;
}

function quoteRemoteShellArgument(value) {
    return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function quoteRemoteCleanupArgument(value) {
    const text = String(value);
    if (!/^[A-Za-z0-9_.\/-]+$/.test(text)) {
        throw new Error(`远端清理参数包含非法字符: ${text}`);
    }
    // 清理参数只来自固定规则和已经校验过的版本文件名，使用双引号避免
    // 嵌套在登录 shell 的单引号脚本中时被 fish 重新解释。
    return `"${text}"`;
}

function buildRemoteShellArguments(command) {
    return ['/bin/sh', '-c', quoteRemoteShellArgument(command)];
}

function buildRemoteCleanupCommand(remote, manifest, options = {}) {
    assertRemoteTarget(remote);
    const specifications = createCleanupSpecifications(manifest, options);
    if (specifications.length === 0) return null;
    const lines = [
        'set -eu',
        remoteRootAssignment(remote.directory),
        'cleanup_versioned_files() {',
        '  directory="$1"',
        '  prefix="$2"',
        '  suffix="$3"',
        '  keep="$4"',
        '  directory_path="$root/$directory"',
        '  [ -d "$directory_path" ] || return 0',
        '  [ -L "$directory_path" ] && return 0',
        '  for file in "$directory_path"/*; do',
        '    [ -e "$file" ] || continue',
        '    [ -L "$file" ] && continue',
        '    [ -f "$file" ] || continue',
        '    name=${file##*/}',
        '    case "$name" in',
        '      "$prefix"*"$suffix") ;;',
        '      *) continue ;;',
        '    esac',
        '    version=${name#"$prefix"}',
        '    version=${version%"$suffix"}',
        '    case "$version" in',
        '      ""|*[!0-9]*) continue ;;',
        '    esac',
        '    [ "$name" = "$keep" ] && continue',
        '    rm -- "$file"',
        '  done',
        '}'
    ];
    for (const specification of specifications) {
        const keepFileName = path.posix.basename(specification.keepRelativePath);
        lines.push([
            'cleanup_versioned_files',
            quoteRemoteCleanupArgument(specification.directory),
            quoteRemoteCleanupArgument(specification.prefix),
            quoteRemoteCleanupArgument(specification.suffix),
            quoteRemoteCleanupArgument(keepFileName)
        ].join(' '));
    }
    return lines.join('\n');
}

async function cleanupRemotePublishedArtifacts(commandRunner, remote, manifest, options = {}) {
    const command = buildRemoteCleanupCommand(remote, manifest, options);
    if (!command) return { removedRelativePaths: [], errors: [] };
    await runRemoteCommand(commandRunner, remote.host, command);
    return { removedRelativePaths: [], errors: [] };
}

async function runRemoteCommand(commandRunner, host, command) {
    try {
        return await commandRunner('ssh', [host, ...buildRemoteShellArguments(command)], { stdio: 'inherit' });
    } catch (error) {
        const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
        throw new Error(`远端发布命令失败: ${detail}`, { cause: error });
    }
}

async function inspectRemoteTarget(commandRunner, remote, relativePath, expected) {
    validateRelativePath(relativePath);
    const assignment = remoteRootAssignment(remote.directory);
    const command = [
        'set -eu',
        assignment,
        `target="$root/${relativePath}"`,
        'mkdir -p -- "$(dirname "$target")"',
        'if [ -L "$target" ]; then echo symlink >&2; exit 31; fi',
        'if [ -e "$target" ]; then',
        '  [ -f "$target" ] || { echo not-file >&2; exit 32; }',
        '  actual=$(sha256sum -- "$target")',
        '  actual=${actual%% *}',
        `  [ "$actual" = "${expected.sha256}" ] || { echo hash-conflict >&2; exit 33; }`,
        '  printf EXISTS',
        'else printf MISSING; fi'
    ].join('\n');
    const result = await runRemoteCommand(commandRunner, remote.host, command);
    return String(result.stdout || '').trim() === 'EXISTS';
}

async function installRemoteArtifact(commandRunner, remote, sourcePath, relativePath, expected, publishId) {
    const exists = await inspectRemoteTarget(commandRunner, remote, relativePath, expected);
    if (exists) return;
    const temporaryRelativePath = `${relativePath}.tmp-${publishId}`;
    const target = `${remote.host}:${remote.directory}/${temporaryRelativePath}`;
    try {
        await commandRunner('scp', [sourcePath, target], { stdio: 'inherit' });
    } catch (error) {
        const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
        throw new Error(`上传远端发布文件失败: ${relativePath}: ${detail}`, { cause: error });
    }
    const assignment = remoteRootAssignment(remote.directory);
    const finalizer = [
        'set -eu',
        assignment,
        `temporary="$root/${temporaryRelativePath}"`,
        `target="$root/${relativePath}"`,
        'if [ -L "$target" ]; then echo symlink >&2; exit 31; fi',
        'if [ -e "$target" ]; then',
        '  actual=$(sha256sum -- "$target")',
        '  actual=${actual%% *}',
        `  [ "$actual" = "${expected.sha256}" ] || { echo hash-conflict >&2; exit 33; }`,
        '  rm -- "$temporary"',
        'else',
        '  actual=$(sha256sum -- "$temporary")',
        '  actual=${actual%% *}',
        `  [ "$actual" = "${expected.sha256}" ] || { echo upload-hash-mismatch >&2; exit 34; }`,
        '  mv -- "$temporary" "$target"',
        'fi'
    ].join('\n');
    await runRemoteCommand(commandRunner, remote.host, finalizer);
}

async function writeRemoteManifestLast(commandRunner, remote, manifestBytes, publishId) {
    const temporaryPath = path.join(os.tmpdir(), `aasc-offline-manifest-${publishId}.json`);
    await fs.promises.writeFile(temporaryPath, manifestBytes, { flag: 'wx', mode: 0o600 });
    try {
        const remoteTemporaryPath = `${remote.directory}/manifest.json.tmp-${publishId}`;
        await commandRunner('scp', [temporaryPath, `${remote.host}:${remoteTemporaryPath}`], { stdio: 'inherit' });
        const assignment = remoteRootAssignment(remote.directory);
        await runRemoteCommand(commandRunner, remote.host, [
            'set -eu',
            assignment,
            'target="$root/manifest.json"',
            'temporary="$root/manifest.json.tmp-' + publishId + '"',
            'if [ -L "$target" ]; then echo symlink >&2; exit 31; fi',
            'chmod 0644 -- "$temporary"',
            'mv -- "$temporary" "$target"'
        ].join('\n'));
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

async function verifyHttpTarget(baseUrl, manifest, publicKeyPem, fetchImpl = globalThis.fetch) {
    const response = await fetchImpl(new URL('manifest.json', baseUrl));
    if (!response.ok) throw new Error(`HTTP 无法读取已发布清单: ${response.status} ${baseUrl}`);
    const publishedManifest = await response.json();
    verifySignedManifest(publishedManifest, publicKeyPem);
    if (JSON.stringify(publishedManifest) !== JSON.stringify(manifest)) {
        throw new Error(`HTTP 返回的已发布清单与本次清单不一致: ${baseUrl}`);
    }
    for (const [name, component] of Object.entries(manifest.payload.components)) {
        if (!component || !component.relativeUrl) continue;
        const artifactResponse = await fetchImpl(new URL(component.relativeUrl, baseUrl));
        const actual = await streamHash(artifactResponse);
        if (actual.size !== component.size || actual.sha256 !== component.sha256) {
            throw new Error(`HTTP 已发布 ${name} 包大小或 SHA-256 不匹配: ${baseUrl}`);
        }
    }
}

async function verifyHttpArtifactHead(baseUrl, relativePath, expected, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 不提供 HTTP fetch，无法校验完整 APK 发布目标');
    const response = await fetchImpl(new URL(relativePath, baseUrl), { method: 'HEAD' });
    if (!response.ok) {
        throw new Error(`HTTP 无法读取已发布完整 APK: ${response.status} ${baseUrl}`);
    }
    const contentLength = response.headers?.get?.('content-length');
    if (contentLength === null || contentLength === undefined || contentLength === '') {
        throw new Error(`HTTP 完整 APK 响应缺少 Content-Length: ${baseUrl}`);
    }
    if (Number(contentLength) !== expected.size) {
        throw new Error(`HTTP 完整 APK Content-Length 不匹配: ${baseUrl}`);
    }
    return { size: Number(contentLength) };
}

function validateFullApkBuildManifest(buildManifest) {
    if (!buildManifest || typeof buildManifest !== 'object') {
        throw new Error('完整 APK build manifest 必须是对象');
    }
    if (buildManifest.profile !== 'allserver' || buildManifest.updateOnly !== false) {
        throw new Error('完整 APK 发布只接受 allserver 且 updateOnly=false 的构建产物');
    }
    if (!Number.isSafeInteger(buildManifest.versionCode) || buildManifest.versionCode <= 0) {
        throw new Error('完整 APK build manifest 的 versionCode 必须是正整数');
    }
    return buildManifest;
}

async function readFullApkMetadata(apkPath, buildManifestPath) {
    const buildManifest = validateFullApkBuildManifest(
        JSON.parse(await fs.promises.readFile(path.resolve(buildManifestPath), 'utf8'))
    );
    const sourcePath = path.resolve(apkPath);
    const sourceStat = await fs.promises.lstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(`完整 APK 必须是普通文件: ${sourcePath}`);
    }
    if (buildManifest.apk && path.basename(buildManifest.apk) !== path.basename(sourcePath)) {
        throw new Error(`完整 APK 文件名与 build manifest 不一致: ${sourcePath}`);
    }
    const relativeUrl = `apk/aasc-display-offline-v${buildManifest.versionCode}.apk`;
    const metadata = {
        versionCode: buildManifest.versionCode,
        versionName: buildManifest.versionName,
        relativeUrl,
        size: sourceStat.size,
        sha256: await sha256File(sourcePath)
    };
    validateRelativePath(relativeUrl);
    return { sourcePath, buildManifest, metadata };
}

async function publishOfflineFullApk(options = {}) {
    const apkPath = options.apkPath;
    const buildManifestPath = options.buildManifestPath;
    if (!apkPath || !buildManifestPath) {
        throw new Error('完整 APK 发布必须指定 apkPath 和 buildManifestPath');
    }
    const { sourcePath, buildManifest, metadata } = await readFullApkMetadata(apkPath, buildManifestPath);
    const publishId = `${Date.now()}-${process.pid}`;
    const localRoot = options.localRoot ? path.resolve(options.localRoot) : null;
    const remote = options.remote || null;
    if (!localRoot && !remote) throw new Error('至少指定 localRoot 或 remote 发布目标');
    if (remote) assertRemoteTarget(remote);
    const localPublishedPaths = [];
    const remotePublishedPaths = [];
    const cleanupErrors = [];

    if (localRoot) {
        await installLocalArtifact(sourcePath, localRoot, metadata.relativeUrl, metadata, publishId);
        localPublishedPaths.push(metadata.relativeUrl);
        if (options.localVerifyUrl) {
            await verifyHttpArtifactHead(options.localVerifyUrl, metadata.relativeUrl, metadata, options.fetchImpl);
        }
        const cleanupResult = await cleanupLocalPublishedArtifacts(localRoot, null, {
            includeApkMin: false,
            includeFullApk: true,
            currentFullApkRelativeUrl: metadata.relativeUrl
        });
        cleanupErrors.push(...cleanupResult.errors.map((error) => ({ target: 'local', ...error })));
    }

    if (remote) {
        const commandRunner = options.commandRunner || execFileAsync;
        await installRemoteArtifact(commandRunner, remote, sourcePath, metadata.relativeUrl, metadata, publishId);
        remotePublishedPaths.push(metadata.relativeUrl);
        if (options.remoteVerifyUrl) {
            await verifyHttpArtifactHead(options.remoteVerifyUrl, metadata.relativeUrl, metadata, options.fetchImpl);
        }
        try {
            await cleanupRemotePublishedArtifacts(commandRunner, remote, null, {
                includeApkMin: false,
                includeFullApk: true,
                currentFullApkRelativeUrl: metadata.relativeUrl
            });
        } catch (error) {
            cleanupErrors.push({ target: 'remote', relativePath: '.', message: error.message });
        }
    }
    return {
        buildManifest,
        metadata,
        publishedRelativePaths: localRoot ? localPublishedPaths : remotePublishedPaths,
        localPublishedPaths,
        remotePublishedPaths,
        cleanupErrors
    };
}

async function publishOfflineUpdate(options = {}) {
    const mode = String(options.mode || '').trim();
    validateMode(mode);
    if (mode === 'apk-full') {
        throw new Error('apk-full 必须使用 publishOfflineFullApk，并提供完整 APK build manifest');
    }
    const artifactRoot = path.resolve(options.artifactRoot || '');
    const manifestPath = path.resolve(options.manifestPath || '');
    const keyPair = options.publicKeyPem ? null : await loadOfflineUpdateKeyPair(options);
    const publicKeyPem = options.publicKeyPem || keyPair.publicKeyPem;
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    verifySignedManifest(manifest, publicKeyPem);
    validateManifestComponents(manifest);
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const selected = getPublishComponents(manifest, mode);
    const uploads = [];
    for (const component of selected) {
        validateRelativePath(component.relativeUrl);
        const artifactPath = resolveArtifactPath(artifactRoot, component.relativeUrl);
        uploads.push({ component, artifactPath: await validateLocalArtifact(artifactRoot, component.relativeUrl, component) });
    }

    const preserved = mode === 'code-only'
        ? [manifest.payload.components.dependencies]
        : mode === 'apk-min'
            ? [manifest.payload.components.code, manifest.payload.components.dependencies]
            : [];
    const publishId = `${Date.now()}-${process.pid}`;
    const localRoot = options.localRoot ? path.resolve(options.localRoot) : null;
    const remote = options.remote || null;
    if (!localRoot && !remote) throw new Error('至少指定 localRoot 或 remote 发布目标');
    if (remote) assertRemoteTarget(remote);
    const localPublishedPaths = [];
    const remotePublishedPaths = [];
    const cleanupErrors = [];

    if (localRoot) {
        for (const component of preserved) {
            const result = await inspectLocalTarget(localRoot, component.relativeUrl, component);
            if (!result.exists) throw new Error(`code-only 发布要求目标已有匹配依赖包: ${component.relativeUrl}`);
        }
        for (const { component } of uploads) {
            await inspectLocalTarget(localRoot, component.relativeUrl, component);
        }
        for (const { component, artifactPath } of uploads) {
            await installLocalArtifact(artifactPath, localRoot, component.relativeUrl, component, publishId);
            localPublishedPaths.push(component.relativeUrl);
        }
        await writeLocalManifestLast(manifestBytes, localRoot, publishId);
        localPublishedPaths.push('manifest.json');
        if (options.localVerifyUrl) {
            await verifyHttpTarget(options.localVerifyUrl, manifest, publicKeyPem, options.fetchImpl);
        }
        const cleanupResult = await cleanupLocalPublishedArtifacts(localRoot, manifest);
        cleanupErrors.push(...cleanupResult.errors.map((error) => ({ target: 'local', ...error })));
    }

    if (remote) {
        const commandRunner = options.commandRunner || execFileAsync;
        for (const component of [...preserved, ...uploads.map(({ component }) => component)]) {
            const exists = await inspectRemoteTarget(commandRunner, remote, component.relativeUrl, component);
            if (preserved.includes(component) && !exists) {
                throw new Error(`code-only 发布要求远端已有匹配依赖包: ${component.relativeUrl}`);
            }
        }
        for (const { component, artifactPath } of uploads) {
            await installRemoteArtifact(commandRunner, remote, artifactPath, component.relativeUrl, component, publishId);
            remotePublishedPaths.push(component.relativeUrl);
        }
        await writeRemoteManifestLast(commandRunner, remote, manifestBytes, publishId);
        remotePublishedPaths.push('manifest.json');
        if (options.remoteVerifyUrl) {
            await verifyHttpTarget(options.remoteVerifyUrl, manifest, publicKeyPem, options.fetchImpl);
        }
        try {
            await cleanupRemotePublishedArtifacts(commandRunner, remote, manifest);
        } catch (error) {
            cleanupErrors.push({ target: 'remote', relativePath: '.', message: error.message });
        }
    }
    return {
        manifest,
        publishedRelativePaths: localRoot ? localPublishedPaths : remotePublishedPaths,
        localPublishedPaths,
        remotePublishedPaths,
        cleanupErrors
    };
}

async function runCli(argv = process.argv.slice(2)) {
    try {
        const options = parsePublisherCliArguments(argv);
        if (!options.remoteDir) throw new Error('外网 SCP 路径尚未确认；请通过 --remote-dir 显式指定目标目录');
        const remote = { host: 'as@120.79.245.103', directory: options.remoteDir };
        if (options.mode === 'apk-full') {
            if (!options.apk || !options.buildManifest) {
                throw new Error('完整 APK 发布必须通过 --apk 和 --build-manifest 指定输入文件');
            }
            const result = await publishOfflineFullApk({
                apkPath: path.resolve(options.apk),
                buildManifestPath: path.resolve(options.buildManifest),
                localRoot: options.localRoot || DEFAULT_LOCAL_ROOT,
                remote,
                localVerifyUrl: DEFAULT_LOCAL_VERIFY_URL,
                remoteVerifyUrl: DEFAULT_WAN_VERIFY_URL
            });
            console.log(`局域网已发布: ${result.localPublishedPaths.join(', ')}`);
            console.log(`外网已发布: ${result.remotePublishedPaths.join(', ')}`);
            if (result.cleanupErrors.length > 0) {
                console.warn(`Offline 旧资源清理待重试: ${JSON.stringify(result.cleanupErrors)}`);
            }
            return;
        }
        const keyPair = await loadOfflineUpdateKeyPair();
        if (!options.manifestFile) throw new Error('发布必须通过 --manifest-file 指定本次签名清单');
        const outputDir = options.outputDir || path.join(projectRoot, 'release/offline-update/output');
        const result = await publishOfflineUpdate({
            mode: options.mode,
            artifactRoot: outputDir,
            manifestPath: path.resolve(options.manifestFile),
            publicKeyPem: keyPair.publicKeyPem,
            localRoot: options.localRoot || DEFAULT_LOCAL_ROOT,
            remote,
            localVerifyUrl: DEFAULT_LOCAL_VERIFY_URL,
            remoteVerifyUrl: DEFAULT_WAN_VERIFY_URL
        });
        console.log(`局域网已发布: ${result.localPublishedPaths.join(', ')}`);
        console.log(`外网已发布: ${result.remotePublishedPaths.join(', ')}`);
        if (result.cleanupErrors.length > 0) {
            console.warn(`Offline 旧资源清理待重试: ${JSON.stringify(result.cleanupErrors)}`);
        }
    } catch (error) {
        console.error(`Offline 更新发布失败: ${error.message}`);
        process.exitCode = 1;
    }
}

function parsePublisherCliArguments(argv) {
    const supported = new Set([
        'mode', 'output-dir', 'manifest-file', 'remote-dir', 'local-root', 'apk', 'build-manifest'
    ]);
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
        if (!supported.has(key)) throw new Error(`未知发布参数: --${key}`);
        if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
        if (Object.prototype.hasOwnProperty.call(parsed, key)) throw new Error(`参数 --${key} 不能重复`);
        parsed[key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
    }
    return parsed;
}

if (require.main === module) runCli();

module.exports = {
    publishOfflineUpdate,
    publishOfflineFullApk,
    cleanupLocalPublishedArtifacts,
    cleanupRemotePublishedArtifacts,
    buildRemoteCleanupCommand,
    verifyHttpTarget,
    verifyHttpArtifactHead,
    validateRelativePath,
    assertRemoteTarget,
    parsePublisherCliArguments,
    buildRemoteShellArguments,
    DEFAULT_LOCAL_ROOT,
    DEFAULT_LOCAL_VERIFY_URL,
    DEFAULT_WAN_VERIFY_URL
};
