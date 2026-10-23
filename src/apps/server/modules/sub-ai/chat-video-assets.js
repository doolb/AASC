'use strict';
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');

/** 视频使用流式下载和原子落盘；不把整个视频放进内存，也不持久化会过期的上游地址。 */
function createChatVideoAssets({ directory, urlPrefix = '/uploads/chat-videos/', http = axios, imageAssets,
    maxBytes = 256 * 1024 * 1024 }) {
    async function save(video, { signal } = {}) {
        signal?.throwIfAborted();
        if (!/^https:\/\//.test(video.url || '')) throw new Error('生成视频地址无效');
        const response = await http.get(video.url, { responseType: 'stream', signal, timeout: 180000,
            maxRedirects: 3, maxContentLength: maxBytes, maxBodyLength: maxBytes });
        const mime = String(response.headers?.['content-type'] || '').split(';')[0].toLowerCase();
        const extension = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/octet-stream': 'mp4' }[mime];
        if (!extension || Number(response.headers?.['content-length']) > maxBytes) {
            response.data?.destroy?.(); throw new Error('视频类型无效或超过256MiB');
        }
        await fs.mkdir(directory, { recursive: true });
        const id = randomUUID(); const filename = `${id}.${extension}`;
        const target = path.join(directory, filename); const temporary = `${target}.part`;
        let size = 0; let prefix = Buffer.alloc(0);
        const guard = new Transform({ transform(chunk, encoding, done) {
            size += chunk.length;
            if (size > maxBytes) { done(new Error('生成视频超过大小限制')); return; }
            if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
            done(null, chunk);
        } });
        try {
            const source = Buffer.isBuffer(response.data) ? Readable.from([response.data]) : response.data;
            await pipeline(source, guard, createWriteStream(temporary, { flags: 'wx' }), { signal });
            const valid = extension === 'mp4' ? prefix.subarray(4, 8).toString() === 'ftyp' : prefix.subarray(0, 4).toString('hex') === '1a45dfa3';
            if (!size || !valid) throw new Error('上游未返回有效视频文件');
            signal?.throwIfAborted();
            await fs.rename(temporary, target);
            const saved = { id, url: `${urlPrefix}${filename}`, mimeType: extension === 'mp4' ? 'video/mp4' : 'video/webm', size };
            for (const key of ['width', 'height', 'duration']) if (Number(video[key]) > 0) saved[key] = Number(video[key]);
            if (video.posterUrl && imageAssets) {
                try { saved.posterUrl = (await imageAssets.save({ url: video.posterUrl }, { signal })).url; }
                catch { /* 封面下载失败不丢弃已经生成的可播放视频。 */ }
            }
            signal?.throwIfAborted(); return saved;
        } catch (error) {
            await fs.unlink(temporary).catch(() => {});
            await fs.unlink(target).catch(() => {});
            throw error;
        }
    }
    return { save };
}
module.exports = { createChatVideoAssets };
