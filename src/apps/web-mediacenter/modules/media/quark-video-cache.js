'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

/** 仅将完整且大小匹配的视频发布为缓存；并发请求共享同一下载任务。 */
class QuarkVideoCache {
    constructor(directory) { this.directory = directory; this.pending = new Map(); this.queue = Promise.resolve(); }
    async prepare(identity, expectedSize, download, onProgress = null) {
        if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) throw new Error('无法确认夸克视频大小');
        if (expectedSize > 300 * 1024 * 1024) throw new Error('视频超过 300 MB 缓存上限');
        const key = crypto.createHash('sha256').update(identity).digest('hex');
        const target = path.join(this.directory, `${key}.video`);
        const subscribe = job => {
            if (typeof onProgress !== 'function') return job.promise;
            job.listeners.add(onProgress);
            try { onProgress(job.latest); } catch {}
            return job.promise.finally(() => job.listeners.delete(onProgress));
        };
        if (this.pending.has(key)) return subscribe(this.pending.get(key));
        const job = { listeners: new Set(), latest: { phase: 'queued', received: 0, total: expectedSize }, promise: null };
        const emit = (phase, received) => {
            job.latest = { phase, received, total: expectedSize };
            for (const callback of job.listeners) { try { callback(job.latest); } catch {} }
        };
        job.promise = this.queue.catch(() => {}).then(async () => {
            await fs.promises.mkdir(this.directory, { recursive: true });
            const stat = await fs.promises.lstat(target).catch(() => null);
            if (stat?.isFile() && stat.size === expectedSize) { const now = new Date(); await fs.promises.utimes(target, now, now); emit('ready', expectedSize); return target; }
            const cached = [];
            for (const entry of await fs.promises.readdir(this.directory, { withFileTypes: true })) {
                if (!entry.isFile()) continue;
                const file = path.join(this.directory, entry.name);
                if (/^[a-f0-9]{64}\.[a-f0-9-]{36}\.part$/.test(entry.name)) await fs.promises.unlink(file);
                else if (/^[a-f0-9]{64}\.video$/.test(entry.name)) {
                    const item = await fs.promises.stat(file);
                    cached.push({ file, mtime: item.mtimeMs });
                }
            }
            cached.sort((a, b) => a.mtime - b.mtime);
            while (cached.length >= 2) await fs.promises.unlink(cached.shift().file);
            const part = path.join(this.directory, `${key}.${crypto.randomUUID()}.part`);
            try {
                if (typeof fs.promises.statfs === 'function') {
                    const volume = await fs.promises.statfs(this.directory);
                    if (volume.bavail * volume.bsize < expectedSize + 64 * 1024 * 1024) throw new Error('服务器缓存空间不足');
                }
                emit('downloading', 0);
                const stream = await download();
                let received = 0;
                let lastReport = 0;
                const meter = new Transform({ transform(chunk, encoding, callback) {
                    received += chunk.length;
                    if (Date.now() - lastReport >= 500) { lastReport = Date.now(); emit('downloading', received); }
                    callback(null, chunk);
                } });
                await pipeline(stream, meter, fs.createWriteStream(part, { flags: 'wx', mode: 0o600 }));
                if ((await fs.promises.stat(part)).size !== expectedSize) throw new Error('夸克视频缓存不完整');
                await fs.promises.rename(part, target);
                emit('ready', expectedSize);
                return target;
            } catch (error) {
                await fs.promises.unlink(part).catch(() => {});
                throw error;
            }
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, job);
        this.queue = job.promise;
        return subscribe(job);
    }

}
module.exports = { QuarkVideoCache };
