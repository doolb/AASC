'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    validateSignedManifestEnvelope,
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
const DEFAULT_SYNC_SOURCE_ROOT = 'http://120.79.245.103/mnt/';
const DEFAULT_SYNC_LOCAL_ROOT = '/mnt';
const SOURCE_ENV = 'AASC_OFFLINE_SYNC_SOURCE';
const LOCAL_ROOT_ENV = 'AASC_OFFLINE_LOCAL_ROOT';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const SYNC_COMPONENT_NAMES = Object.freeze(['code', 'dependencies', 'apkMin', 'dataRepair']);
const MMD_SYNC_STATE_FILE = '.offline-mmd-sync-state.json';
const MAX_MMD_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_MMD_FILES = 5000;
const MAX_MMD_DIRECTORIES = 1000;
const MAX_MMD_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MMD_TOTAL_BYTES = 10 * 1024 * 1024 * 1024;

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

function formatProgressBytes(value) {
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${value} B`;
}

function createProgressDisplay(totalBytes, output = process.stderr) {
    const isInteractive = Boolean(output.isTTY);
    let previousLineLength = 0;
    let lastRenderAt = 0;
    let lastLoggedMilestone = -1;
    let currentFile = null;

    function render(receivedBytes, completedBytes, force = false) {
        if (!currentFile) return;
        const filePercent = currentFile.size === 0
            ? 100
            : Math.min(100, Math.floor((receivedBytes / currentFile.size) * 100));
        const overallBytes = Math.min(totalBytes, completedBytes + receivedBytes);
        const overallPercent = totalBytes === 0
            ? 100
            : Math.min(100, Math.floor((overallBytes / totalBytes) * 100));
        const message = `[下载进度] [${currentFile.index}/${currentFile.count}] ${currentFile.name} ` +
            `${formatProgressBytes(receivedBytes)}/${formatProgressBytes(currentFile.size)} (${filePercent}%)` +
            ` | 总进度 ${formatProgressBytes(overallBytes)}/${formatProgressBytes(totalBytes)} (${overallPercent}%)`;

        if (isInteractive) {
            const now = Date.now();
            if (!force && receivedBytes < currentFile.size && now - lastRenderAt < 200) return;
            const lineWidth = Math.max(previousLineLength, message.length);
            output.write(`\r${message.padEnd(lineWidth, ' ')}`);
            previousLineLength = lineWidth;
            lastRenderAt = now;
            return;
        }

        const milestone = Math.floor(filePercent / 10);
        if (force || filePercent === 100 || milestone > lastLoggedMilestone) {
            output.write(`${message}\n`);
            lastLoggedMilestone = milestone;
        }
    }

    return {
        reused(name, index, count, size, completedBytes) {
            const overallBytes = Math.min(totalBytes, completedBytes);
            const overallPercent = Math.min(100, Math.floor((overallBytes / totalBytes) * 100));
            output.write(
                `[已复用] [${index}/${count}] ${name} ${formatProgressBytes(size)}/${formatProgressBytes(size)} (100%)` +
                ` | 总进度 ${formatProgressBytes(overallBytes)}/${formatProgressBytes(totalBytes)} (${overallPercent}%)\n`
            );
        },
        begin(name, index, count, size, completedBytes) {
            currentFile = { name, index, count, size };
            lastLoggedMilestone = -1;
            render(0, completedBytes, true);
        },
        update(receivedBytes, completedBytes) {
            render(receivedBytes, completedBytes);
        },
        end() {
            if (isInteractive && previousLineLength > 0) output.write('\n');
            previousLineLength = 0;
            lastRenderAt = 0;
            currentFile = null;
        }
    };
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
            ...(options.requestOptions || {}),
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

function decodeHtmlAttribute(value) {
    return value
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function validateMmdRelativePath(relativePath) {
    validateRelativePath(relativePath);
    for (const segment of relativePath.split('/')) {
        if (/[\u0000-\u001f<>:"|?*]/.test(segment) || /[. ]$/.test(segment) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)) {
            throw new Error(`MMD 同步路径包含不安全文件名: ${relativePath}`);
        }
    }
    if (relativePath === MMD_SYNC_STATE_FILE || relativePath.startsWith('.mmd-sync-')) {
        throw new Error(`MMD 同步源占用了本地保留路径: ${relativePath}`);
    }
}

function parseMmdDirectoryIndex(html, directoryUrl, rootUrl) {
    const root = new URL(rootUrl);
    const rootPath = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`;
    const entries = new Map();
    for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        for (const linkMatch of rowMatch[1].matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
            const href = decodeHtmlAttribute(linkMatch[2].trim());
            if (!href || href.startsWith('?')) continue;
            let target;
            try {
                target = new URL(href, directoryUrl);
            } catch {
                continue;
            }
            if (target.origin !== root.origin || target.search || target.hash ||
                !target.pathname.startsWith(rootPath) || target.pathname === new URL(directoryUrl).pathname) {
                continue;
            }

            const isDirectory = target.pathname.endsWith('/');
            const encodedRelativePath = target.pathname.slice(rootPath.length).replace(/\/$/, '');
            if (!encodedRelativePath) continue;
            const segments = encodedRelativePath.split('/').map((segment) => {
                let decoded;
                try {
                    decoded = decodeURIComponent(segment);
                } catch {
                    throw new Error(`MMD 目录索引包含无效 URL 编码: ${href}`);
                }
                if (decoded.includes('/') || decoded.includes('\\')) {
                    throw new Error(`MMD 目录索引包含不安全路径分隔符: ${href}`);
                }
                return decoded;
            });
            const relativePath = segments.join('/');
            validateMmdRelativePath(relativePath);
            entries.set(relativePath, { relativePath, isDirectory });
        }
    }
    return [...entries.values()];
}

async function readRemoteMmdDirectoryIndex(directoryUrl, rootUrl, options = {}) {
    const response = await fetchWithTimeout(directoryUrl, {
        ...options,
        requestOptions: { redirect: 'error' }
    });
    if (!response.ok) throw new Error(`读取 MMD 目录索引失败，HTTP ${response.status}: ${directoryUrl}`);
    if (!response.body) throw new Error(`MMD 目录索引没有响应内容: ${directoryUrl}`);
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_MMD_INDEX_BYTES) {
            throw new Error(`MMD 目录索引超过大小限制: ${directoryUrl}`);
        }
        chunks.push(buffer);
    }
    return parseMmdDirectoryIndex(Buffer.concat(chunks).toString('utf8'), directoryUrl, rootUrl);
}

async function discoverMmdTree(sourceUrl, options = {}) {
    const rootUrl = normalizeBaseUrl(sourceUrl, 'MMD 同步源');
    const rootPath = new URL(rootUrl).pathname;
    const pendingDirectories = [{ relativePath: '', url: rootUrl }];
    const visited = new Set();
    const directories = new Set();
    const files = new Map();
    while (pendingDirectories.length > 0) {
        const directory = pendingDirectories.shift();
        if (visited.has(directory.url)) continue;
        visited.add(directory.url);
        if (visited.size > MAX_MMD_DIRECTORIES) throw new Error('MMD 目录数量超过同步限制');
        for (const entry of await readRemoteMmdDirectoryIndex(directory.url, rootUrl, options)) {
            const entryUrl = new URL(entry.relativePath.split('/').map(encodeURIComponent).join('/') +
                (entry.isDirectory ? '/' : ''), rootUrl).toString();
            if (entry.isDirectory) {
                directories.add(entry.relativePath);
                pendingDirectories.push({ relativePath: entry.relativePath, url: entryUrl });
                continue;
            }
            files.set(entry.relativePath, { ...entry, url: entryUrl });
            if (files.size > MAX_MMD_FILES) throw new Error('MMD 文件数量超过同步限制');
        }
    }
    return {
        rootUrl,
        rootPath,
        directories: [...directories].sort((left, right) => left.split('/').length - right.split('/').length),
        files: [...files.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    };
}

async function readRemoteMmdFileMetadata(file, options = {}) {
    const response = await fetchWithTimeout(file.url, {
        ...options,
        requestOptions: { method: 'HEAD', redirect: 'error' }
    });
    if (!response.ok) throw new Error(`读取 MMD 文件元数据失败，HTTP ${response.status}: ${file.relativePath}`);
    const sizeText = response.headers.get('content-length');
    if (!sizeText || !/^\d+$/.test(sizeText)) {
        throw new Error(`MMD 文件缺少有效 Content-Length: ${file.relativePath}`);
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > MAX_MMD_FILE_BYTES) {
        throw new Error(`MMD 文件大小超过同步限制: ${file.relativePath}`);
    }
    return {
        size,
        etag: response.headers.get('etag') || '',
        lastModified: response.headers.get('last-modified') || ''
    };
}

async function readMmdSyncState(localRoot) {
    const statePath = path.join(localRoot, MMD_SYNC_STATE_FILE);
    const stat = await fs.promises.lstat(statePath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!stat) return { schemaVersion: 1, files: {} };
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`MMD 同步状态必须是普通文件: ${statePath}`);
    }
    if (stat.size > MAX_MANIFEST_BYTES) throw new Error('MMD 同步状态文件超过大小限制');
    let state;
    try {
        state = JSON.parse(await fs.promises.readFile(statePath, 'utf8'));
    } catch (error) {
        throw new Error(`读取 MMD 同步状态失败: ${error.message}`, { cause: error });
    }
    if (state?.schemaVersion !== 1 || !state.files || typeof state.files !== 'object' ||
        Array.isArray(state.files)) {
        throw new Error('MMD 同步状态格式无效');
    }
    return state;
}

async function writeMmdSyncState(localRoot, state, syncId) {
    const statePath = path.join(localRoot, MMD_SYNC_STATE_FILE);
    const existing = await fs.promises.lstat(statePath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
        throw new Error(`拒绝覆盖非普通 MMD 同步状态文件: ${statePath}`);
    }
    const temporaryPath = path.join(localRoot, `${MMD_SYNC_STATE_FILE}.tmp-${syncId}`);
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o644);
    try {
        await handle.writeFile(JSON.stringify(state, null, 2) + '\n');
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.promises.rename(temporaryPath, statePath);
}

async function inspectExistingMmdFile(targetPath, metadata, previousState) {
    const stat = await fs.promises.lstat(targetPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!stat) return false;
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`MMD 同步目标已有非普通文件: ${targetPath}`);
    }
    if (stat.size !== metadata.size || !previousState ||
        previousState.size !== metadata.size || previousState.etag !== metadata.etag ||
        previousState.lastModified !== metadata.lastModified ||
        !/^[a-f0-9]{64}$/i.test(previousState.sha256 || '') ||
        (!metadata.etag && !metadata.lastModified)) {
        return false;
    }
    return (await sha256File(targetPath)) === previousState.sha256;
}

async function downloadMmdFile(file, metadata, stagingPath, options = {}, onProgress) {
    const response = await fetchWithTimeout(file.url, {
        ...options,
        requestOptions: { redirect: 'error' }
    });
    if (!response.ok) throw new Error(`下载 MMD 文件失败，HTTP ${response.status}: ${file.relativePath}`);
    if (!response.body) throw new Error(`MMD 文件没有响应内容: ${file.relativePath}`);
    const responseSize = response.headers.get('content-length');
    if (responseSize && Number(responseSize) !== metadata.size) {
        throw new Error(`MMD 文件在 HEAD 与 GET 之间发生变化: ${file.relativePath}`);
    }
    for (const [headerName, metadataValue] of [
        ['etag', metadata.etag],
        ['last-modified', metadata.lastModified]
    ]) {
        const responseValue = response.headers.get(headerName) || '';
        if (metadataValue && responseValue && metadataValue !== responseValue) {
            throw new Error(`MMD 文件在 HEAD 与 GET 之间发生变化: ${file.relativePath}`);
        }
    }
    await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
    const handle = await fs.promises.open(stagingPath, 'wx', 0o644);
    const hash = crypto.createHash('sha256');
    let totalBytes = 0;
    try {
        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > metadata.size) throw new Error(`MMD 文件超过 HEAD 声明大小: ${file.relativePath}`);
            hash.update(buffer);
            await handle.write(buffer);
            onProgress?.(totalBytes);
        }
        await handle.sync();
    } finally {
        await handle.close();
    }
    if (totalBytes !== metadata.size) throw new Error(`MMD 文件长度校验失败: ${file.relativePath}`);
    return hash.digest('hex');
}

async function installMirroredMmdFile(stagingPath, targetPath) {
    const existing = await fs.promises.lstat(targetPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
        throw new Error(`拒绝替换非普通 MMD 同步目标: ${targetPath}`);
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.rename(stagingPath, targetPath);
}

async function syncMmdDirectory(sourceUrl, localRoot, options = {}) {
    const tree = await discoverMmdTree(sourceUrl, options);
    const targetRoot = await ensureOrdinaryDirectory(localRoot, 'MMD 同步目标目录');
    for (const relativeDirectory of tree.directories) {
        const targetDirectory = await resolveSafePath(targetRoot, relativeDirectory);
        await ensureOrdinaryDirectory(targetDirectory, 'MMD 子目录');
    }

    const files = [];
    let totalBytes = 0;
    for (const file of tree.files) {
        const metadata = await readRemoteMmdFileMetadata(file, options);
        totalBytes += metadata.size;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_MMD_TOTAL_BYTES) {
            throw new Error('MMD 目录总大小超过同步限制');
        }
        files.push({ ...file, metadata });
    }

    const state = await readMmdSyncState(targetRoot);
    const syncId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
    const stagingRoot = await fs.promises.mkdtemp(path.join(targetRoot, `.mmd-sync-${syncId}-`));
    const progressDisplay = createProgressDisplay(totalBytes);
    const installed = [];
    const skipped = [];
    let completedBytes = 0;
    try {
        for (const [index, file] of files.entries()) {
            const targetPath = await resolveSafePath(targetRoot, file.relativePath);
            const existingState = state.files[file.relativePath];
            if (await inspectExistingMmdFile(targetPath, file.metadata, existingState)) {
                completedBytes += file.metadata.size;
                skipped.push(file.relativePath);
                progressDisplay.reused(
                    file.relativePath,
                    index + 1,
                    files.length,
                    file.metadata.size,
                    completedBytes
                );
                continue;
            }

            const stagingPath = path.join(stagingRoot, ...file.relativePath.split('/'));
            progressDisplay.begin(
                file.relativePath,
                index + 1,
                files.length,
                file.metadata.size,
                completedBytes
            );
            let sha256;
            try {
                sha256 = await downloadMmdFile(file, file.metadata, stagingPath, options, (receivedBytes) => {
                    progressDisplay.update(receivedBytes, completedBytes);
                });
            } finally {
                progressDisplay.end();
            }
            await installMirroredMmdFile(stagingPath, targetPath);
            state.files[file.relativePath] = {
                size: file.metadata.size,
                etag: file.metadata.etag,
                lastModified: file.metadata.lastModified,
                sha256
            };
            await writeMmdSyncState(targetRoot, state, syncId);
            installed.push(file.relativePath);
            completedBytes += file.metadata.size;
        }
    } finally {
        await fs.promises.rm(stagingRoot, { recursive: true, force: true });
    }
    return { sourceUrl: tree.rootUrl, localRoot: targetRoot, installed, skipped, totalBytes };
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

async function downloadArtifact(sourceUrl, component, stagingPath, options = {}, onProgress) {
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
            onProgress?.(totalBytes);
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
    const skipSignatureVerification = options.skipSignatureVerification === true;
    const key = skipSignatureVerification
        ? null
        : await loadOfflineUpdatePublicKey({
            publicKeyPem: options.publicKeyPem,
            publicKeyPath: options.publicKeyPath
        });
    const manifest = await readRemoteManifest(sourceUrl, options);
    validateSignedManifestEnvelope(manifest);
    if (!skipSignatureVerification) verifySignedManifest(manifest, key.publicKeyPem);
    validateManifestComponents(manifest);
    const components = selectSyncComponents(manifest);
    if (components.length === 0) throw new Error('清单没有可同步的服务资源');

    const componentPlan = [];
    for (const [index, { name, component }] of components.entries()) {
        const targetPath = await resolveSafePath(localRoot, component.relativeUrl);
        const existingState = await inspectExistingArtifact(targetPath, component);
        if (existingState === 'conflict') {
            throw new Error(`同版本资源已有不同内容，拒绝覆盖: ${component.relativeUrl}`);
        }
        componentPlan.push({ name, component, targetPath, existingState, index: index + 1 });
    }

    const syncId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
    const stagingRoot = await fs.promises.mkdtemp(path.join(localRoot, `.offline-sync-${syncId}-`));
    const installed = [];
    const skipped = [];
    const totalSyncBytes = componentPlan.reduce((total, { component }) => total + component.size, 0);
    const progressDisplay = createProgressDisplay(totalSyncBytes);
    let completedSyncBytes = 0;
    try {
        for (const { name, component, targetPath, existingState, index } of componentPlan) {
            if (existingState === 'same') {
                completedSyncBytes += component.size;
                skipped.push(name);
                progressDisplay.reused(
                    component.relativeUrl,
                    index,
                    componentPlan.length,
                    component.size,
                    completedSyncBytes
                );
                continue;
            }

            const stagingPath = path.join(stagingRoot, ...component.relativeUrl.split('/'));
            progressDisplay.begin(
                component.relativeUrl,
                index,
                componentPlan.length,
                component.size,
                completedSyncBytes
            );
            try {
                await downloadArtifact(sourceUrl, component, stagingPath, options, (receivedBytes) => {
                    progressDisplay.update(receivedBytes, completedSyncBytes);
                });
            } finally {
                progressDisplay.end();
            }
            const didInstall = await installArtifact(stagingPath, targetPath, component);
            (didInstall ? installed : skipped).push(name);
            completedSyncBytes += component.size;
        }
        await writeManifestLast(localRoot, manifest, syncId);
    } finally {
        await fs.promises.rm(stagingRoot, { recursive: true, force: true });
    }

    const cleanup = await cleanupLocalPublishedArtifacts(localRoot, manifest);
    const mmd = options.mmdSourceUrl && options.mmdLocalRoot
        ? await syncMmdDirectory(options.mmdSourceUrl, options.mmdLocalRoot, options)
        : null;
    return {
        sourceUrl,
        localRoot,
        sourceRoot: options.sourceRoot || null,
        localParentRoot: options.localParentRoot || null,
        manifest,
        signatureVerificationSkipped: skipSignatureVerification,
        installed,
        skipped,
        cleanup,
        mmd
    };
}

function resolveCliSyncRoots(options = {}) {
    const configuredSource = options.sourceUrl || process.env[SOURCE_ENV] || DEFAULT_SYNC_SOURCE_ROOT;
    const sourceRoot = normalizeBaseUrl(configuredSource, '同步源');
    const configuredLocal = options.localRoot || process.env[LOCAL_ROOT_ENV];
    const pathname = new URL(sourceRoot).pathname.replace(/\/+$/, '').toLowerCase();
    if (pathname.endsWith('/aasc-offline')) {
        return {
            sourceUrl: sourceRoot,
            localRoot: configuredLocal || DEFAULT_LOCAL_ROOT,
            sourceRoot,
            localParentRoot: configuredLocal || DEFAULT_LOCAL_ROOT,
            mmdSourceUrl: null,
            mmdLocalRoot: null
        };
    }

    const localParentRoot = configuredLocal || DEFAULT_SYNC_LOCAL_ROOT;
    return {
        sourceUrl: new URL('aasc-offline/', sourceRoot).toString(),
        localRoot: path.join(localParentRoot, 'aasc-offline'),
        sourceRoot,
        localParentRoot,
        mmdSourceUrl: new URL('mmd/', sourceRoot).toString(),
        mmdLocalRoot: path.join(localParentRoot, 'mmd')
    };
}

function parseCliArguments(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        if (key === 'skip-signature-verification') {
            if (equalIndex >= 0) throw new Error(`参数 --${key} 不接受值`);
            if (Object.hasOwn(parsed, 'skipSignatureVerification')) {
                throw new Error(`参数 --${key} 不能重复`);
            }
            parsed.skipSignatureVerification = true;
            continue;
        }
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
        const syncRoots = resolveCliSyncRoots(options);
        if (options.skipSignatureVerification) {
            console.warn('警告：已跳过清单 RSA 验签；清单来源未经认证，大小和 SHA-256 仅校验下载内容是否与该清单一致。Android 客户端仍会验签。');
        }
        const result = await syncOfflineUpdate({
            ...options,
            ...syncRoots,
            publicKeyPath: options.publicKey
        });
        console.log(`外网资源同步完成: ${result.sourceRoot} -> ${result.localParentRoot}`);
        console.log(`Offline 更新目录: ${result.sourceUrl} -> ${result.localRoot}`);
        console.log(`已安装: ${result.installed.join(', ') || '无'}；已复用: ${result.skipped.join(', ') || '无'}`);
        if (result.mmd) {
            console.log(`MMD 目录同步完成: ${result.mmd.sourceUrl} -> ${result.mmd.localRoot}`);
            console.log(
                `MMD 已安装 ${result.mmd.installed.length} 个文件；已复用 ${result.mmd.skipped.length} 个文件；` +
                `总大小 ${formatProgressBytes(result.mmd.totalBytes)}`
            );
        }
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
    DEFAULT_SYNC_SOURCE_ROOT,
    DEFAULT_SYNC_LOCAL_ROOT,
    SYNC_COMPONENT_NAMES,
    normalizeBaseUrl,
    selectSyncComponents,
    parseCliArguments,
    resolveCliSyncRoots,
    parseMmdDirectoryIndex,
    discoverMmdTree,
    syncMmdDirectory,
    syncOfflineUpdate,
    runCli,
    sha256Buffer
};
