'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    verifySignedManifest,
    validateManifestComponents
} = require('./offline-update-package');
const {
    loadOfflineUpdatePublicKey
} = require('./offline-update-signing');
const {
    cleanupLocalPublishedArtifacts,
    validateRelativePath
} = require('./publish-offline-update');

const DEFAULT_SOURCE_URL = 'http://120.79.245.103/mnt/aasc-offline/';
const DEFAULT_LOCAL_ROOT = '/mnt/aasc-offline';
const SOURCE_ENV = 'AASC_OFFLINE_SYNC_SOURCE';
const LOCAL_ROOT_ENV = 'AASC_OFFLINE_LOCAL_ROOT';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const SYNC_COMPONENT_NAMES = Object.freeze(['code', 'dependencies', 'apkMin', 'dataRepair']);

function normalizeBaseUrl(value, name) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${name} 不能为空`);
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch (error) {
        throw new Error(`${name} 不是有效 URL: ${error.message}`, { cause: error });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${name} 只支持 HTTP 或 HTTPS`);
    }
    if (parsed.search || parsed.hash) throw new Error(`${name} 不允许 query 或 fragment`);
    return parsed.toString().endsWith('/') ? parsed.toString() : `${parsed.toString()}/`;
}

function sha256Buffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function fetchWithTimeout(url, options = {}) {
    const timeoutMs = options.timeoutMs || 15_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await (options.fetchImpl || globalThis.fetch)(url, {
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function readRemoteManifest(sourceUrl, options = {}) {
    const response = await fetchWithTimeout(new URL('manifest.json', sourceUrl), options);
    if (!response.ok) throw new Error(`读取外网 Offline 清单失败，HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_MANIFEST_BYTES) {
        throw new Error(`Offline 清单大小超出限制: ${bytes.length}`);
    }
    let manifest;
    try {
        manifest = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
        throw new Error(`外网 Offline 清单不是有效 JSON: ${error.message}`, { cause: error });
    }
    return manifest;
}

async function ensureOrdinaryDirectory(directoryPath, label) {
    const resolved = path.resolve(directoryPath);
    const existing = await fs.promises.lstat(resolved).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
        throw new Error(`${label} 必须是普通目录: ${resolved}`);
    }
    await fs.promises.mkdir(resolved, { recursive: true });
    return resolved;
}

async function resolveSafePath(rootDirectory, relativePath) {
    validateRelativePath(relativePath);
    const root = path.resolve(rootDirectory);
    let current = root;
    const segments = relativePath.split('/');
    for (const [index, segment] of segments.entries()) {
        current = path.join(current, segment);
        const stat = await fs.promises.lstat(current).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (!stat) continue;
        if (stat.isSymbolicLink()) throw new Error(`同步目标不允许符号链接: ${relativePath}`);
        if (index < segments.length - 1 && !stat.isDirectory()) {
            throw new Error(`同步目标路径中间项必须是目录: ${relativePath}`);
        }
    }
    return current;
}

function selectSyncComponents(manifest) {
    const components = manifest?.payload?.components || {};
    return SYNC_COMPONENT_NAMES
        .map((name) => ({ name, component: components[name] }))
        .filter(({ component }) => component && typeof component.relativeUrl === 'string');
}

async function downloadArtifact(sourceUrl, component, stagingPath, options = {}) {
    const response = await fetchWithTimeout(new URL(component.relativeUrl, sourceUrl), options);
    if (!response.ok) {
        throw new Error(`下载 ${component.relativeUrl} 失败，HTTP ${response.status}`);
    }
    if (!response.body) throw new Error(`下载 ${component.relativeUrl} 没有响应内容`);
    await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
    const handle = await fs.promises.open(stagingPath, 'wx', 0o644);
    const hash = crypto.createHash('sha256');
    let totalBytes = 0;
    try {
        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > component.size) {
                throw new Error(`下载 ${component.relativeUrl} 超过清单声明大小`);
            }
            hash.update(buffer);
            await handle.write(buffer);
        }
        await handle.sync();
    } finally {
        await handle.close();
    }
    const actualSha256 = hash.digest('hex');
    if (totalBytes !== component.size || actualSha256 !== component.sha256) {
        throw new Error(`下载 ${component.relativeUrl} 大小或 SHA-256 校验失败`);
    }
}

async function inspectExistingArtifact(targetPath, component) {
    const stat = await fs.promises.lstat(targetPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!stat) return 'missing';
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`同步目标已有非普通文件: ${targetPath}`);
    }
    const actualSha256 = await sha256File(targetPath);
    if (stat.size === component.size && actualSha256 === component.sha256) return 'same';
    return 'conflict';
}

async function installArtifact(stagingPath, targetPath, component) {
    const state = await inspectExistingArtifact(targetPath, component);
    if (state === 'same') return false;
    if (state === 'conflict') {
        throw new Error(`同版本资源已有不同内容，拒绝覆盖: ${component.relativeUrl}`);
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    try {
        await fs.promises.link(stagingPath, targetPath);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const raceState = await inspectExistingArtifact(targetPath, component);
        if (raceState !== 'same') throw new Error(`同步目标并发冲突: ${component.relativeUrl}`);
        return false;
    }
    return true;
}

async function writeManifestLast(localRoot, manifest, syncId) {
    const target = path.join(localRoot, 'manifest.json');
    const existing = await fs.promises.lstat(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
        throw new Error(`拒绝覆盖非普通本地清单: ${target}`);
    }
    const temporary = path.join(localRoot, `manifest.json.tmp-${syncId}`);
    const handle = await fs.promises.open(temporary, 'wx', 0o644);
    try {
        await handle.writeFile(JSON.stringify(manifest, null, 2) + '\n');
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.promises.rename(temporary, target);
}

async function syncOfflineUpdate(options = {}) {
    const sourceUrl = normalizeBaseUrl(
        options.sourceUrl || process.env[SOURCE_ENV] || DEFAULT_SOURCE_URL,
        '同步源'
    );
    const localRoot = await ensureOrdinaryDirectory(
        options.localRoot || process.env[LOCAL_ROOT_ENV] || DEFAULT_LOCAL_ROOT,
        '同步目标目录'
    );
    const key = await loadOfflineUpdatePublicKey({
        publicKeyPem: options.publicKeyPem,
        publicKeyPath: options.publicKeyPath
    });
    const manifest = await readRemoteManifest(sourceUrl, options);
    verifySignedManifest(manifest, key.publicKeyPem);
    validateManifestComponents(manifest);
    const components = selectSyncComponents(manifest);
    if (components.length === 0) throw new Error('签名清单没有可同步的服务资源');

    const syncId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
    const stagingRoot = await fs.promises.mkdtemp(path.join(localRoot, `.offline-sync-${syncId}-`));
    const installed = [];
    const skipped = [];
    try {
        for (const { name, component } of components) {
            const targetPath = await resolveSafePath(localRoot, component.relativeUrl);
            const stagingPath = path.join(stagingRoot, ...component.relativeUrl.split('/'));
            await downloadArtifact(sourceUrl, component, stagingPath, options);
            const didInstall = await installArtifact(stagingPath, targetPath, component);
            (didInstall ? installed : skipped).push(name);
        }
        await writeManifestLast(localRoot, manifest, syncId);
    } finally {
        await fs.promises.rm(stagingRoot, { recursive: true, force: true });
    }

    const cleanup = await cleanupLocalPublishedArtifacts(localRoot, manifest);
    return {
        sourceUrl,
        localRoot,
        manifest,
        installed,
        skipped,
        cleanup
    };
}

function parseCliArguments(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
        if (!['source-url', 'local-root', 'public-key'].includes(key)) {
            throw new Error(`未知同步参数: --${key}`);
        }
        if (typeof value !== 'string' || value.startsWith('--')) {
            throw new Error(`参数 --${key} 缺少值`);
        }
        const fieldName = key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        if (Object.hasOwn(parsed, fieldName)) throw new Error(`参数 --${key} 不能重复`);
        parsed[fieldName] = value;
    }
    return parsed;
}

async function runCli(argv = process.argv.slice(2)) {
    try {
        const options = parseCliArguments(argv);
        const result = await syncOfflineUpdate({
            ...options,
            publicKeyPath: options.publicKey
        });
        console.log(`外网资源同步完成: ${result.sourceUrl} -> ${result.localRoot}`);
        console.log(`已安装: ${result.installed.join(', ') || '无'}；已复用: ${result.skipped.join(', ') || '无'}`);
        if (result.cleanup.errors.length > 0) {
            console.warn(`过时资源清理待重试: ${JSON.stringify(result.cleanup.errors)}`);
        }
    } catch (error) {
        console.error(`Offline 外网资源同步失败: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) runCli();

module.exports = {
    DEFAULT_SOURCE_URL,
    DEFAULT_LOCAL_ROOT,
    SYNC_COMPONENT_NAMES,
    normalizeBaseUrl,
    selectSyncComponents,
    parseCliArguments,
    syncOfflineUpdate,
    runCli,
    sha256Buffer
};
