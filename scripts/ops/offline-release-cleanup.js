'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadOfflineUpdatePublicKey } = require('./offline-update-signing');
const { canonicalJson, verifySignedManifest, validateManifestComponents } = require('./offline-update-package');
const { validateFullApkManifest, readFullApkManifest } = require('./offline-full-apk-manifest');
const { GROUPS, TASK_DEPENDENCIES } = require('../../src/apps/server/modules/aasc/shared-update-manifest');
const { assertRemoteTarget, buildRemoteShellArguments } = require('./publish-offline-update');
const execFileAsync = promisify(execFile);

const REPORT_PATTERN = /^release-[0-9TZ]+-[0-9]+\.json$/u;
const DEPENDENCY_DIRECTORIES = new Set(['dependencies', ...GROUPS.map(group => `dependencies/${group}`),
    ...Object.values(TASK_DEPENDENCIES).map(definition => `dependencies/${definition.directory}`)]);

/** 所有删除只接受既定目录中的严格数字版本文件；种子/修复归档保持原有保留策略。 */
function managedArchive(relative) {
    if (typeof relative !== 'string' || relative !== relative.trim() || /[\\\r\n]/u.test(relative)) return false;
    const directory = path.posix.dirname(relative);
    const name = path.posix.basename(relative);
    if (directory === 'code') return /^code-v[0-9]+\.zip$/u.test(name);
    if (DEPENDENCY_DIRECTORIES.has(directory)) return /^dependencies-v[0-9]+\.zip$/u.test(name);
    if (directory === 'task-code') return /^task-code-v[0-9]+\.zip$/u.test(name);
    if (directory === 'voice-display-node') return /^voice-display-node-v[0-9]+\.zip$/u.test(name);
    if (directory === 'apk') return /^aasc-display-offline(?:-min)?-v[0-9]+\.apk$/u.test(name);
    return false;
}

function relativeBelow(root, file) {
    if (typeof file !== 'string') return null;
    const relative = path.relative(path.resolve(root), path.resolve(file)).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) return null;
    return relative;
}

/** 逐层 lstat，既不跟随链接，也不将缺失的根目录当成“未发布”的证据。 */
async function inspectPath(root, relative) {
    const resolvedRoot = path.resolve(root);
    if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..')) return { unsafe: true };
    const rootStat = await fs.lstat(resolvedRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return { unsafe: true };
    const parts = relative.split('/');
    let current = resolvedRoot;
    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!stat) return { exists: false };
        if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) return { unsafe: true };
        if (index === parts.length - 1) return { exists: true, file: current, stat, unsafe: !stat.isFile() };
    }
    return { unsafe: true };
}

async function optionalJson(root, relative) {
    const entry = await inspectPath(root, relative);
    if (entry.unsafe) throw new Error(`拒绝读取非普通文件或链接: ${relative}`);
    if (!entry.exists) return null;
    return JSON.parse(await fs.readFile(entry.file, 'utf8'));
}

function artifacts(manifest) {
    return Object.entries(manifest.payload.components).flatMap(([name, component]) =>
        name === 'taskDependencies' ? Object.values(component) : component.groups ? Object.values(component.groups)
            : component.relativeUrl ? [component] : []);
}

function publishedPaths(value, root, result = new Set()) {
    if (typeof value === 'string') {
        const relative = managedArchive(value) ? value : relativeBelow(root, value);
        if (relative && managedArchive(relative)) result.add(relative);
    }
    if (Array.isArray(value)) for (const entry of value) publishedPaths(entry, root, result);
    if (value && typeof value === 'object') for (const entry of Object.values(value)) publishedPaths(entry, root, result);
    return result;
}

async function collectFreshCleanup(plan, options = {}) {
    const root = plan.artifactRoot;
    if (path.resolve(root) === path.parse(path.resolve(root)).root) throw new Error('拒绝清理文件系统根目录');
    const rootStat = await fs.lstat(root).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!rootStat) return { reports: [], archives: [], published: [] };
    const directory = await inspectPath(root, 'releases/placeholder');
    if (directory.unsafe) throw new Error('清理报告目录包含链接或非普通目录');
    let entries;
    try { entries = await fs.readdir(path.join(root, 'releases'), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { reports: [], archives: [], published: [] }; throw error; }
    const { publicKeyPem } = options.publicKeyPem ? options : await loadOfflineUpdatePublicKey();
    const reports = [];
    const candidates = new Map();
    const knownPublished = new Set();
    const add = (relative, expected) => {
        if (relative && managedArchive(relative)) candidates.set(relative, { relativePath: relative,
            ...(expected?.sha256 ? { size: expected.size, sha256: expected.sha256 } : candidates.get(relative) || {}) });
    };
    for (const entry of entries.filter(item => item.isFile() && item.name === item.name.trim() && REPORT_PATTERN.test(item.name))) {
        const absolute = path.join(root, 'releases', entry.name);
        if (options.excludePath && path.resolve(options.excludePath) === absolute) continue;
        const report = await optionalJson(root, `releases/${entry.name}`);
        if (report?.schemaVersion !== 1 || report.plan?.projectRoot !== plan.projectRoot ||
            report.plan.artifactRoot !== root || canonicalJson(report.plan.targets) !== canonicalJson(plan.targets)) continue;
        const id = entry.name.slice(0, -5);
        if (report.id !== id) throw new Error(`旧任务报告ID与文件名不符: ${entry.name}`);
        reports.push({ relativePath: `releases/${entry.name}`, id });
        for (const file of report.files || []) {
            const relative = relativeBelow(root, file.path);
            add(relative, file);
            if (report.phase === 'published' && relative && managedArchive(relative)) knownPublished.add(relative);
        }
        for (const retained of report.freshCleanup?.retained || []) {
            add(retained.relativePath, retained);
            if (retained.published && managedArchive(retained.relativePath)) knownPublished.add(retained.relativePath);
        }
        publishedPaths(report.published, root, knownPublished);
        const versions = report.plan.versions || {};
        const positive = value => Number.isSafeInteger(value) && value > 0;
        if (positive(versions.code)) add(`code/code-v${versions.code}.zip`);
        if (positive(versions.task)) add(`task-code/task-code-v${versions.task}.zip`);
        if (positive(versions.node)) add(`voice-display-node/voice-display-node-v${versions.node}.zip`);
        if (positive(versions.min)) add(`apk/aasc-display-offline-min-v${versions.min}.apk`);
        if (positive(versions.full)) add(`apk/aasc-display-offline-v${versions.full}.apk`);
        if (positive(versions.deps)) for (const directory of DEPENDENCY_DIRECTORIES) add(`${directory}/dependencies-v${versions.deps}.zip`);
        const manifests = new Set();
        if (report.manifestPath) manifests.add(relativeBelow(root, report.manifestPath));
        if (positive(versions.code)) manifests.add(`manifests/manifest-code-v${versions.code}.json`);
        if (positive(versions.task)) manifests.add(`manifests/manifest-task-code-v${versions.task}.json`);
        if (positive(versions.min)) manifests.add(`manifests/manifest-apk-min-v${versions.min}.json`);
        const baseline = report.plan.baseline;
        if (baseline) { verifySignedManifest(baseline, publicKeyPem); validateManifestComponents(baseline); }
        const baselineUrls = new Set(baseline ? artifacts(baseline).map(item => item.relativeUrl) : []);
        for (const relative of manifests) {
            if (!relative || (!/^manifests\/manifest-(?:code|task-code|apk-min)-v[0-9]+\.json$/u.test(relative)
                && relative !== `releases/${id}-baseline.json`)) continue;
            const manifest = await optionalJson(root, relative);
            if (!manifest) continue;
            verifySignedManifest(manifest, publicKeyPem);
            validateManifestComponents(manifest);
            const named = relative.match(/^manifests\/manifest-(code|task-code|apk-min)-v([0-9]+)\.json$/u);
            if (named) {
                const component = { code: manifest.payload.components.code?.version,
                    'task-code': manifest.payload.components.taskCode?.version, 'apk-min': manifest.payload.components.apkMin?.versionCode };
                if (component[named[1]] !== Number(named[2])) throw new Error(`候选清单与版本文件名不符: ${relative}`);
            }
            for (const artifact of artifacts(manifest)) if (!baselineUrls.has(artifact.relativeUrl)) add(artifact.relativeUrl, artifact);
        }
    }
    const present = [];
    for (const candidate of candidates.values()) {
        const entry = await inspectPath(root, candidate.relativePath);
        if (entry.exists || entry.unsafe) present.push(candidate);
    }
    return { reports, archives: present.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
        published: [...knownPublished] };
}

async function protection(plan, publicKeyPem, runtime) {
    const referenced = new Set(artifacts(plan.baseline).map(item => item.relativeUrl));
    const add = manifest => {
        verifySignedManifest(manifest, publicKeyPem);
        validateManifestComponents(manifest);
        for (const item of artifacts(manifest)) referenced.add(item.relativeUrl);
    };
    try {
        const local = await optionalJson(plan.targets.localRoot, 'manifest.json');
        if (!local) throw new Error('LAN 缺少当前签名清单');
        add(local);
        const localFull = await optionalJson(plan.targets.localRoot, 'full-apk-manifest.json');
        if (localFull) referenced.add(validateFullApkManifest(localFull, publicKeyPem).relativeUrl);
        const fetchImpl = runtime.fetchImpl || globalThis.fetch;
        const response = await fetchImpl(new URL('manifest.json', plan.targets.remoteVerifyUrl),
            { signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) throw new Error(`WAN 清单 HTTP ${response.status}`);
        add(await response.json());
        const remoteFull = await readFullApkManifest(plan.targets.remoteVerifyUrl, publicKeyPem, { fetchImpl });
        if (remoteFull) referenced.add(remoteFull.payload.apkFull.relativeUrl);
        return { referenced };
    } catch (error) {
        runtime.signal?.throwIfAborted();
        return { referenced, unknown: error.message };
    }
}

async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

function shellQuote(value) { return `'${value.replace(/'/gu, `'"'"'`)}'`; }

/** HTTP 404 仍可能处于上传未切清单阶段；额外证明 WAN 实际目录也没有该文件。 */
async function remotePresence(plan, relative, runtime) {
    const remote = plan.targets.remote;
    assertRemoteTarget(remote);
    const assignment = remote.directory.startsWith('~/') ? `root="$HOME"/${shellQuote(remote.directory.slice(2))}`
        : `root=${shellQuote(remote.directory)}`;
    const checks = ['set -eu', assignment,
        'if [ -L "$root" ] || [ ! -d "$root" ]; then echo unknown; exit 0; fi'];
    const parts = relative.split('/');
    for (let index = 0; index < parts.length; index++) {
        const prefix = parts.slice(0, index + 1).join('/');
        checks.push(`target="$root"/${shellQuote(prefix)}`,
            'if [ -L "$target" ]; then echo unknown; exit 0; fi',
            'if [ ! -e "$target" ]; then echo missing; exit 0; fi');
        if (index < parts.length - 1) checks.push('if [ ! -d "$target" ]; then echo unknown; exit 0; fi');
    }
    checks.push('echo exists');
    const result = await (runtime.commandRunner || execFileAsync)('ssh', [remote.host, ...buildRemoteShellArguments(checks.join('\n'))],
        { encoding: 'utf8', timeout: 15000 });
    const answer = result.stdout.trim();
    return ['missing', 'exists'].includes(answer) ? answer : 'unknown';
}

function rebuildFiles(plan, kinds, reportId) {
    const archives = new Set();
    const metadata = new Set();
    const primary = new Set();
    const add = (archive, companion) => { archives.add(archive); primary.add(archive); if (companion) metadata.add(companion); };
    for (const kind of kinds) {
        const version = plan.versions[kind];
        if (!Number.isSafeInteger(version) || version < 1) throw new Error(`任务缺少 ${kind} 的原版本号`);
        if (kind === 'code') add(`code/code-v${version}.zip`, `manifests/manifest-code-v${version}.json`);
        if (kind === 'task') add(`task-code/task-code-v${version}.zip`, `manifests/manifest-task-code-v${version}.json`);
        if (kind === 'min') add(`apk/aasc-display-offline-min-v${version}.apk`, `manifests/manifest-apk-min-v${version}.json`);
        if (kind === 'full') {
            if (!/^release-[0-9TZ]+-[0-9]+$/u.test(reportId) || reportId !== reportId.trim()) throw new Error('任务ID无效');
            add(`apk/aasc-display-offline-v${version}.apk`, `releases/${reportId}-full-build.json`);
        }
        if (kind === 'node') {
            const companion = `voice-display-node/voice-display-node-v${version}.json`;
            add(`voice-display-node/voice-display-node-v${version}.zip`, companion);
            primary.add(companion);
        }
        if (kind === 'deps') for (const directory of DEPENDENCY_DIRECTORIES) add(`${directory}/dependencies-v${version}.zip`);
    }
    return { archives, metadata, primary };
}

async function assertUnpublishedVersions(plan, files, protectedFiles, runtime) {
    if (protectedFiles.unknown) throw new Error(`无法确认原版本未发布，停止同号重建: ${protectedFiles.unknown}`);
    const fetchImpl = runtime.fetchImpl || globalThis.fetch;
    for (const relative of files.primary) {
        runtime.signal?.throwIfAborted();
        if (protectedFiles.referenced.has(relative)) throw new Error(`原版本已发布或被引用，不能同号重建: ${relative}；请使用 --new`);
        const local = await inspectPath(plan.targets.localRoot, relative);
        if (local.unsafe || local.exists) throw new Error(`LAN 已存在原版本或无法确认，停止同号重建: ${relative}`);
        const remote = await remotePresence(plan, relative, runtime);
        if (remote !== 'missing') throw new Error(`WAN 已存在原版本或无法确认，停止同号重建: ${relative}`);
        const response = await fetchImpl(new URL(relative, plan.targets.remoteVerifyUrl),
            { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) });
        await response.body?.cancel();
        if (response.status !== 404) throw new Error(`WAN HTTP ${response.status}，停止同号重建: ${relative}`);
    }
}

async function removeMetadata(plan, relative) {
    const entry = await inspectPath(plan.artifactRoot, relative);
    if (entry.unsafe) throw new Error(`同号构建元数据不是普通文件，停止清理: ${relative}`);
    if (!entry.exists) return false;
    await fs.unlink(entry.file);
    return true;
}

async function removeUnpublished(plan, candidate, protectedFiles, runtime) {
    const relative = candidate.relativePath;
    const entry = await inspectPath(plan.artifactRoot, relative);
    if (entry.unsafe) return { retained: '路径包含链接或非普通文件' };
    if (!entry.exists) return { missing: true };
    if (protectedFiles.referenced.has(relative)) return { retained: '已发布或被当前清单引用', published: true };
    if (protectedFiles.unknown) return { retained: `无法确认发布状态: ${protectedFiles.unknown}` };
    const local = await inspectPath(plan.targets.localRoot, relative);
    if (local.unsafe || local.exists) return { retained: 'LAN 已存在或无法确认', published: !!local.exists && !local.unsafe };
    const fetchImpl = runtime.fetchImpl || globalThis.fetch;
    try {
        const remote = await remotePresence(plan, relative, runtime);
        if (remote !== 'missing') return { retained: `WAN 目录${remote === 'exists' ? '已存在' : '无法确认'}`, published: remote === 'exists' };
        const response = await fetchImpl(new URL(relative, plan.targets.remoteVerifyUrl),
            { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) });
        await response.body?.cancel();
        if (response.status !== 404) return { retained: `WAN 返回 HTTP ${response.status}`, published: response.ok };
    } catch (error) {
        runtime.signal?.throwIfAborted();
        return { retained: `WAN 状态无法确认: ${error.message}` };
    }
    if (candidate.sha256 && (entry.stat.size !== candidate.size || await hashFile(entry.file) !== candidate.sha256)) {
        return { retained: '产物与旧报告摘要不一致' };
    }
    runtime.signal?.throwIfAborted();
    const current = await inspectPath(plan.artifactRoot, relative);
    if (!current.exists) return { missing: true };
    if (current.unsafe || current.stat.ino !== entry.stat.ino || current.stat.mtimeMs !== entry.stat.mtimeMs ||
        current.stat.size !== entry.stat.size) return { retained: '清理期间文件改变' };
    await fs.unlink(current.file);
    return { removed: true };
}

async function cleanupFreshRelease(report, reportPath, save, publicKeyPem, runtime = {}) {
    runtime.signal?.throwIfAborted();
    const plan = report.plan;
    const selection = await collectFreshCleanup(plan, { excludePath: reportPath, publicKeyPem });
    const files = rebuildFiles(plan, plan.selected, report.id);
    const protectedFiles = selection.archives.length || files.primary.size ? await protection(plan, publicKeyPem, runtime) : { referenced: new Set() };
    for (const relative of selection.published) protectedFiles.referenced.add(relative);
    // 旧报告可能已在上次清理中删除；新报告保存的历史发布证据必须继续生效。
    for (const retained of report.freshCleanup?.retained || []) {
        if (retained.published && managedArchive(retained.relativePath)) protectedFiles.referenced.add(retained.relativePath);
    }
    await assertUnpublishedVersions(plan, files, protectedFiles, runtime);
    report.freshCleanup ||= { removed: [], retained: [] };
    for (const candidate of selection.archives) {
        runtime.signal?.throwIfAborted();
        const result = await removeUnpublished(plan, candidate, protectedFiles, runtime);
        if (result.retained && files.archives.has(candidate.relativePath)) {
            throw new Error(`原号重建所需半成品无法安全清理: ${candidate.relativePath}: ${result.retained}`);
        }
        if (result.removed) {
            if (!report.freshCleanup.removed.includes(candidate.relativePath)) report.freshCleanup.removed.push(candidate.relativePath);
            report.freshCleanup.retained = report.freshCleanup.retained.filter(entry => entry.relativePath !== candidate.relativePath);
        }
        if (result.retained) {
            const index = report.freshCleanup.retained.findIndex(entry => entry.relativePath === candidate.relativePath);
            const previous = index < 0 ? {} : report.freshCleanup.retained[index];
            const entry = { ...previous, ...candidate, reason: result.retained, published: !!previous.published || !!result.published };
            if (index < 0) report.freshCleanup.retained.push(entry);
            else report.freshCleanup.retained[index] = entry;
        }
        console.log(JSON.stringify({ stage: 'fresh-cleanup', file: candidate.relativePath, ...result }));
        await save(reportPath, report);
    }
    for (const relative of files.metadata) {
        runtime.signal?.throwIfAborted();
        if (await removeMetadata(plan, relative)) report.freshCleanup.removed.push(relative);
        await save(reportPath, report);
    }
    for (const old of selection.reports) {
        // 进度报告最后删除，保证元数据删除失败后还能再次识别并补齐清理。
        for (const relative of [`releases/${old.id}-baseline.json`, `releases/${old.id}-full-build.json`, old.relativePath]) {
            runtime.signal?.throwIfAborted();
            const entry = await inspectPath(plan.artifactRoot, relative);
            if (entry.unsafe) { report.freshCleanup.retained.push({ relativePath: relative, reason: '链接或非普通文件' }); continue; }
            if (!entry.exists) continue;
            await fs.unlink(entry.file);
            report.freshCleanup.removed.push(relative);
            await save(reportPath, report);
        }
    }
    report.freshCleanup.complete = true;
    await save(reportPath, report);
}

/** 恢复只重做未完成步骤，使用原编号；已完成文件/检查点和进度报告保持。 */
async function preparePendingRebuild(report, reportPath, save, publicKeyPem, runtime = {}) {
    const plan = report.plan;
    const kinds = plan.selected.filter(kind => !report.completed.includes(kind));
    if (!kinds.length) return;
    const files = rebuildFiles(plan, kinds, report.id);
    const protectedFiles = await protection(plan, publicKeyPem, runtime);
    publishedPaths(report.published, plan.artifactRoot, protectedFiles.referenced);
    await assertUnpublishedVersions(plan, files, protectedFiles, runtime);
    const checkpoint = relativeBelow(plan.artifactRoot, report.manifestPath);
    if (files.metadata.has(checkpoint)) throw new Error('报告检查点与未完成步骤冲突，请用 --fresh 原号重建');
    const expected = new Map(report.files.map(file => [relativeBelow(plan.artifactRoot, file.path), file]));
    report.files = report.files.filter(file => {
        const relative = relativeBelow(plan.artifactRoot, file.path);
        return !files.archives.has(relative) && !files.metadata.has(relative);
    });
    if (kinds.includes('full')) delete report.full;
    await save(reportPath, report);
    for (const relative of files.archives) {
        runtime.signal?.throwIfAborted();
        const result = await removeUnpublished(plan, { ...expected.get(relative), relativePath: relative }, protectedFiles, runtime);
        if (result.retained) throw new Error(`无法安全清理原号半成品: ${relative}: ${result.retained}`);
        console.log(JSON.stringify({ stage: 'resume-rebuild', file: relative, ...result }));
    }
    for (const relative of files.metadata) {
        runtime.signal?.throwIfAborted();
        await removeMetadata(plan, relative);
    }
}

module.exports = { managedArchive, collectFreshCleanup, cleanupFreshRelease, preparePendingRebuild };
