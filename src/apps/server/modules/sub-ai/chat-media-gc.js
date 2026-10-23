'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const MANAGED = new RegExp(`^(${UUID})\\.(?:png|jpg|webp|gif|mp4|webm|mov|txt|md|log|csv|json|meta\\.json)$`);
const LOCAL = new RegExp(`/uploads/(chat-images|chat-videos|chat-files)/(${UUID})\\.(?:png|jpg|webp|gif|mp4|webm|mov|txt|md|log|csv|json)(?![a-zA-Z0-9.])`, 'g');

/** 历史与保留快照共同持有媒体；只枚举本应用UUID普通文件，任何读取异常均停止删除。 */
function createChatMediaGc({ uploadsDir, historyDir, backupDir = path.join(path.dirname(historyDir), 'aasc-user-backups'),
    liveHistory = () => [], now = Date.now, graceMs = 60000, intervalMs = 600000, onError = () => {} }) {
    let epoch = 0; let writers = 0; let timer; let interval; let running; let closed = false;
    const keepIds = new Map(); const pendingAssets = new Set();
    async function historyReferences(directory, refs, optional = false) {
        let stat;
        try { stat = await fs.lstat(directory); } catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('聊天媒体回收拒绝非普通历史目录');
        for (const item of await fs.readdir(directory, { withFileTypes: true })) {
            if (item.isSymbolicLink()) {
                if (/^chat-history(?:-[^/]+)?\.json$/.test(item.name) || ['userconfig.json', 'media-libraries.json'].includes(item.name)) throw new Error('历史或媒体引用配置是链接，停止回收');
                continue;
            }
            const file = path.join(directory, item.name);
            if (item.isDirectory() && !['chat2api', 'aasc-user-backups', 'chat-history-backups'].includes(item.name)) await historyReferences(file, refs);
            const isHistory = /^chat-history(?:-[^/]+)?\.json$/.test(item.name);
            if (!item.isFile() || !isHistory && !['userconfig.json', 'media-libraries.json'].includes(item.name)) continue;
            const info = await fs.lstat(file);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error('聊天历史文件无法安全扫描');
            const messages = JSON.parse(await fs.readFile(file, 'utf8'));
            if (isHistory && !Array.isArray(messages)) throw new Error('聊天历史格式异常，停止媒体回收');
            collect(messages, refs);
        }
    }
    function collect(value, refs) {
        // 包含图片、视频、封面、文本附件和旧版嵌入正文的本地URL；不猜测外部链接对应文件。
        for (const match of JSON.stringify(value).matchAll(LOCAL)) refs.add(match[2]);
    }
    async function collectFiles(refs) {
        const candidates = [];
        for (const name of ['chat-images', 'chat-videos', 'chat-files']) {
            const directory = path.join(uploadsDir, name);
            let entries;
            try { const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('受管媒体目录不能是链接'); entries = await fs.readdir(directory, { withFileTypes: true }); }
            catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            for (const entry of entries) {
                const match = entry.name.match(MANAGED);
                if (!entry.isFile() || !match) continue;
                const file = path.join(directory, entry.name); const stat = await fs.lstat(file);
                if (!stat.isFile() || stat.isSymbolicLink()) continue;
                if (entry.name.endsWith('.meta.json')) {
                    if (stat.size > 8192) throw new Error('附件租约文件异常');
                    const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
                    if (metadata.leaseUntil > now()) refs.add(match[1]);
                }
                candidates.push({ file, id: match[1], stat });
                if (candidates.length > 100000) throw new Error('媒体回收文件过多，请先检查目录');
            }
        }
        return candidates;
    }
    async function sweep() {
        if (closed || writers) return { removed: 0, deferred: true };
        const revision = epoch; const refs = new Set(); collect(liveHistory(), refs);
        await historyReferences(historyDir, refs, true);
        let backups = [];
        try { const stat = await fs.lstat(backupDir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('备份目录不能是链接'); backups = await fs.readdir(backupDir, { withFileTypes: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const backup of backups) if (/^aasc-user-previous-day-\d{4}-\d{2}-\d{2}$/.test(backup.name)) {
            if (!backup.isDirectory() || backup.isSymbolicLink()) throw new Error('保留备份不能安全读取，停止媒体回收');
            await historyReferences(path.join(backupDir, backup.name), refs);
        }
        const candidates = await collectFiles(refs); let removed = 0;
        for (const candidate of candidates) {
            if (closed || writers || revision !== epoch) return { removed, deferred: true };
            if (refs.has(candidate.id) || (keepIds.get(candidate.id) || 0) > now() || now() - candidate.stat.mtimeMs < graceMs) continue;
            const current = await fs.lstat(candidate.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
            if (!current?.isFile() || current.isSymbolicLink() || current.ino !== candidate.stat.ino || current.mtimeMs !== candidate.stat.mtimeMs) continue;
            if (writers || revision !== epoch) return { removed, deferred: true };
            await fs.unlink(candidate.file); removed++;
        }
        for (const [id, expires] of keepIds) if (expires <= now()) { keepIds.delete(id); pendingAssets.delete(id); }
        return { removed };
    }
    const run = () => {
        if (running) return running;
        running = sweep().finally(() => { running = null; }); return running;
    };
    const schedule = () => { epoch++; if (closed) return; clearTimeout(timer); timer = setTimeout(() => { void run().catch(onError); }, 2500); timer.unref?.(); };
    return { run, schedule,
        protect(asset) { if (asset?.id) { epoch++; pendingAssets.add(asset.id); keepIds.set(asset.id, now() + 86400000); } return asset; },
        historySaved() { const refs = new Set(); collect(liveHistory(), refs); for (const id of pendingAssets) if (refs.has(id)) { keepIds.delete(id); pendingAssets.delete(id); } schedule(); },
        retain(id, milliseconds = 86400000) { epoch++; keepIds.set(id, now() + milliseconds); },
        release(id) { epoch++; keepIds.delete(id); schedule(); },
        async write(operation) { writers++; epoch++; try { return await operation(); } finally { writers--; schedule(); } },
        start() { schedule(); interval = setInterval(schedule, intervalMs); interval.unref?.(); },
        async stop() { closed = true; clearTimeout(timer); clearInterval(interval); await running?.catch(onError); }
    };
}
module.exports = { createChatMediaGc };
