'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const feed = require('./main-server-update-feed');
const archiveTools = require('./update-archive');
const shared = require('./shared-update-manifest');
const ENTRYPOINT = 'src/apps/server/boot/server-app.js';
const RELEASE_PATTERN = /^code-[a-f0-9]{12}-[a-f0-9-]+$/;

function updateRoot(projectRoot) { return path.join(projectRoot, 'updates/subserver'); }
function activeFile(projectRoot) { return path.join(updateRoot(projectRoot), 'active-release.json'); }
function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

/** 受管目录的每一层都不能为链接，避免把更新/清理写到用户数据根之外。 */
function assertNoLinks(root, target) {
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('更新路径越界');
    let current = root;
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
        if (part) current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`更新路径含符号链接：${current}`);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${crypto.randomUUID()}`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function isOwnerAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function contextFromState(projectRoot, state) {
    if (!state) return { codeRoot: projectRoot, nodeModulesRoot: path.join(projectRoot, 'node_modules'), codeVersion: null };
    const prefix = 'updates/subserver/releases/';
    const codeDirectory = state.codeDirectory;
    const moduleDirectory = state.nodeModulesDirectory;
    const validDirectory = value => typeof value === 'string' && value.startsWith(prefix) && RELEASE_PATTERN.test(value.slice(prefix.length));
    if (!validDirectory(codeDirectory) ||
        !(moduleDirectory === 'node_modules' || (typeof moduleDirectory === 'string' &&
            moduleDirectory.endsWith('/node_modules') && validDirectory(moduleDirectory.slice(0, -13)))) ||
        typeof state.codeVersion !== 'string' || !/^[a-zA-Z0-9.+_-]{1,100}$/.test(state.codeVersion) ||
        !/^[a-f0-9]{64}$/.test(state.lockSha256) || !/^[a-f0-9]{64}$/.test(state.codeSha256)) {
        throw new Error('子服务器活动版本指针无效');
    }
    const codeRoot = path.join(projectRoot, codeDirectory);
    const nodeModulesRoot = path.join(projectRoot, moduleDirectory);
    assertNoLinks(projectRoot, codeRoot);
    assertNoLinks(projectRoot, nodeModulesRoot);
    if (!fs.existsSync(path.join(codeRoot, ENTRYPOINT)) || !fs.existsSync(path.join(nodeModulesRoot, 'express/package.json'))) {
        throw new Error('子服务器活动代码或依赖目录缺失');
    }
    return { ...state, codeRoot, nodeModulesRoot };
}

function restoreState(projectRoot, previous) {
    if (previous) { contextFromState(projectRoot, previous); writeJson(activeFile(projectRoot), previous); }
    else if (fs.existsSync(activeFile(projectRoot))) fs.unlinkSync(activeFile(projectRoot));
}

/** 更新所有者意外退出后先回到上一健康版本；仍活着的一次性bootstrap允许健康启动。 */
function readStartupContext(projectRoot) {
    assertNoLinks(projectRoot, updateRoot(projectRoot));
    let state = readJson(activeFile(projectRoot));
    if (state?.pendingHealth && !isOwnerAlive(state.ownerPid)) {
        contextFromState(projectRoot, state);
        restoreState(projectRoot, state.previous || null);
        writeJson(path.join(updateRoot(projectRoot), 'update-result.json'), {
            status: 'failed', message: '更新进程异常退出，已恢复上一健康版本', rolledBack: true, at: new Date().toISOString()
        });
        state = state.previous || null;
    }
    return contextFromState(projectRoot, state);
}

/** 对照代码包锁文件验证已安装的生产包真实版本，不能只信任可能已被旧tar流程覆盖的根锁文件。 */
function dependenciesMatch(nodeModulesRoot, lock) {
    const packages = lock?.packages;
    if (!packages || !packages['']?.dependencies?.express) return false;
    try {
        for (const [relative, expected] of Object.entries(packages)) {
            if (!relative || expected.dev || expected.optional) continue;
            if (!relative.startsWith('node_modules/') || expected.link || !expected.version ||
                relative.split('/').some(part => part === '..' || part === '.' || !part) || relative.includes('\\')) return false;
            const manifest = readJson(path.join(nodeModulesRoot, relative.slice(13), 'package.json'));
            if (manifest?.version !== expected.version) return false;
        }
        return fs.existsSync(path.join(nodeModulesRoot, 'express/package.json'));
    } catch (_) { return false; }
}

/** 缓存只复用通过元数据与实际文件指纹校验的组；下载从主服务器获取。 */
async function prepareDependencyGroup(projectRoot, candidate, name, options, staging) {
    const entry = candidate.dependencies.groups[name];
    const groupRoot = path.join(updateRoot(projectRoot), 'dependency-groups', name);
    const destination = path.join(groupRoot, `dependencies-v${entry.version}-${entry.sha256.slice(0, 12)}`);
    assertNoLinks(projectRoot, destination);
    if (fs.existsSync(destination)) {
        assertNoLinks(projectRoot, path.join(destination, 'dependency-group.json'));
        const metadata = readJson(path.join(destination, 'dependency-group.json'));
        if (metadata?.group === name && metadata.version === entry.version && metadata.contentSha256 === entry.contentSha256 &&
            shared.canonicalJson(metadata.target) === shared.canonicalJson(entry.target) &&
            await archiveTools.contentHash(path.join(destination, 'node_modules')) === entry.contentSha256) return destination;
        throw new Error(`缓存依赖组${name}已损坏，未停止旧服务`);
    }
    const downloaded = path.join(staging, `${name}.zip`);
    await feed.downloadDependency(candidate, name, downloaded, options);
    const layer = path.join(staging, `layer-${name}`);
    await archiveTools.extractZip(downloaded, layer, 'dependencies');
    const metadata = readJson(path.join(layer, 'dependency-group.json'));
    if (metadata?.group !== name || metadata.version !== entry.version || metadata.contentSha256 !== entry.contentSha256 ||
        shared.canonicalJson(metadata.target) !== shared.canonicalJson(entry.target) ||
        await archiveTools.contentHash(path.join(layer, 'node_modules')) !== entry.contentSha256) throw new Error(`依赖组${name}内容/元数据校验失败`);
    await fs.promises.mkdir(groupRoot, { recursive: true, mode: 0o700 });
    await fs.promises.rename(layer, destination);
    await fs.promises.unlink(downloaded);
    return destination;
}

function acquireLock(projectRoot) {
    const lock = path.join(updateRoot(projectRoot), 'lock');
    assertNoLinks(projectRoot, lock);
    fs.mkdirSync(updateRoot(projectRoot), { recursive: true, mode: 0o700 });
    if (fs.existsSync(lock)) {
        const owner = readJson(path.join(lock, 'owner.json'));
        if (!owner || isOwnerAlive(owner.pid)) throw new Error('子服务器更新已在执行');
        // 只回收由更新器创建的固定owner文件；任何额外内容都不递归删除。
        fs.unlinkSync(path.join(lock, 'owner.json'));
        fs.rmdirSync(lock);
    }
    fs.mkdirSync(lock, { mode: 0o700 });
    writeJson(path.join(lock, 'owner.json'), { pid: process.pid });
    return () => { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); };
}

function canonicalPath(value) {
    const resolved = path.resolve(value || '');
    try { return fs.realpathSync(resolved); } catch (_) { return resolved; }
}

async function waitForHealth(context, options) {
    const url = new URL(options.healthUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
        throw new Error('健康检查必须指向本节点loopback地址');
    }
    const deadline = Date.now() + (options.healthTimeoutMs || 120000);
    do {
        if (options.isRunning && !options.isRunning()) return false;
        try {
            const result = await feed.requestJson(new URL('/api/status', url).href, true);
            const versions = result.versions;
            if (versions?.code === context.codeVersion &&
                canonicalPath(versions.codePath) === canonicalPath(context.codeRoot) &&
                canonicalPath(versions.dependenciesPath) === canonicalPath(context.nodeModulesRoot)) return true;
        } catch (_) { /* 本机尚在启动，有限时间内重试，不能误用主服务器的健康状态。 */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    return false;
}

/** 删除自己生成的版本目录；逐项unlink链接本身，绝不遍历链接指向的树。 */
async function removeManagedTree(directory) {
    const stat = await fs.promises.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) { await fs.promises.unlink(directory); return; }
    for (const name of await fs.promises.readdir(directory)) await removeManagedTree(path.join(directory, name));
    await fs.promises.rmdir(directory);
}

async function cleanupReleases(projectRoot, context) {
    const root = path.join(updateRoot(projectRoot), 'releases');
    assertNoLinks(projectRoot, root);
    const keep = new Set([context.codeRoot, path.dirname(context.nodeModulesRoot)]);
    for (const name of await fs.promises.readdir(root)) {
        if (!RELEASE_PATTERN.test(name)) continue;
        const directory = path.join(root, name);
        const stat = await fs.promises.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || keep.has(directory)) continue;
        const marker = path.join(directory, '.subserver-release.json');
        assertNoLinks(projectRoot, marker);
        const value = readJson(marker);
        if (value?.schemaVersion !== 1 || typeof value.codeVersion !== 'string') continue;
        await removeManagedTree(directory);
    }
}

function createMainServerSubserverUpdater(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.env.AASC_PROJECT_ROOT || process.cwd());
    const controller = options.serviceController;
    if (!controller?.stop || !controller?.start) throw new Error('子服务器更新缺少受管进程生命周期');

    async function update(request = {}) {
        let unlock;
        let staging;
        let switched = false;
        let stopped = false;
        let previous = null;
        let candidate;
        let result;
        const resultFile = path.join(updateRoot(projectRoot), 'update-result.json');
        try {
            unlock = acquireLock(projectRoot);
            const current = readStartupContext(projectRoot);
            previous = readJson(activeFile(projectRoot));
            candidate = await feed.fetchManifest({ ...options, force: request.force === true });
            if (candidate.sha256 === current.codeSha256 && candidate.dependencies.sha256 === current.dependencySha256 && request.force !== true) {
                result = { success: true, current: true, version: candidate.codeVersion, rolledBack: false };
                return result;
            }
            const releaseName = `code-${candidate.sha256.slice(0, 12)}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
            const releases = path.join(updateRoot(projectRoot), 'releases');
            assertNoLinks(projectRoot, releases);
            await fs.promises.mkdir(releases, { recursive: true, mode: 0o700 });
            staging = path.join(releases, `.staging-${crypto.randomUUID()}`);
            await fs.promises.mkdir(staging, { mode: 0o700 });
            const archive = path.join(staging, 'code.zip');
            await feed.downloadCode(candidate, archive, { ...options, force: request.force === true });
            await feed.extractCodeZip(archive, staging);
            await fs.promises.unlink(archive);
            if (await feed.hashFile(path.join(staging, 'package-lock.json')) !== candidate.lockSha256) {
                throw new Error('代码包锁文件与主服务器清单指纹不匹配');
            }
            const lock = readJson(path.join(staging, 'package-lock.json'));
            const groupDirectories = {};
            for (const name of ['common', candidate.group]) {
                groupDirectories[name] = await prepareDependencyGroup(projectRoot, candidate, name, options, staging);
                await archiveTools.mergeTree(path.join(groupDirectories[name], 'node_modules'), path.join(staging, 'node_modules'));
            }
            if (!dependenciesMatch(path.join(staging, 'node_modules'), lock)) throw new Error('分层生产依赖与代码锁文件不匹配');
            const directory = `updates/subserver/releases/${releaseName}`;
            const state = {
                schemaVersion: 1, codeVersion: candidate.codeVersion, dependencyVersion: `v${candidate.dependencies.version}`,
                codeSha256: candidate.sha256, lockSha256: candidate.lockSha256,
                dependencySha256: candidate.dependencies.sha256, dependencyGroup: candidate.group,
                dependencyGroups: Object.fromEntries(Object.entries(groupDirectories).map(([name, directory]) => [name, path.relative(projectRoot, directory).split(path.sep).join('/')])),
                codeDirectory: directory,
                nodeModulesDirectory: `${directory}/node_modules`,
                pendingHealth: true, previous, ownerPid: process.pid
            };
            writeJson(path.join(staging, '.subserver-release.json'), { schemaVersion: 1, codeVersion: state.codeVersion, sha256: state.codeSha256 });
            await fs.promises.rename(staging, path.join(projectRoot, directory));
            staging = null;
            const context = contextFromState(projectRoot, state);
            stopped = true;
            await controller.stop();
            writeJson(activeFile(projectRoot), state);
            switched = true;
            await controller.start(context);
            const healthy = options.healthCheck ? await options.healthCheck(context) : await waitForHealth(context, options);
            if (!healthy) throw new Error('新版本本节点API/实际运行版本健康检查失败');
            const committed = { ...state, pendingHealth: false, previous: null, ownerPid: null };
            writeJson(activeFile(projectRoot), committed);
            result = { success: true, version: state.codeVersion, dependencyVersion: state.dependencyVersion, rolledBack: false, forced: request.force === true };
            try { await cleanupReleases(projectRoot, context); } catch (error) { result.cleanupError = error.message; }
            return result;
        } catch (error) {
            let rolledBack = false;
            if (stopped) {
                try {
                    await controller.stop();
                    if (switched) restoreState(projectRoot, previous);
                    await controller.start(contextFromState(projectRoot, previous));
                    rolledBack = true;
                } catch (rollbackError) { error.message += `；回滚失败：${rollbackError.message}`; }
            }
            result = { success: false, version: candidate?.codeVersion || null, rolledBack, message: error.message };
            return result;
        } finally {
            if (staging) await removeManagedTree(staging).catch(() => {});
            if (unlock) {
                try {
                    writeJson(resultFile, { ...result, status: result?.success ? 'completed' : 'failed', requestId: request.requestId,
                        source: candidate?.serverUrl, at: new Date().toISOString() });
                } finally { unlock(); }
            }
        }
    }
    return { update };
}

module.exports = { ENTRYPOINT, activeFile, contextFromState, readStartupContext, dependenciesMatch,
    createMainServerSubserverUpdater, waitForHealth, writeJson, assertNoLinks };
