'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { applicationError } = require('./chat2api-system-controls');
const PATTERN = /^chat_file_([a-f0-9-]{36})$/;
const MAX_BYTES = 100 * 1024 * 1024;

/** Chat2API接收视频原件，聊天JSON只保留不透明ID；与豆包任务既有/v1/files接口分开。 */
function createChat2ApiInputFiles({ rootDir, now = Date.now } = {}) {
    let directory; let preparing; let timer;
    const prepare = () => preparing ||= (async () => {
        directory = rootDir ? path.join(rootDir, 'chat-input-files') : await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat-files-'));
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('聊天文件目录无效');
        return directory;
    })();
    async function get(id) {
        if (!PATTERN.test(id || '')) throw applicationError('invalid_input', '视频附件ID无效');
        const root = await prepare();
        try {
            const file = path.join(root, `${id}.json`); const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('invalid');
            const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
            if (metadata.id !== id || now() - metadata.created > 86400000) throw new Error('expired');
            const source = path.join(root, `${id}.bin`); const content = await fs.lstat(source);
            if (!content.isFile() || content.isSymbolicLink() || content.size !== metadata.bytes || content.size > MAX_BYTES) throw new Error('invalid');
            return { ...metadata, path: source };
        } catch { throw applicationError('chat_file_not_found', '视频附件已过期或不存在，请重新发送'); }
    }
    async function read(id) { const value = await get(id); return { ...value, data: await fs.readFile(value.path) }; }
    async function cleanup() {
        const root = await prepare();
        for (const entry of await fs.readdir(root, { withFileTypes: true })) {
            if (!entry.isFile() || !/^(chat_file_[a-f0-9-]{36}\.(bin|json)|[a-f0-9]{32})$/.test(entry.name)) continue;
            const file = path.join(root, entry.name); const stat = await fs.lstat(file);
            if (stat.isFile() && !stat.isSymbolicLink() && now() - stat.mtimeMs > 86400000) await fs.unlink(file);
        }
    }
    async function upload(request, response) {
        const root = await prepare(); await cleanup();
        const entries = await fs.readdir(root);
        if (entries.filter(name => /^chat_file_[a-f0-9-]{36}\.json$/.test(name)).length >= 64) throw applicationError('chat_file_capacity', '视频附件缓存已满，请稍后重试');
        const parse = multer({ dest: root, limits: { files: 1, fields: 2, fileSize: MAX_BYTES } }).single('file');
        try {
            await new Promise((resolve, reject) => parse(request, response, error => error ? reject(error) : resolve()));
            const file = request.file; if (!file) throw new Error('missing');
            return await storeFile(file);
        } catch { throw applicationError('invalid_video_file', '视频附件上传失败，请使用100MiB以内的MP4/WebM视频'); }
        finally { if (request.file?.path) await fs.unlink(request.file.path).catch(() => {}); }
    }
    async function storeFile(file) {
            const root = await prepare();
            const handle = await fs.open(file.path, 'r'); const head = Buffer.alloc(16);
            try { await handle.read(head, 0, 16, 0); } finally { await handle.close(); }
            const type = head.subarray(4, 8).toString() === 'ftyp' ? { mimeType: 'video/mp4', extension: 'mp4' }
                : head.subarray(0, 4).toString('hex') === '1a45dfa3' ? { mimeType: 'video/webm', extension: 'webm' } : null;
            if (!type || !file.size) throw new Error('format');
            const id = `chat_file_${randomUUID()}`; const metadata = { id, filename: `video.${type.extension}`, bytes: file.size, ...type, created: now() };
            await fs.rename(file.path, path.join(root, `${id}.bin`));
            await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify(metadata), { mode: 0o600, flag: 'wx' });
            return { id, object: 'file', filename: metadata.filename, bytes: file.size, purpose: 'chat-video' };
    }
    async function put(file, { signal } = {}) {
        signal?.throwIfAborted(); const root = await prepare(); await cleanup();
        const size = file.path ? (await fs.stat(file.path)).size : file.data?.length;
        if (!size || size > MAX_BYTES) throw applicationError('video_limit', '视频附件为空或超过100MiB');
        if ((await fs.readdir(root)).filter(name => /^chat_file_[a-f0-9-]{36}\.json$/.test(name)).length >= 64) throw applicationError('chat_file_capacity', '视频附件缓存已满');
        const temporary = path.join(root, randomUUID().replaceAll('-', ''));
        try {
            if (file.path) await pipeline(createReadStream(file.path), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
            else await fs.writeFile(temporary, file.data, { flag: 'wx', mode: 0o600 });
            signal?.throwIfAborted(); return await storeFile({ path: temporary, size });
        } finally { await fs.unlink(temporary).catch(() => {}); }
    }
    return { upload, put, read, get, cleanup, start() { timer ||= setInterval(() => { void cleanup().catch(() => {}); }, 3600000); timer.unref?.(); }, async stop() { clearInterval(timer); if (!rootDir && directory) {
        // 临时目录只由本实例创建；不递归清理任何用户目录。
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isFile()) await fs.unlink(path.join(directory, entry.name));
        await fs.rmdir(directory);
    } } };
}
module.exports = { createChat2ApiInputFiles };
