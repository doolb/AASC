'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 索引写入串行化并采用临时文件替换，失败时不改变内存中的权威记录。
class TaskMediaDownloadIndex {
    constructor({ indexPath, getTarget }) {
        this.indexPath = indexPath;
        this.getTarget = getTarget;
        this.records = [];
        this.pending = Promise.resolve();
        try {
            const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            this.records = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : []);
        } catch {}
    }
    async lookup(providerId, itemId, targetId = '') {
        for (const record of this.records.filter(r => r.providerId === providerId && r.itemId === itemId && (!targetId || r.targetId === targetId)).reverse()) {
            if (!this.getTarget) return record;
            try {
                const root = await fs.promises.realpath(this.getTarget(record.targetId).basePath);
                const files = Array.isArray(record.files) && record.files.length ? record.files : [record];
                for (const file of files) {
                    const full = await fs.promises.realpath(path.resolve(root, file.relative));
                    const rel = path.relative(root, full);
                    if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('路径越界');
                    const stat = await fs.promises.stat(full);
                    if (!stat.isFile() || stat.size !== file.size) throw new Error('文件已变化');
                }
                return record;
            } catch {}
        }
        return null;
    }
    async record(entry) {
        const op = this.pending.then(async () => {
            const item = { providerId: entry.providerId, itemId: entry.itemId, targetId: entry.targetId, relative: entry.relative, size: entry.size, ...(entry.files ? { files: entry.files } : {}), updatedAt: Date.now() };
            const records = this.records.filter(r => r.providerId !== item.providerId || r.itemId !== item.itemId || r.targetId !== item.targetId);
            records.push(item);
            await fs.promises.mkdir(path.dirname(this.indexPath), { recursive: true });
            const tmp = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
            try {
                await fs.promises.writeFile(tmp, JSON.stringify({ records }), { flag: 'wx', mode: 0o600 });
                await fs.promises.rename(tmp, this.indexPath);
                this.records = records;
            } catch (error) { await fs.promises.unlink(tmp).catch(() => {}); throw error; }
            return item;
        });
        this.pending = op.catch(() => {});
        return op;
    }
}
module.exports = { TaskMediaDownloadIndex };
