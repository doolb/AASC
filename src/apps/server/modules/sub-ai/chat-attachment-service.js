'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TEXT = new Set(['txt', 'md', 'log', 'csv', 'json']);
const LIMITS = { text: 1024 * 1024, image: 20 * 1024 * 1024, video: 100 * 1024 * 1024 };

function identifyFile(name, head) {
    const extension = path.extname(name).slice(1).toLowerCase();
    if (TEXT.has(extension)) return { kind: 'text', extension, mimeType: 'text/plain' };
    if (head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { kind: 'image', extension: 'png', mimeType: 'image/png' };
    if (head.subarray(0, 3).toString('hex') === 'ffd8ff') return { kind: 'image', extension: 'jpg', mimeType: 'image/jpeg' };
    if (/^GIF8[79]a/.test(head.toString())) return { kind: 'image', extension: 'gif', mimeType: 'image/gif' };
    if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') return { kind: 'image', extension: 'webp', mimeType: 'image/webp' };
    if (head.subarray(4, 8).toString() === 'ftyp') return { kind: 'video', extension: extension === 'mov' ? 'mov' : 'mp4', mimeType: extension === 'mov' ? 'video/quicktime' : 'video/mp4' };
    if (head.subarray(0, 4).toString('hex') === '1a45dfa3') return { kind: 'video', extension: 'webm', mimeType: 'video/webm' };
    throw new Error('仅支持TXT/MD/LOG/CSV/JSON文本、PNG/JPEG/GIF/WebP图片和MP4/WebM/MOV视频');
}
function decodeText(buffer) {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
        : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); }
    catch { try { text = new TextDecoder('gb18030', { fatal: true }).decode(buffer); } catch { throw new Error('文本文件编码无效，请使用UTF-8或带BOM的UTF-16'); } }
    if (text.includes('\0')) throw new Error('文件包含二进制内容，不能作为文本上传');
    return text;
}

/** 附件业务存储与历史解耦；草稿租约持久化，重启不会立即回收尚未发送的文件。 */
function createChatAttachmentService({ uploadsDir, gc, now = Date.now }) {
    const metadataDir = path.join(uploadsDir, 'chat-files');
    const metadataPath = id => { if (!UUID.test(id || '')) throw new Error('附件ID无效'); return path.join(metadataDir, `${id}.meta.json`); };
    const publicAsset = metadata => Object.fromEntries(Object.entries(metadata).filter(([key]) => !['leaseUntil', 'bound'].includes(key)));
    async function writeMeta(metadata) {
        await fs.mkdir(metadataDir, { recursive: true });
        const target = metadataPath(metadata.id); const temporary = `${target}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, target); }
        finally { await fs.unlink(temporary).catch(() => {}); }
    }
    async function metadata(id) {
        const file = metadataPath(id); const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('附件资料无效');
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (value.id !== id || !['text', 'image', 'video'].includes(value.kind) || typeof value.url !== 'string') throw new Error('附件资料无效');
        location(value); return value;
    }
    function location(asset) {
        const match = asset.url.match(/^\/uploads\/(chat-images|chat-videos|chat-files)\/([a-f0-9-]+\.(?:png|jpg|gif|webp|mp4|webm|mov|txt|md|log|csv|json))$/);
        if (!match || match[2].slice(0, 36) !== asset.id) throw new Error('附件路径无效');
        return path.join(uploadsDir, match[1], match[2]);
    }
    async function read(asset) {
        const value = await metadata(asset.id); const file = location(value); const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS[value.kind]) throw new Error('附件文件无效或过大');
        gc?.retain(value.id, 60000);
        return { ...publicAsset(value), filename: `${value.id}${path.extname(value.url)}`,
            ...(value.kind === 'video' ? { path: file } : { data: await fs.readFile(file) }) };
    }
    async function ingest(file) {
        return gc.write(async () => {
            let name = String(file.originalname || 'attachment');
            // 浏览器multipart文件名使用UTF-8，Busboy默认按Latin1读取；只对可无损识别的UTF-8做恢复。
            if (Array.from(name).every(char => char.charCodeAt(0) <= 255)) {
                try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')); } catch { /* 保留原有合法单字节文件名。 */ }
            }
            const original = name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200);
            const handle = await fs.open(file.path, 'r'); const head = Buffer.alloc(32);
            try { await handle.read(head, 0, 32, 0); } finally { await handle.close(); }
            const type = identifyFile(original, head);
            if (!file.size || file.size > LIMITS[type.kind]) throw new Error(`${type.kind === 'text' ? '文本' : type.kind === 'image' ? '图片' : '视频'}超过${LIMITS[type.kind] / 1024 / 1024}MiB限制或为空`);
            const id = randomUUID();
            const directory = { text: 'chat-files', image: 'chat-images', video: 'chat-videos' }[type.kind];
            const value = { id, kind: type.kind, name: original, mimeType: type.mimeType, size: file.size,
                url: `/uploads/${directory}/${id}.${type.extension}`, leaseUntil: now() + 86400000 };
            const target = location(value); await fs.mkdir(path.dirname(target), { recursive: true });
            try {
                if (type.kind === 'text') {
                    const data = Buffer.from(decodeText(await fs.readFile(file.path)), 'utf8');
                    if (data.length > LIMITS.text) throw new Error('文本解码后超过1MiB限制');
                    value.size = data.length; await fs.writeFile(target, data, { flag: 'wx' });
                } else await fs.copyFile(file.path, target, require('node:fs').constants.COPYFILE_EXCL);
                await writeMeta(value); gc.retain(id); return publicAsset(value);
            } catch (error) { await fs.unlink(target).catch(() => {}); throw error; }
        });
    }
    async function resolve(ids, profile = {}) {
        if (!Array.isArray(ids) || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('每条消息最多4个不同附件');
        const values = [];
        for (const id of ids) {
            const value = await metadata(id);
            const stat = await fs.lstat(location(value));
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS[value.kind]) throw new Error('附件已不存在或文件无效，请重新上传');
            if (value.kind === 'image' && profile.supportsImageUpload === false) throw new Error('当前LLM配置不支持上传图片');
            if (value.kind === 'video' && profile.supportsVideoUpload !== true) throw new Error('当前LLM配置未开启视频上传');
            gc.retain(id); values.push(publicAsset(value));
        }
        return values;
    }
    async function bind(assets) { for (const asset of assets) { const value = await metadata(asset.id); value.bound = true; value.leaseUntil = 0; await writeMeta(value); gc.release(asset.id); } }
    function install(app) {
        const upload = multer({ dest: path.join(uploadsDir, '..', 'temp', 'chat-attachments'), limits: { fileSize: LIMITS.video, files: 1, fields: 8 } }).single('file');
        app.post('/api/chat/attachments', (req, res) => upload(req, res, async error => {
            try { if (error) throw new Error('附件上传失败或超过100MiB限制'); if (!req.file) throw new Error('请选择附件'); res.json({ status: 'success', attachment: await ingest(req.file) }); }
            catch (cause) { res.status(400).json({ status: 'error', error: cause.message }); }
            finally { if (req.file) await fs.unlink(req.file.path).catch(() => {}); }
        }));
        app.delete('/api/chat/attachments/:id', async (req, res) => {
            try { const value = await metadata(req.params.id); if (!value.bound) { value.leaseUntil = 0; await writeMeta(value); gc.release(value.id); } gc.schedule(); res.json({ status: 'success' }); }
            catch { res.status(404).json({ status: 'error', error: '附件不存在' }); }
        });
    }
    return { ingest, resolve, bind, read, install };
}
module.exports = { createChatAttachmentService, identifyFile, decodeText, LIMITS };
