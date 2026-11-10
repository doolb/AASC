'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

// 持久目录下载独立于仅保留一个文件的播放缓存；索引只记录完整文件。
class QuarkDirectoryDownloads {
    constructor({ indexPath, getTarget, list, open, notify = () => {} }) {
        Object.assign(this, { indexPath, getTarget, list, open, notify });
        this.records = [];
        this.job = null;
        try { const data = JSON.parse(fs.readFileSync(indexPath, 'utf8')); if (Array.isArray(data.records)) this.records = data.records; } catch {}
    }
    key(source, filePath) { return JSON.stringify([source.nodeId, source.libraryId, filePath]); }
    validatePath(value) {
        if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\') || value.includes('\0')) throw new Error('目录路径无效');
        const parts = value.split('/').filter(Boolean);
        if (parts.some(p => p === '.' || p === '..')) throw new Error('目录路径无效');
        return '/' + parts.join('/');
    }
    async safeDir(root, parts) {
        const base = await fs.promises.realpath(root);
        let dir = base;
        for (const name of parts) {
            if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) throw new Error('目录名称无效');
            dir = path.join(dir, name);
            try { await fs.promises.mkdir(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            const stat = await fs.promises.lstat(dir);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('下载目录包含不安全的链接或文件');
        }
        return dir;
    }
    async persist() {
        await fs.promises.mkdir(path.dirname(this.indexPath), { recursive: true });
        const tmp = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
        try { await fs.promises.writeFile(tmp, JSON.stringify({ records: this.records }), { mode: 0o600 }); await fs.promises.rename(tmp, this.indexPath); }
        catch (e) { await fs.promises.unlink(tmp).catch(() => {}); throw e; }
    }
    async lookup(source, filePath, targetId) {
        const key = this.key(source, this.validatePath(filePath));
        for (const record of this.records.filter(r => r.key === key && (!targetId || r.targetId === targetId)).reverse()) {
            try {
                const root = await fs.promises.realpath(this.getTarget(record.targetId).basePath);
                const full = await fs.promises.realpath(path.resolve(root, record.relative));
                if (!full.startsWith(root + path.sep)) continue;
                const st = await fs.promises.stat(full);
                if (st.isFile() && st.size === record.size) return { ...record, full };
            } catch {}
        }
        return null;
    }
    // 目录完成记录与单文件记录分开查询：整目录完成才显示“已下载”。
    async lookupDirectory(source, dirPath, targetId) {
        const key = this.key(source, this.validatePath(dirPath));
        return this.records.find(record => record.key === key && record.directory === true && (!targetId || record.targetId === targetId)) || null;
    }
    // 统计目录下已登记的文件数，用于文件夹“已下载 N”提示；不把未完成目录标记为已下载。
    countDirectory(source, dirPath, targetId) {
        const dir = this.validatePath(dirPath);
        const prefix = dir === '/' ? '/' : `${dir}/`;
        const paths = new Set();
        for (const record of this.records) {
            if (record.directory === true) continue;
            if (record.source?.nodeId !== source.nodeId || record.source?.libraryId !== source.libraryId) continue;
            if (targetId && record.targetId !== targetId) continue;
            if (typeof record.filePath !== 'string' || !record.filePath.startsWith(prefix)) continue;
            paths.add(record.filePath);
        }
        return paths.size;
    }
    start(source, dirPath, targetId) {
        if (this.job?.status === 'running') throw new Error('已有目录正在下载，请稍后再试');
        if (!source?.nodeId || !source?.libraryId || !targetId) throw new Error('请选择来源和目标媒体库');
        const dir = this.validatePath(dirPath);
        this.getTarget(targetId, true);
        this.job = { id: crypto.randomUUID(), status: 'running', source, dirPath: dir, targetId, completed: 0, skipped: 0, received: 0, total: 0, fileName: '' };
        const job = this.job;
        void this.run(job).catch(error => { job.status = 'error'; job.message = error.message || '目录下载失败'; this.notify(job); });
        this.notify(job);
        return { ...job };
    }
    startFile(source, filePath, targetId, meta = {}) {
        if (this.job?.status === 'running') throw new Error('已有下载任务正在进行，请稍后再试');
        if (!source?.nodeId || !source?.libraryId || !targetId) throw new Error('下载来源或目标无效');
        const targetPath = this.validatePath(filePath);
        if (targetPath === '/') throw new Error('文件路径无效');
        this.getTarget(targetId, true);
        const size = meta.size == null ? null : Number(meta.size);
        const job = {
            id: crypto.randomUUID(), status: 'running', source, dirPath: targetPath, fileMode: true, targetId,
            completed: 0, skipped: 0, received: 0,
            total: Number.isSafeInteger(size) && size >= 0 ? size : 0,
            fileName: path.posix.basename(targetPath)
        };
        this.job = job;
        void this.runFile(job, targetPath, meta).catch(error => { job.status = 'error'; job.message = error.message || '下载失败'; this.notify(job); });
        this.notify(job);
        return { ...job };
    }
    async runFile(job, filePath, meta = {}) {
        // 已登记且文件仍存在的同一来源文件直接跳过，避免重复保存。
        if (await this.lookup(job.source, filePath, job.targetId)) {
            job.skipped = 1; job.status = 'done'; job.fileName = ''; this.notify(job); return;
        }
        const size = meta.size == null ? null : Number(meta.size);
        const knownSize = Number.isSafeInteger(size) && size >= 0 ? size : null;
        // 指纹与目录下载保持一致，先单文件下载再整目录下载时不会重复保存。
        const fingerprint = knownSize === null ? null : JSON.stringify([knownSize, meta.modifiedTime || null]);
        const root = await fs.promises.realpath(this.getTarget(job.targetId, true).basePath);
        await this.downloadOne(job, root, this.downloadPrefix(job.source), filePath, knownSize, fingerprint);
        job.status = 'done'; job.fileName = ''; this.notify(job);
    }
    downloadPrefix(source) {
        return ['夸克下载', crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16)];
    }
    async run(job) {
        const { source, targetId } = job;
        const root = await fs.promises.realpath(this.getTarget(targetId, true).basePath);
        const prefix = this.downloadPrefix(source);
        const queue = [job.dirPath];
        const visited = new Set();
        while (queue.length) {
            const dir = queue.shift();
            if (visited.has(dir)) continue;
            visited.add(dir);
            const items = await this.list(source, dir);
            if (!Array.isArray(items)) throw new Error('无法读取分享目录');
            for (const item of items) {
                const filePath = this.validatePath(item.path);
                if (!filePath.startsWith((dir === '/' ? '' : dir) + '/') || filePath.slice((dir === '/' ? '' : dir).length + 1).includes('/')) throw new Error('分享目录返回了无效路径');
                if (item.type === 'folder') { queue.push(filePath); continue; }
                if (item.type !== 'file') continue;
                const size = Number(item.size);
                if (!Number.isSafeInteger(size) || size < 0) throw new Error('无法确认文件大小');
                const fingerprint = JSON.stringify([size, item.modifiedTime || null]);
                const existing = await this.lookup(source, filePath, targetId);
                if (existing && existing.fingerprint === fingerprint) { job.skipped++; this.notify(job); continue; }
                await this.downloadOne(job, root, prefix, filePath, size, fingerprint);
            }
        }
        // 整目录完成后写入目录记录；同一来源+目标的旧记录先删除，避免数量过期与索引无限增长。根目录同样记录。
        const dirKey = this.key(source, job.dirPath);
        const previousRecords = this.records;
        this.records = this.records.filter(record => !(record.directory === true && record.key === dirKey && record.targetId === targetId));
        this.records.push({ key: dirKey, source, filePath: job.dirPath, targetId, relative: '', size: 0, directory: true, fileCount: job.completed + job.skipped, updatedAt: Date.now() });
        try { await this.persist(); } catch (error) { this.records = previousRecords; throw error; }
        job.status = 'done'; job.fileName = ''; this.notify(job);
    }
    // 单文件下载：临时文件、大小校验、防覆盖命名、索引回滚与目录下载完全一致。
    async downloadOne(job, root, prefix, filePath, size, fingerprint) {
        const parts = filePath.split('/').filter(Boolean);
        const name = parts.pop();
        const dirPath = await this.safeDir(root, [...prefix, ...parts]);
        const tmp = path.join(dirPath, `.aasc-${crypto.randomUUID()}.part`);
        job.fileName = name; job.received = 0; job.total = size ?? 0; this.notify(job);
        try {
            const stream = await this.open(job.source, filePath);
            let received = 0, last = 0;
            const meter = new Transform({ transform: (chunk, enc, cb) => {
                received += chunk.length;
                if (Date.now() - last >= 500) { last = Date.now(); job.received = received; this.notify(job); }
                cb(null, chunk);
            } });
            await pipeline(stream, meter, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
            const stat = await fs.promises.stat(tmp);
            if (size !== null && stat.size !== size) throw new Error('下载文件不完整');
            const output = await this.placeFile(tmp, dirPath, name);
            await fs.promises.unlink(tmp);
            const record = { key: this.key(job.source, filePath), source: job.source, filePath, targetId: job.targetId, relative: path.relative(root, output), size: stat.size, ...(fingerprint ? { fingerprint } : {}), updatedAt: Date.now() };
            this.records.push(record);
            try { await this.persist(); } catch (e) { this.records.pop(); throw e; }
            job.completed++; job.received = stat.size; this.notify(job);
        } catch (error) { await fs.promises.unlink(tmp).catch(() => {}); throw error; }
    }
    // 目标目录已有同名文件时不覆盖：硬链接失败时用独占复制，编号递增选择新文件名。
    async placeFile(tmp, dirPath, name) {
        const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
        for (let n = 0; n < 10000; n++) {
            const output = path.join(dirPath, n ? `${stem} (${n})${ext}` : name);
            try {
                try { await fs.promises.link(tmp, output); }
                catch (e) {
                    // Android 部分存储不支持硬链接；独占复制仍不覆盖已有文件。
                    if (!['EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(e.code)) throw e;
                    await fs.promises.copyFile(tmp, output, fs.constants.COPYFILE_EXCL);
                }
                return output;
            } catch (e) { if (e.code !== 'EEXIST' || n === 9999) throw e; }
        }
        throw new Error('无法生成目标文件名');
    }
}
async function serveQuarkDirectoryDownload(req, res, source, filePath, downloads) {
    if (req.query.thumbnail === '1') return false;
    const saved = await downloads.lookup(source, filePath);
    if (!saved) return false;
    if (req.query.prepare === '1') {
        res.setHeader('Content-Type', req.query.progress === '1' ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8');
        if (req.query.progress === '1') res.write(JSON.stringify({ type: 'progress', phase: 'ready', received: saved.size, total: saved.size }) + '\n');
        res.end(JSON.stringify({ status: 'success' }) + (req.query.progress === '1' ? '\n' : ''));
        return true;
    }
    const size = saved.size;
    let range = null;
    if (req.headers.range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!m || (!m[1] && !m[2]) || !size) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return true; }
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return true; }
        range = { start, end };
    }
    res.status(range ? 206 : 200);
    if (req.query.download === '1') { res.attachment(path.basename(filePath)); res.type('application/octet-stream'); }
    else res.type(path.extname(saved.full) || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(range ? range.end - range.start + 1 : size));
    if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    const stream = fs.createReadStream(saved.full, range || {});
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
}

module.exports = { QuarkDirectoryDownloads, serveQuarkDirectoryDownload };
