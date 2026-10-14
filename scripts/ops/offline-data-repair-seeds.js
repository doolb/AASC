'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { snapshotFiles, restoreSnapshots, writeJsonAtomically, sha256Buffer, normalizeState } = require('../../src/apps/server/modules/data-repair/data-repair-js-runner');
const { FORMAT, BASELINE_FILE, readBaseline, verifyBaselineFiles } = require('../../src/apps/server/modules/data-repair/data-repair-baseline');
const execute = promisify(execFile);
const JOURNAL = '.data-repair-seed-transaction.json';

// 发行输入的多文件提交保留撤销日志；进程中断后下一次构建先恢复，不能把半套配置当成新基线。
async function recoverReleaseTransaction(projectRoot, outputDir) {
    const releaseRoot = path.resolve(projectRoot, 'release');
    const journal = path.join(releaseRoot, JOURNAL);
    const stat = await fs.lstat(journal).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!stat) return false;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error('release修复事务日志无效');
    const value = JSON.parse(await fs.readFile(journal, 'utf8'));
    if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.pid) || !Array.isArray(value.snapshots)) throw new Error('release修复事务格式无效');
    try { process.kill(value.pid, 0); throw new Error('另一个release修复事务仍在运行'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    const snapshots = value.snapshots.map(item => {
        const filePath = path.resolve(item.filePath);
        const relative = path.relative(releaseRoot, filePath).split(path.sep).join('/');
        const outputRelative = outputDir ? path.relative(path.resolve(outputDir), filePath).split(path.sep).join('/') : '';
        const seed = /^(?:config|userconfig)\/.+\.json$/u.test(relative) && !relative.split('/').includes('..');
        const artifact = /^(?:data\/data-repair-v[0-9]+\.zip|node-min-seeds\/node-min-seeds-v[0-9]+\.zip|manifests\/manifest-data-repair-v[0-9]+\.json)$/u.test(outputRelative);
        if ((!seed && !artifact) || typeof item.exists !== 'boolean' || typeof item.content !== 'string') throw new Error('release恢复目标不在当前事务范围');
        return { filePath, exists: item.exists, mode: Number.isSafeInteger(item.mode) && item.mode >= 0 && item.mode <= 0o777 ? item.mode : 0o600,
            content: item.exists ? Buffer.from(item.content, 'base64') : null };
    });
    for (const snapshot of snapshots) {
        let parent = path.dirname(snapshot.filePath);
        while (parent !== path.dirname(parent)) {
            const entry = await fs.lstat(parent).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
            if (entry?.isSymbolicLink()) throw new Error('release恢复目标父目录不能是链接');
            parent = path.dirname(parent);
        }
    }
    await restoreSnapshots(snapshots); await fs.rm(journal);
    return true;
}

async function listSeedFiles(root) {
    const files = [];
    async function visit(directory, relative = '') {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('release 配置目录必须是普通目录');
        for (const name of (await fs.readdir(directory)).sort()) {
            const file = path.join(directory, name); const child = path.posix.join(relative, name);
            const entry = await fs.lstat(file);
            if (entry.isSymbolicLink()) throw new Error('release 配置不能包含链接');
            if (entry.isDirectory()) await visit(file, child);
            else {
                if (!entry.isFile() || !name.endsWith('.json') || entry.size > 4 * 1024 * 1024) throw new Error('release 配置文件类型或大小无效');
                files.push(child);
                if (files.length > 256) throw new Error('release 配置文件过多');
            }
        }
    }
    await visit(root);
    return files;
}

async function prepareReleaseRepairs({ projectRoot, repairs, worker = execute, outputDir }) {
    await recoverReleaseTransaction(projectRoot, outputDir);
    const releaseRoot = path.resolve(projectRoot, 'release');
    const baseline = await readBaseline(releaseRoot);
    if (baseline) await verifyBaselineFiles(releaseRoot, baseline);
    for (const repair of repairs) {
        const existing = baseline?.includedRepairs.find(item => item.repairId === repair.metadata.repairId);
        if (existing && (existing.repairVersion !== repair.metadata.repairVersion || existing.scriptSha256 !== repair.metadata.scriptSha256
            || existing.targetDataVersion !== repair.metadata.targetDataVersion)) throw new Error('新的修复必须使用新的repairId');
    }
    const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-repair-seeds-'));
    const stagedRelease = path.join(workRoot, 'release');
    const sourceFiles = [];
    let disposed = false;
    try {
        for (const directory of ['config', 'userconfig']) {
            const source = path.join(releaseRoot, directory);
            for (const relative of await listSeedFiles(source)) sourceFiles.push(`${directory}/${relative}`);
            await fs.cp(source, path.join(stagedRelease, directory), { recursive: true, errorOnExist: true });
        }
        await fs.mkdir(path.join(stagedRelease, 'task'));
        const snapshots = await snapshotFiles(sourceFiles.map(file => path.join(releaseRoot, file)));
        for (const snapshot of snapshots) {
            const relative = path.relative(releaseRoot, snapshot.filePath);
            if (!(await fs.readFile(path.join(stagedRelease, relative))).equals(snapshot.content)) {
                throw new Error('release 配置在复制期间发生变化');
            }
        }
        await writeJsonAtomically(path.join(workRoot, 'data-repair/state.json'), normalizeState(baseline));
        const request = path.join(workRoot, 'request.json');
        await writeJsonAtomically(request, { repairs });
        await worker(process.execPath, [path.join(__dirname, 'offline-data-repair-seed-worker.js'), request], {
            env: { ...process.env, AASC_PROJECT_ROOT: workRoot, AASC_RELEASE_MODE: '1' }, timeout: 60_000, maxBuffer: 64 * 1024
        });
        const state = normalizeState(JSON.parse(await fs.readFile(path.join(workRoot, 'data-repair/state.json'), 'utf8')));
        const files = [];
        for (const directory of ['config', 'userconfig']) {
            for (const relative of await listSeedFiles(path.join(stagedRelease, directory))) {
                const name = `${directory}/${relative}`;
                if (name === BASELINE_FILE) continue;
                const bytes = await fs.readFile(path.join(stagedRelease, name));
                JSON.parse(bytes.toString('utf8'));
                files.push({ path: name, size: bytes.length, sha256: sha256Buffer(bytes) });
            }
        }
        const next = { format: FORMAT, schemaVersion: 1, dataVersion: state.dataVersion,
            latestRepairVersion: state.latestRepairVersion,
            includedRepairs: [...(state.includedRepairs || []), ...state.appliedRepairs], files };
        await writeJsonAtomically(path.join(stagedRelease, BASELINE_FILE), next);
        await verifyBaselineFiles(stagedRelease, next);
        const dispose = async () => { if (!disposed) { disposed = true; await fs.rm(workRoot, { recursive: true, force: true }); } };
        return {
            releaseRoot: stagedRelease, baseline: next, dispose,
            async commit(extraFiles = [], beforeCommit, afterWrite) {
                await beforeCommit?.();
                // 多文件更新只改已暂存的配置；并发写入会拒绝提交。异常恢复全部旧内容。
                for (const snapshot of snapshots) {
                    const bytes = await fs.readFile(snapshot.filePath);
                    if (!bytes.equals(snapshot.content)) throw new Error('release 配置在修复期间发生变化，拒绝覆盖');
                }
                const now = [];
                for (const directory of ['config', 'userconfig']) {
                    for (const relative of await listSeedFiles(path.join(releaseRoot, directory))) now.push(`${directory}/${relative}`);
                }
                if (JSON.stringify(now) !== JSON.stringify(sourceFiles)) throw new Error('release 配置文件集合发生变化');
                const writes = [...files.map(file => ({ source: path.join(stagedRelease, file.path), destination: path.join(releaseRoot, file.path) })),
                    { source: path.join(stagedRelease, BASELINE_FILE), destination: path.join(releaseRoot, BASELINE_FILE) }, ...extraFiles];
                for (const file of writes) {
                    let parent = path.dirname(path.resolve(file.destination));
                    while (parent !== path.dirname(parent)) {
                        const stat = await fs.lstat(parent).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
                        if (stat?.isSymbolicLink()) throw new Error('release或产物提交目录不能是链接');
                        parent = path.dirname(parent);
                    }
                }
                const before = await snapshotFiles(writes.map(file => file.destination));
                const journal = path.join(releaseRoot, JOURNAL);
                await fs.writeFile(journal, JSON.stringify({ schemaVersion: 1, pid: process.pid,
                    snapshots: before.map(item => ({ ...item, content: item.content?.toString('base64') || '' })) }), { flag: 'wx', mode: 0o600 });
                let resolved = false;
                try {
                    let completed = 0;
                    for (const file of writes) {
                        await fs.mkdir(path.dirname(file.destination), { recursive: true });
                        const temporary = `${file.destination}.repair-${crypto.randomUUID()}`;
                        try { await fs.copyFile(file.source, temporary, fs.constants.COPYFILE_EXCL); await fs.rename(temporary, file.destination); }
                        finally { await fs.rm(temporary, { force: true }); }
                        await afterWrite?.(++completed);
                    }
                    resolved = true;
                } catch (error) { await restoreSnapshots(before); resolved = true; throw error; }
                finally { if (resolved) await fs.rm(journal, { force: true }); }
            }
        };
    } catch (error) { await fs.rm(workRoot, { recursive: true, force: true }); throw error; }
}

module.exports = { prepareReleaseRepairs, listSeedFiles, recoverReleaseTransaction };
