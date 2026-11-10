'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { verifySignedManifest, validateManifestComponents } = require('./offline-update-package');
const { managedArchive, inspectPath, relativeBelow, artifacts, protection,
    DEPENDENCY_DIRECTORIES, REPORT_PATTERN } = require('./offline-release-cleanup');

const DIRECTORIES = ['code', 'task-code', ...DEPENDENCY_DIRECTORIES, 'apk'];

// 每个目录按包类型保留最高版本，防止误删比当前发布更新的未知构建。
function archiveKind(relative) {
    if (!managedArchive(relative) || relative.startsWith('voice-display-node/')) return null;
    const match = relative.match(/^(.*?)([0-9]+)(\.zip|\.apk)$/u);
    return match ? { kind: match[1] + match[3], version: BigInt(match[2]) } : null;
}

async function protectUnfinished(root, currentReportPath, keep, publicKeyPem) {
    const releases = await inspectPath(root, 'releases/placeholder');
    if (releases.unsafe) throw new Error('出包报告目录不安全');
    let entries;
    try { entries = await fs.readdir(path.join(root, 'releases'), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
        if (!REPORT_PATTERN.test(entry.name)) continue;
        const relative = `releases/${entry.name}`;
        if (path.resolve(root, relative) === path.resolve(currentReportPath)) continue;
        const file = await inspectPath(root, relative);
        if (file.unsafe || !file.exists) throw new Error(`出包报告无法安全读取: ${relative}`);
        const report = JSON.parse(await fs.readFile(file.file, 'utf8'));
        if (report.schemaVersion !== 1 || !['building', 'built', 'publishing', 'cleanup-pending', 'published'].includes(report.phase)) {
            throw new Error(`出包报告格式或状态无效: ${relative}`);
        }
        if (report.phase === 'published') continue;
        if (report.plan?.baseline) {
            verifySignedManifest(report.plan.baseline, publicKeyPem);
            validateManifestComponents(report.plan.baseline);
            for (const item of artifacts(report.plan.baseline)) if (archiveKind(item.relativeUrl)) keep.add(item.relativeUrl);
        }
        for (const item of report.files || []) {
            const name = relativeBelow(root, item.path);
            if (name && archiveKind(name)) keep.add(name);
        }
        const versions = report.plan?.versions || {};
        for (const [kind, template] of Object.entries({ code: v => `code/code-v${v}.zip`, task: v => `task-code/task-code-v${v}.zip`,
            min: v => `apk/aasc-display-offline-min-v${v}.apk`, full: v => `apk/aasc-display-offline-v${v}.apk` })) {
            if (Number.isSafeInteger(versions[kind]) && versions[kind] > 0) keep.add(template(versions[kind]));
        }
        if (Number.isSafeInteger(versions.deps) && versions.deps > 0) {
            for (const directory of DEPENDENCY_DIRECTORIES) keep.add(`${directory}/dependencies-v${versions.deps}.zip`);
        }
        // 未完成任务的候选清单可能引用复用的旧依赖，必须一起保护。
        const manifestPath = report.manifestPath && relativeBelow(root, report.manifestPath);
        if (report.manifestPath && !manifestPath) throw new Error(`候选清单不在出包目录: ${relative}`);
        if (manifestPath) {
            const candidate = await inspectPath(root, manifestPath);
            if (candidate.unsafe) throw new Error(`候选清单路径不安全: ${manifestPath}`);
            if (!candidate.exists) throw new Error(`未完成任务候选清单不存在: ${manifestPath}`);
            if (candidate.exists) {
                const manifest = JSON.parse(await fs.readFile(candidate.file, 'utf8'));
                verifySignedManifest(manifest, publicKeyPem);
                validateManifestComponents(manifest);
                for (const item of artifacts(manifest)) if (archiveKind(item.relativeUrl)) keep.add(item.relativeUrl);
            }
        }
    }
}

async function cleanupOutputArtifacts(report, reportPath, manifest, publicKeyPem, runtime = {}) {
    const root = path.resolve(report.plan.artifactRoot);
    if (root === path.parse(root).root) throw new Error('拒绝清理文件系统根目录');
    const protectedFiles = await protection({ ...report.plan, baseline: manifest }, publicKeyPem, runtime);
    if (protectedFiles.unknown) throw new Error(`无法确认发布清单，停止出包目录清理: ${protectedFiles.unknown}`);
    const keep = protectedFiles.referenced;
    for (const item of report.files || []) {
        const relative = relativeBelow(root, item.path);
        if (relative && archiveKind(relative)) keep.add(relative);
    }
    await protectUnfinished(root, reportPath, keep, publicKeyPem);
    const candidates = [];
    const newest = new Map();
    for (const directory of DIRECTORIES) {
        runtime.signal?.throwIfAborted();
        const check = await inspectPath(root, `${directory}/placeholder`);
        if (check.unsafe) throw new Error(`清理目录不安全: ${directory}`);
        let entries;
        try { entries = await fs.readdir(path.join(root, directory), { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink()) continue;
            const relative = `${directory}/${entry.name}`;
            const parsed = archiveKind(relative);
            if (!parsed) continue;
            candidates.push({ relative, ...parsed });
            if (!newest.has(parsed.kind) || newest.get(parsed.kind).version < parsed.version) newest.set(parsed.kind, { relative, ...parsed });
        }
    }
    for (const value of newest.values()) keep.add(value.relative);
    const removed = [];
    for (const candidate of candidates) {
        if (keep.has(candidate.relative)) continue;
        runtime.signal?.throwIfAborted();
        const first = await inspectPath(root, candidate.relative);
        if (!first.exists || first.unsafe) continue;
        const second = await inspectPath(root, candidate.relative);
        if (!second.exists || second.unsafe || first.stat.dev !== second.stat.dev || first.stat.ino !== second.stat.ino ||
            first.stat.size !== second.stat.size || first.stat.mtimeMs !== second.stat.mtimeMs) throw new Error(`清理期间文件改变: ${candidate.relative}`);
        await fs.unlink(second.file);
        removed.push(candidate.relative);
    }
    return { removed };
}

module.exports = { archiveKind, cleanupOutputArtifacts, protectUnfinished };
