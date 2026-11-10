'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { QuarkDirectoryDownloads } = require('./quark-directory-downloads');
const { sanitizeCategoryName } = require('./download-path');
const { parseVideoUrl, parseCollectionUrl } = require('./bilibili-list-service');

class BilibiliDownloads {
    constructor({ indexPath, getTarget, streamService, fetchCollection, notify = () => {}, merge = mergeTracks }) {
        Object.assign(this, { getTarget, streamService, fetchCollection, notify, merge });
        this.index = new QuarkDirectoryDownloads({ indexPath, getTarget });
        this.source = { nodeId: 'bilibili', libraryId: 'bilibili' };
        this.job = null;
    }
    key(video) { return `/${video.bvid}/p${video.page}.mp4`; }
    lookup(video, targetId) { return this.index.lookup(this.source, this.key(video), targetId); }
    start(url, targetId, title, category = '') {
        if (this.job?.status === 'running') throw new Error('已有 B 站下载任务正在进行');
        this.getTarget(targetId, true);
        const collection = parseCollectionUrl(url);
        const video = collection ? null : parseVideoUrl(url);
        const job = { id: crypto.randomUUID(), status: 'running', targetId, url: collection?.url || video.url, category: sanitizeCategoryName(category), completed: 0, skipped: 0, total: 0, received: 0, fileName: '' };
        this.job = job;
        void this.run(job, collection, video, title).catch(error => { job.status = 'error'; job.message = error.message || '下载失败'; this.notify(job); });
        this.notify(job);
        return { ...job };
    }
    async run(job, collection, video, title) {
        const items = collection ? (await this.fetchCollection(collection.id)).videos : [{ ...video, title }];
        job.total = items.length;
        for (const item of items) {
            const parsed = parseVideoUrl(`https://www.bilibili.com/video/${item.bvid}?p=${item.page}`);
            if (await this.lookup(parsed, job.targetId)) { job.skipped++; this.notify(job); continue; }
            const root = await fs.promises.realpath(this.getTarget(job.targetId, true).basePath);
            const dir = await this.index.safeDir(root, ['B站视频', sanitizeCategoryName(job.category)]);
            const base = `${Array.from(String(item.title || parsed.bvid).replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').trim()).slice(0, 50).join('') || parsed.bvid} ${parsed.bvid}${parsed.page > 1 ? ` P${parsed.page}` : ''}`;
            const unique = crypto.randomUUID();
            const temporary = [path.join(dir, `.aasc-${unique}.video`), path.join(dir, `.aasc-${unique}.audio`), path.join(dir, `.aasc-${unique}.mp4`)];
            job.fileName = base; job.received = 0; this.notify(job);
            try {
                const write = async (url, dest) => {
                    const stream = await this.streamService.openDownloadStream(url);
                    let last = 0;
                    const meter = new Transform({ transform: (chunk, enc, cb) => { job.received += chunk.length; if (Date.now() - last >= 500) { last = Date.now(); this.notify(job); } cb(null, chunk); } });
                    await pipeline(stream, meter, fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 }));
                };
                let quality = '480P';
                try {
                    const dash = await this.streamService.resolveDash(parsed.url);
                    await write(dash.video.url, temporary[0]);
                    await write(dash.audio.url, temporary[1]);
                    await this.merge(temporary[0], temporary[1], temporary[2]);
                } catch (error) {
                    await Promise.all(temporary.map(p => fs.promises.unlink(p).catch(() => {})));
                    const progressive = await this.streamService.resolve(parsed.url);
                    job.received = 0; quality = 'MP4';
                    await write(progressive.streamUrl, temporary[2]);
                }
                const stat = await fs.promises.stat(temporary[2]);
                if (!stat.isFile() || stat.size === 0) throw new Error('下载的视频为空');
                let output;
                for (let n = 0; n < 10000; n++) {
                    output = path.join(dir, `${base}${n ? ` (${n})` : ''}.mp4`);
                    try {
                        try { await fs.promises.link(temporary[2], output); }
                        catch (e) { if (!['EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(e.code)) throw e; await fs.promises.copyFile(temporary[2], output, fs.constants.COPYFILE_EXCL); }
                        break;
                    } catch (e) { if (e.code !== 'EEXIST' || n === 9999) throw e; }
                }
                const record = { key: this.index.key(this.source, this.key(parsed)), source: this.source, filePath: this.key(parsed), targetId: job.targetId, relative: path.relative(root, output), size: stat.size, updatedAt: Date.now(), quality };
                this.index.records.push(record);
                try { await this.index.persist(); } catch (e) { this.index.records.pop(); throw e; }
                job.completed++; job.quality = quality; this.notify(job);
            } finally { await Promise.all(temporary.map(p => fs.promises.unlink(p).catch(() => {}))); }
        }
        job.status = 'done'; job.fileName = ''; this.notify(job);
    }
}
function mergeTracks(video, audio, output) {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', output], { stdio: 'ignore' });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error('合成视频失败')));
    });
}
module.exports = { BilibiliDownloads, mergeTracks };
