'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// 只允许显式标记的本机服务实例进入签名快照，不复制任务历史或运行结果。
function validateSeed(taskName, index) {
    if (!NAME.test(taskName) || !index || index.autoStartOnUpdate !== true || !Array.isArray(index.instances)) return null;
    const items = index.instances.filter(item => item && item.status === 'running');
    if (items.length !== 1) throw new Error(`任务种子须包含一个运行中实例: ${taskName}`);
    const item = items[0];
    if (item.taskName !== taskName || item.mode !== 'service' || item.target !== 'server' ||
        !['user', 'builtin'].includes(item.taskType) || !NAME.test(item.instanceId || '') ||
        (item.taskType === 'user' && !NAME.test(item.entryFile || '')) ||
        !item.params || typeof item.params !== 'object' || Array.isArray(item.params)) throw new Error(`任务种子配置无效: ${taskName}`);
    return { taskName, taskType: item.taskType, target: 'server', mode: 'service', env: item.env || 'auto',
        entryFile: item.taskType === 'user' ? item.entryFile : null, params: item.params };
}

async function collectOfflineTaskSeeds(releaseTaskRoot) {
    const result = [];
    const root = await fs.promises.lstat(releaseTaskRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!root) return result;
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('任务种子目录无效');
    for (const entry of (await fs.promises.readdir(releaseTaskRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || !NAME.test(entry.name)) continue;
        const resultsPath = path.join(releaseTaskRoot, entry.name, 'results');
        const resultsStat = await fs.promises.lstat(resultsPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!resultsStat) continue;
        if (!resultsStat.isDirectory() || resultsStat.isSymbolicLink()) throw new Error(`任务种子结果目录无效: ${entry.name}`);
        const indexPath = path.join(resultsPath, 'index.json');
        const stat = await fs.promises.lstat(indexPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!stat) continue;
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error(`任务种子索引无效: ${entry.name}`);
        const seed = validateSeed(entry.name, JSON.parse(await fs.promises.readFile(indexPath, 'utf8')));
        if (seed) result.push(seed);
    }
    return result;
}

// 标记与实例均位于任务数据目录；保留已有实例与用户删除后的选择。
async function applyOfflineTaskSeeds(manager, seeds, builtinRegistry) {
    if (!Array.isArray(seeds)) throw new Error('任务种子快照无效');
    const marker = path.join(manager.taskIO.tasksDir, '.offline-seed-autostart.json');
    let applied = {};
    try { applied = JSON.parse(await fs.promises.readFile(marker, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!applied || typeof applied !== 'object' || Array.isArray(applied)) throw new Error('任务种子迁移记录无效');
    async function saveMarker() {
        await fs.promises.mkdir(manager.taskIO.tasksDir, { recursive: true });
        const temp = `${marker}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try { await fs.promises.writeFile(temp, JSON.stringify(applied), { flag: 'wx', mode: 0o600 }); await fs.promises.rename(temp, marker); }
        finally { await fs.promises.unlink(temp).catch(() => {}); }
    }
    for (const seed of seeds) {
        try {
            const normalized = validateSeed(seed?.taskName, { autoStartOnUpdate: true, instances: [{ ...seed, status: 'running', instanceId: 'seed' }] });
            if (!normalized) throw new Error('任务种子无效');
            const name = normalized.taskName;
            if (applied[name] === true) continue;
            const existing = await manager.taskIO.getIndex(name);
            const pending = applied[name] && typeof applied[name] === 'object' ? applied[name] : null;
            const pendingEntry = pending && existing.find(item => item.instanceId === pending.instanceId);
            // 只恢复本机制留下的草稿；任何其他已有实例都由用户管理。
            if (pendingEntry && ['draft', 'created'].includes(pendingEntry.status)) {
                await manager.runInstance(name, pendingEntry.instanceId);
            } else if (!existing.length) {
                const catalog = manager.taskIO.taskCodeCatalog;
                const isBuiltin = normalized.taskType === 'builtin' && builtinRegistry?.getTask(name);
                if (!isBuiltin && !(catalog?.isManaged(name) && catalog.task(name))) continue;
                if (!isBuiltin) {
                    try { await fs.promises.access(manager.taskIO.resolveCodePath(name, normalized.entryFile)); } catch { continue; }
                }
                // 先落盘预留实例 ID；中断后只恢复这次创建的草稿，避免重复实例。
                const instanceId = pending?.instanceId || crypto.randomBytes(12).toString('hex');
                if (!NAME.test(instanceId)) throw new Error('任务种子实例标识无效');
                applied[name] = { instanceId };
                await saveMarker();
                const submitted = await manager.submit({ ...normalized, instanceId, builtinId: isBuiltin ? name : null, files: [] });
                await manager.runInstance(name, submitted.instanceId);
            }
            applied[name] = true;
            await saveMarker();
        } catch (error) {
            // 某个种子失败不阻止其他任务；保留失败状态供控制端诊断。
            console.error('[TaskManager] Offline 任务种子恢复失败:', seed?.taskName, error.message);
        }
    }
}
module.exports = { validateSeed, collectOfflineTaskSeeds, applyOfflineTaskSeeds };
